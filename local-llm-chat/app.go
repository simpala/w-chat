package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	openai "github.com/sashabaranov/go-openai"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"local-llm-chat/artifacts"
	"local-llm-chat/mcpclient"
)

// App struct
type App struct {
	ctx             context.Context
	config          Config
	db              *Database
	llmCmd          *exec.Cmd // This holds the command for the LLM process
	mcpClients      map[string]*mcpclient.McpClient
	conversations   map[int64]*Conversation
	mu              sync.Mutex
	ArtifactService *artifacts.ArtifactService
}

// Config struct - Add the Theme field here
type Config struct {
	LlamaCppDir         string            `json:"llama_cpp_dir"`
	ModelsDir           string            `json:"models_dir"`
	SelectedModel       string            `json:"selected_model"`
	ModelArgs           map[string]string `json:"model_args"`
	Theme               string            `json:"theme"`
	McpConnectionStates map[string]bool   `json:"mcp_connection_states"`
}

// Conversation struct to hold the state of a single chat session
type Conversation struct {
	messages     []openai.ChatCompletionMessage
	systemPrompt string
	stream       *openai.ChatCompletionStream
	mu           sync.Mutex
}

func NewApp() *App {
	return &App{
		conversations: make(map[int64]*Conversation),
		mcpClients:    make(map[string]*mcpclient.McpClient),
	}
}

// startup is called when the app starts.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	log.Println("App startup initiated.")
	db, err := NewDatabase("chat.db")
	if err != nil {
		wailsruntime.LogErrorf(a.ctx, "Error opening database: %s", err.Error())
		return
	}
	a.db = db
	err = a.db.Initialize()
	if err != nil {
		wailsruntime.LogErrorf(a.ctx, "Error initializing database: %s", err.Error())
		return
	}

	userConfigDir, err := os.UserConfigDir()
	if err != nil {
		wailsruntime.LogErrorf(a.ctx, "App Startup: Failed to get user config directory for artifacts: %v", err)
		a.ArtifactService = artifacts.NewArtifactService(nil, "")
	} else {
		artifactDataDir := filepath.Join(userConfigDir, "local-llm-chat", "artifacts")
		a.ArtifactService = artifacts.NewArtifactService(ctx, artifactDataDir)
	}

	exePath, err := os.Executable()
	if err == nil {
		configFilePath := filepath.Join(filepath.Dir(exePath), "config.json")
		wailsruntime.LogInfof(a.ctx, "Expected config.json path: %s", configFilePath)
	} else {
		wailsruntime.LogErrorf(a.ctx, "Could not determine executable path for config.json logging: %v", err)
	}

	settings, err := a.LoadSettings()
	if err != nil {
		wailsruntime.LogErrorf(a.ctx, "Error loading config: %s", err.Error())
	} else {
		wailsruntime.LogInfof(a.ctx, "Raw settings loaded from config.json: %s", settings)
	}

	var config Config
	err = json.Unmarshal([]byte(settings), &config)
	if err != nil {
		wailsruntime.LogErrorf(a.ctx, "Error unmarshalling settings string into Config struct: %s", err.Error())
	} else {
		wailsruntime.LogInfof(a.ctx, "Unmarshalled Config struct in startup: %+v", config)
	}

	if config.ModelArgs == nil {
		config.ModelArgs = make(map[string]string)
	}
	a.config = config
	log.Println("App startup complete.")
	wailsruntime.LogInfof(a.ctx, "Final a.config state after startup: %+v", a.config)
}

// NewChat creates a new chat session.
func (a *App) NewChat(systemPrompt string) (int64, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	id, err := a.db.NewChatSession(systemPrompt)
	if err != nil {
		return 0, err
	}
	a.conversations[id] = &Conversation{
		messages:     make([]openai.ChatCompletionMessage, 0),
		systemPrompt: systemPrompt,
	}
	wailsruntime.LogInfof(a.ctx, "New chat session %d created with system prompt: '%s'", id, systemPrompt)
	return id, nil
}

// LoadChatSessions loads all chat sessions.
func (a *App) LoadChatSessions() ([]ChatSession, error) {
	return a.db.GetChatSessions()
}

// DeleteChatSession deletes a chat session.
func (a *App) DeleteChatSession(id int64) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	delete(a.conversations, id)
	return a.db.DeleteChatSession(id)
}

// UpdateChatSystemPrompt updates the system prompt for an existing chat session.
func (a *App) UpdateChatSystemPrompt(sessionID int64, newSystemPrompt string) error {
	a.mu.Lock()
	defer a.mu.Unlock()

	conv, ok := a.conversations[sessionID]
	if !ok {
		wailsruntime.LogErrorf(a.ctx, "UpdateChatSystemPrompt: Conversation with ID %d not found in memory.", sessionID)
		return fmt.Errorf("conversation not found")
	}

	conv.mu.Lock()
	conv.systemPrompt = newSystemPrompt
	conv.mu.Unlock()

	err := a.db.UpdateChatSessionSystemPrompt(sessionID, newSystemPrompt)
	if err != nil {
		wailsruntime.LogErrorf(a.ctx, "UpdateChatSystemPrompt: Error updating system prompt in DB for session %d: %s", sessionID, err.Error())
		return err
	}
	wailsruntime.LogInfof(a.ctx, "UpdateChatSystemPrompt: System prompt for session %d updated to: '%s'", sessionID, newSystemPrompt)
	return nil
}

// IsLLMLoaded checks if the LLM process is currently running.
func (a *App) IsLLMLoaded() bool {
	if a.llmCmd != nil && a.llmCmd.Process != nil && a.llmCmd.ProcessState == nil {
		wailsruntime.LogDebugf(a.ctx, "IsLLMLoaded: LLM process appears to be running (PID: %d).", a.llmCmd.Process.Pid)
		return true
	}
	wailsruntime.LogDebugf(a.ctx, "IsLLMLoaded: LLM process is not running.")
	return false
}

// SaveSettings saves the configuration to a JSON file.
func (a *App) SaveSettings(settings string) error {
	wailsruntime.LogInfof(a.ctx, "SaveSettings called with raw settings string: %s", settings)
	var config Config
	err := json.Unmarshal([]byte(settings), &config)
	if err != nil {
		wailsruntime.LogErrorf(a.ctx, "Error unmarshalling settings string in SaveSettings: %s", err.Error())
		return err
	}
	wailsruntime.LogInfof(a.ctx, "Config struct after unmarshalling in SaveSettings: %+v", config)

	if a.config.ModelArgs == nil {
		a.config.ModelArgs = make(map[string]string)
	}
	if config.ModelArgs == nil {
		config.ModelArgs = a.config.ModelArgs
	} else {
		for model, args := range a.config.ModelArgs {
			if _, ok := config.ModelArgs[model]; !ok {
				config.ModelArgs[model] = args
			}
		}
	}
	a.config = config
	wailsruntime.LogInfof(a.ctx, "a.config state before saving to file: %+v", a.config)

	file, err := os.Create("config.json")
	if err != nil {
		wailsruntime.LogErrorf(a.ctx, "Error creating config.json file: %s", err.Error())
		return err
	}
	defer file.Close()
	encoder := json.NewEncoder(file)
	encoder.SetIndent("", "  ")
	encodeErr := encoder.Encode(a.config)
	if encodeErr != nil {
		wailsruntime.LogErrorf(a.ctx, "Error encoding config to JSON file: %s", encodeErr.Error())
		return encodeErr
	}
	wailsruntime.LogInfo(a.ctx, "Config saved to config.json successfully.")
	return nil
}

// LoadSettings loads the configuration from a JSON file.
func (a *App) LoadSettings() (string, error) {
	file, err := os.Open("config.json")
	if err != nil {
		if os.IsNotExist(err) {
			wailsruntime.LogInfo(a.ctx, "config.json does not exist. Initializing with default config.")
			a.config = Config{}
			a.config.Theme = "default"
			saveErr := a.SaveSettings(`{"theme":"default"}`)
			if saveErr != nil {
				wailsruntime.LogErrorf(a.ctx, "Error saving default config.json: %s", saveErr.Error())
				return "", saveErr
			}
			return `{"theme":"default"}`, nil
		}
		wailsruntime.LogErrorf(a.ctx, "Error opening config.json: %s", err.Error())
		return "", err
	}
	defer file.Close()

	fileContentBytes, readErr := os.ReadFile("config.json")
	if readErr != nil {
		wailsruntime.LogErrorf(a.ctx, "Error reading content from config.json: %s", readErr.Error())
		return "", readErr
	}
	fileContent := string(fileContentBytes)
	wailsruntime.LogInfof(a.ctx, "Content read from config.json: %s", fileContent)

	decoder := json.NewDecoder(strings.NewReader(fileContent))
	err = decoder.Decode(&a.config)
	if err != nil {
		wailsruntime.LogErrorf(a.ctx, "Error decoding config.json content into Config struct: %s", err.Error())
		return "", err
	}
	if a.config.Theme == "" {
		a.config.Theme = "default"
		wailsruntime.LogInfo(a.ctx, "Theme was empty, defaulted to 'default'.")
	}
	wailsruntime.LogInfof(a.ctx, "a.config state after loading and decoding: %+v", a.config)

	configBytes, err := json.Marshal(a.config)
	if err != nil {
		wailsruntime.LogErrorf(a.ctx, "Error marshalling a.config to JSON string for frontend: %s", err.Error())
		return "", err
	}
	wailsruntime.LogInfof(a.ctx, "Returning config JSON string to frontend: %s", string(configBytes))
	return string(configBytes), nil
}

// GetModels returns a list of .GGUF models in the models directory.
func (a *App) GetModels() ([]string, error) {
	var models []string
	modelsDir := a.config.ModelsDir
	if modelsDir == "" {
		return []string{}, nil
	}
	err := filepath.Walk(modelsDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			wailsruntime.LogErrorf(a.ctx, "Error accessing path %s: %v", path, err)
			return nil
		}
		if !info.IsDir() && (strings.HasSuffix(info.Name(), ".gguf") || strings.HasSuffix(info.Name(), ".GGUF")) {
			models = append(models, path)
		}
		return nil
	})
	if err != nil {
		if os.IsNotExist(err) {
			return []string{}, nil
		}
		return nil, err
	}
	return models, err
}

// GetPrompts returns a list of .md files in the prompts directory.
func (a *App) GetPrompts() ([]string, error) {
	exePath, err := os.Executable()
	if err != nil {
		return nil, err
	}
	promptsDir := filepath.Join(filepath.Dir(exePath), "prompts")
	var prompts []string
	err = filepath.Walk(promptsDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if !info.IsDir() && strings.HasSuffix(info.Name(), ".md") {
			prompts = append(prompts, strings.TrimSuffix(info.Name(), ".md"))
		}
		return nil
	})
	if err != nil {
		if os.IsNotExist(err) {
			return []string{}, nil
		}
		return nil, err
	}
	return prompts, nil
}

// McpServerConfig struct for individual server configurations
type McpServerConfig struct {
	Command     string            `json:"command"`
	Args        []string          `json:"args"`
	Description string            `json:"description"`
	Token       string            `json:"token,omitempty"`
	Env         map[string]string `json:"env,omitempty"`
}

// McpConfig struct for the top-level mcp.json structure
type McpConfig struct {
	McpServers map[string]McpServerConfig `json:"mcpServers"`
}

// GetMcpServers returns the contents of mcp.json
func (a *App) GetMcpServers() (string, error) {
	file, err := os.Open("mcp.json")
	if err != nil {
		if os.IsNotExist(err) {
			wailsruntime.LogInfo(a.ctx, "mcp.json does not exist. Returning empty server list.")
			return "{}", nil
		}
		wailsruntime.LogErrorf(a.ctx, "Error opening mcp.json: %s", err.Error())
		return "", err
	}
	defer file.Close()

	fileContentBytes, readErr := os.ReadFile("mcp.json")
	if readErr != nil {
		wailsruntime.LogErrorf(a.ctx, "Error reading content from mcp.json: %s", readErr.Error())
		return "", readErr
	}
	fileContent := string(fileContentBytes)
	wailsruntime.LogInfof(a.ctx, "Content read from mcp.json: %s", fileContent)

	return fileContent, nil
}

// SpawnMcpServer spawns an MCP server process.
func (a *App) SpawnMcpServer(serverName string, command string, args []string, env map[string]string) (string, error) {
	return "Spawning has been disabled in this version.", nil
}

// GetPrompt returns the content of a specific prompt file.
func (a *App) GetPrompt(promptName string) (string, error) {
	exePath, err := os.Executable()
	if err != nil {
		return "", err
	}
	promptFile := filepath.Join(filepath.Dir(exePath), "prompts", promptName+".md")
	content, err := os.ReadFile(promptFile)
	if err != nil {
		return "", err
	}
	return string(content), nil
}

// LaunchLLM launches the LLM server in the background.
func (a *App) LaunchLLM(command string) (string, error) {
	if a.llmCmd != nil && a.llmCmd.Process != nil {
		wailsruntime.LogInfo(a.ctx, "Terminating existing LLM server process...")
		if err := a.llmCmd.Process.Kill(); err != nil {
			wailsruntime.LogErrorf(a.ctx, "Failed to terminate existing LLM server: %v", err)
		}
	}
	cmdParts := strings.Fields(command)
	if len(cmdParts) == 0 {
		return "", fmt.Errorf("empty command provided")
	}
	cmd := exec.Command(cmdParts[0], cmdParts[1:]...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	setHideWindow(cmd)

	if err := cmd.Start(); err != nil {
		return "", fmt.Errorf("failed to start LLM server: %w", err)
	}
	a.llmCmd = cmd
	go func() {
		if err := cmd.Wait(); err != nil {
			wailsruntime.LogErrorf(a.ctx, "LLM server exited with error: %v", err)
		}
		a.llmCmd = nil
	}()
	return "LLM server launched successfully!", nil
}

// HealthCheck checks the health of the LLM server.
func (a *App) HealthCheck() (string, error) {
	resp, err := http.Get("http://localhost:8080/health")
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	var result map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("unexpected health check response")
	}
	status, ok := result["status"].(string)
	if !ok {
		return "", fmt.Errorf("unexpected health check response")
	}
	return status, nil
}

// ShutdownLLM attempts to gracefully shut down the LLM server.
func (a *App) ShutdownLLM() error {
	if a.llmCmd != nil && a.llmCmd.Process != nil {
		wailsruntime.LogInfo(a.ctx, "Attempting to shut down LLM server...")
		// On non-windows system we can kill the whole process group by sending a signal to -PID
		pid := a.llmCmd.Process.Pid
		wailsruntime.LogInfof(a.ctx, "LLM server PID: %d", pid)
		if err := syscall.Kill(-pid, syscall.SIGTERM); err != nil {
			wailsruntime.LogErrorf(a.ctx, "Failed to send SIGTERM to LLM server process group: %v. Attempting to kill.", err)
			if err := a.llmCmd.Process.Kill(); err != nil {
				wailsruntime.LogErrorf(a.ctx, "Failed to kill LLM server: %v", err)
				return err
			}
		}
	}
	return nil
}

// --- MODIFIED: Call ArtifactService.Shutdown() during app shutdown ---
func (a *App) shutdown(ctx context.Context) bool {
	a.ShutdownLLM()
	for _, client := range a.mcpClients {
		client.Disconnect()
	}
	if a.ArtifactService != nil {
		a.ArtifactService.Shutdown() // Call the new Shutdown method
	}
	return false
}

// --- END MODIFIED ---

// ConnectMcpClient connects to an MCP server.
func (a *App) ConnectMcpClient(serverName string, command string, args []string) error {
	a.mu.Lock()
	defer a.mu.Unlock()

	if _, ok := a.mcpClients[serverName]; ok {
		return fmt.Errorf("client for server %s is already connected", serverName)
	}

	// client := mcpclient.NewMcpClient()
	// if err := client.Connect(command, args); err != nil {
	// 	return err
	// }

	// a.mcpClients[serverName] = client
	return nil
}

// DisconnectMcpClient disconnects from an MCP server.
func (a *App) DisconnectMcpClient(serverName string) {
	a.mu.Lock()
	defer a.mu.Unlock()

	if client, ok := a.mcpClients[serverName]; ok {
		client.Disconnect()
		delete(a.mcpClients, serverName)
	}
}

// LoadChatHistory loads the chat history for a given session into memory.
func (a *App) LoadChatHistory(sessionId int64) ([]openai.ChatCompletionMessage, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	wailsruntime.LogInfof(a.ctx, "Loading chat history for session %d", sessionId)

	history, err := a.db.GetChatMessages(sessionId)
	if err != nil {
		wailsruntime.LogErrorf(a.ctx, "Error getting chat messages from db: %s", err.Error())
		return nil, err
	}
	wailsruntime.LogInfof(a.ctx, "Loaded %d messages from db for session %d. Content: %+v", len(history), sessionId, history)

	session, err := a.db.GetChatSession(sessionId)
	if err != nil {
		wailsruntime.LogErrorf(a.ctx, "Error getting chat session from db: %s", err.Error())
		return nil, err
	}

	conv, ok := a.conversations[sessionId]
	if !ok {
		conv = &Conversation{
			messages: make([]openai.ChatCompletionMessage, 0),
		}
		a.conversations[sessionId] = conv
	}
	conv.mu.Lock()

	conv.messages = make([]openai.ChatCompletionMessage, len(history))
	for i, msg := range history {
		conv.messages[i] = openai.ChatCompletionMessage{
			Role:    msg.Role,
			Content: msg.Content,
		}
	}

	conv.systemPrompt = session.SystemPrompt
	conv.mu.Unlock()
	wailsruntime.LogInfof(a.ctx, "Updated conversation in memory for session %d. System Prompt: '%s'", sessionId, conv.systemPrompt)

	if history == nil {
		return []openai.ChatCompletionMessage{}, nil
	}

	// Convert history to []openai.ChatCompletionMessage before returning
	var chatHistory []openai.ChatCompletionMessage
	for _, msg := range history {
		chatHistory = append(chatHistory, openai.ChatCompletionMessage{
			Role:    msg.Role,
			Content: msg.Content,
		})
	}

	return chatHistory, nil
}

// HandleChat is the main entry point for handling a user's message.
func (a *App) HandleChat(sessionId int64, message string) {
	conv, ok := a.getConversation(sessionId)
	if !ok {
		wailsruntime.LogErrorf(a.ctx, "Conversation with ID %d not found.", sessionId)
		return
	}
	conv.mu.Lock()
	defer conv.mu.Unlock()

	userMessage := openai.ChatCompletionMessage{Role: openai.ChatMessageRoleUser, Content: message}

	var messagesForLLM []openai.ChatCompletionMessage
	wailsruntime.LogInfof(a.ctx, "HandleChat: System Prompt for session %d: '%s'", sessionId, conv.systemPrompt)
	if conv.systemPrompt != "" {
		messagesForLLM = append(messagesForLLM, openai.ChatCompletionMessage{Role: openai.ChatMessageRoleSystem, Content: conv.systemPrompt})
	}
	messagesForLLM = append(messagesForLLM, conv.messages...)
	messagesForLLM = append(messagesForLLM, userMessage)

	messagesJson, err := json.Marshal(messagesForLLM)
	if err != nil {
		wailsruntime.LogErrorf(a.ctx, "HandleChat: Error marshalling messagesForLLM for logging: %v", err)
	} else {
		wailsruntime.LogInfof(a.ctx, "HandleChat: Full message payload to LLM for session %d: %s", sessionId, string(messagesJson))
	}

	conv.messages = append(conv.messages, userMessage)
	if err := a.db.SaveChatMessage(sessionId, "user", message); err != nil {
		wailsruntime.LogErrorf(a.ctx, "Error saving user message: %s", err.Error())
		return
	}

	config := openai.DefaultConfig("")
	config.BaseURL = "http://localhost:8080/v1"
	client := openai.NewClientWithConfig(config)

	req := openai.ChatCompletionRequest{
		Model:     "LLaMA_CPP",
		MaxTokens: 2048,
		Messages:  messagesForLLM,
		Stream:    true,
	}

	stream, err := client.CreateChatCompletionStream(a.ctx, req)
	if err != nil {
		wailsruntime.LogErrorf(a.ctx, "ChatCompletionStream error: %v\n", err)
		return
	}
	conv.stream = stream

	go a.streamHandler(sessionId, stream)
}

func (a *App) streamHandler(sessionID int64, stream *openai.ChatCompletionStream) {
	defer stream.Close()

	conv, ok := a.getConversation(sessionID)
	if !ok {
		wailsruntime.LogErrorf(a.ctx, "Conversation with ID %d not found.", sessionID)
		wailsruntime.EventsEmit(a.ctx, "chat-stream", nil)
		return
	}

	var mu sync.Mutex
	var currentChunkBuffer strings.Builder
	var fullResponseBuilder strings.Builder

	const batchInterval = 50 * time.Millisecond
	const maxBatchChars = 80

	ticker := time.NewTicker(batchInterval)
	defer ticker.Stop()

	go func() {
		defer wailsruntime.LogDebugf(a.ctx, "Batch sender goroutine for session %d exited.", sessionID)
		for range ticker.C {
			mu.Lock()
			if currentChunkBuffer.Len() > 0 {
				chunkToSend := currentChunkBuffer.String()
				currentChunkBuffer.Reset()
				mu.Unlock()
				wailsruntime.EventsEmit(a.ctx, "chat-stream", chunkToSend)
			} else {
				mu.Unlock()
			}
		}
	}()

	for {
		response, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			wailsruntime.LogInfof(a.ctx, "\nStream finished for session %d", sessionID)
			break
		}

		if err != nil {
			wailsruntime.LogErrorf(a.ctx, "\nStream error for session %d: %v\n", sessionID, err)
			break
		}

		content := response.Choices[0].Delta.Content
		mu.Lock()
		currentChunkBuffer.WriteString(content)
		fullResponseBuilder.WriteString(content)

		if currentChunkBuffer.Len() >= maxBatchChars {
			chunkToSend := currentChunkBuffer.String()
			currentChunkBuffer.Reset()
			mu.Unlock()
			wailsruntime.EventsEmit(a.ctx, "chat-stream", chunkToSend)
		} else {
			mu.Unlock()
		}
	}

	mu.Lock()
	if currentChunkBuffer.Len() > 0 {
		wailsruntime.EventsEmit(a.ctx, "chat-stream", currentChunkBuffer.String())
	}
	mu.Unlock()

	conv.mu.Lock()
	defer conv.mu.Unlock()

	assistantMessage := openai.ChatCompletionMessage{Role: "assistant", Content: fullResponseBuilder.String()}
	conv.messages = append(conv.messages, assistantMessage)
	if err := a.db.SaveChatMessage(sessionID, "assistant", fullResponseBuilder.String()); err != nil {
		wailsruntime.LogErrorf(a.ctx, "Error saving assistant message: %s", err.Error())
	}

	wailsruntime.EventsEmit(a.ctx, "chat-stream", nil)
}

// StopStream stops the current chat stream.
func (a *App) StopStream(sessionID int64) {
	conv, ok := a.getConversation(sessionID)
	if !ok {
		wailsruntime.LogErrorf(a.ctx, "Conversation with ID %d not found.", sessionID)
		return
	}
	conv.mu.Lock()
	defer conv.mu.Unlock()
	if conv.stream != nil {
		conv.stream.Close()
	}
}

func (a *App) getConversation(sessionID int64) (*Conversation, bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	conv, ok := a.conversations[sessionID]
	return conv, ok
}

// Existing methods for artifacts should now delegate to the service:
func (a *App) AddArtifact(sessionID string, artifactType artifacts.ArtifactType, name string, contentBase64 string) (*artifacts.Artifact, error) {
	if a.ArtifactService == nil {
		return nil, fmt.Errorf("artifact service not initialized")
	}
	return a.ArtifactService.AddArtifact(sessionID, artifactType, name, contentBase64)
}

func (a *App) ListArtifacts(sessionID string) ([]*artifacts.Artifact, error) {
	if a.ArtifactService == nil {
		return nil, fmt.Errorf("artifact service not initialized")
	}
	return a.ArtifactService.ListArtifacts(sessionID)
}

func (a *App) DeleteArtifact(artifactID string) error {
	if a.ArtifactService == nil {
		return fmt.Errorf("artifact service not initialized")
	}
	return a.ArtifactService.DeleteArtifact(artifactID)
}
