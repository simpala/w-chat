package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"local-llm-chat/artifacts"
)

// App struct
type App struct {
	ctx             context.Context
	config          Config
	db              *Database
	llmCmd          *exec.Cmd // This holds the command for the LLM process
	conversations   map[int64]*Conversation
	mu              sync.Mutex
	ArtifactService *artifacts.ArtifactService
}

// Config struct - Add the Theme field here
type Config struct {
	LlamaCppDir   string            `json:"llama_cpp_dir"`
	ModelsDir     string            `json:"models_dir"`
	SelectedModel string            `json:"selected_model"`
	ModelArgs     map[string]string `json:"model_args"`
	Theme         string            `json:"theme"`
}

// Conversation struct to hold the state of a single chat session
type Conversation struct {
	messages     []ChatMessage
	systemPrompt string
	httpResp     *http.Response
	mu           sync.Mutex
}

func NewApp() *App {
	return &App{
		conversations: make(map[int64]*Conversation),
	}
}

// startup is called when the app starts.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	log.Println("App startup initiated.")
	db, err := NewDatabase("chat.db")
	if err != nil {
		runtime.LogErrorf(a.ctx, "Error opening database: %s", err.Error())
		return
	}
	a.db = db
	err = a.db.Initialize()
	if err != nil {
		runtime.LogErrorf(a.ctx, "Error initializing database: %s", err.Error())
		return
	}

	userConfigDir, err := os.UserConfigDir()
	if err != nil {
		runtime.LogErrorf(a.ctx, "App Startup: Failed to get user config directory for artifacts: %v", err)
		a.ArtifactService = artifacts.NewArtifactService(nil, "")
	} else {
		artifactDataDir := filepath.Join(userConfigDir, "local-llm-chat", "artifacts")
		a.ArtifactService = artifacts.NewArtifactService(ctx, artifactDataDir)
	}

	exePath, err := os.Executable()
	if err == nil {
		configFilePath := filepath.Join(filepath.Dir(exePath), "config.json")
		runtime.LogInfof(a.ctx, "Expected config.json path: %s", configFilePath)
	} else {
		runtime.LogErrorf(a.ctx, "Could not determine executable path for config.json logging: %v", err)
	}

	settings, err := a.LoadSettings()
	if err != nil {
		runtime.LogErrorf(a.ctx, "Error loading config: %s", err.Error())
	} else {
		runtime.LogInfof(a.ctx, "Raw settings loaded from config.json: %s", settings)
	}

	var config Config
	err = json.Unmarshal([]byte(settings), &config)
	if err != nil {
		runtime.LogErrorf(a.ctx, "Error unmarshalling settings string into Config struct: %s", err.Error())
	} else {
		runtime.LogInfof(a.ctx, "Unmarshalled Config struct in startup: %+v", config)
	}

	if config.ModelArgs == nil {
		config.ModelArgs = make(map[string]string)
	}
	a.config = config
	log.Println("App startup complete.")
	runtime.LogInfof(a.ctx, "Final a.config state after startup: %+v", a.config)
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
		messages:     make([]ChatMessage, 0),
		systemPrompt: systemPrompt,
	}
	runtime.LogInfof(a.ctx, "New chat session %d created with system prompt: '%s'", id, systemPrompt)
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
		runtime.LogErrorf(a.ctx, "UpdateChatSystemPrompt: Conversation with ID %d not found in memory.", sessionID)
		return fmt.Errorf("conversation not found")
	}

	conv.mu.Lock()
	conv.systemPrompt = newSystemPrompt
	conv.mu.Unlock()

	err := a.db.UpdateChatSessionSystemPrompt(sessionID, newSystemPrompt)
	if err != nil {
		runtime.LogErrorf(a.ctx, "UpdateChatSystemPrompt: Error updating system prompt in DB for session %d: %s", sessionID, err.Error())
		return err
	}
	runtime.LogInfof(a.ctx, "UpdateChatSystemPrompt: System prompt for session %d updated to: '%s'", sessionID, newSystemPrompt)
	return nil
}

// IsLLMLoaded checks if the LLM process is currently running.
func (a *App) IsLLMLoaded() bool {
	if a.llmCmd != nil && a.llmCmd.Process != nil && a.llmCmd.ProcessState == nil {
		runtime.LogDebugf(a.ctx, "IsLLMLoaded: LLM process appears to be running (PID: %d).", a.llmCmd.Process.Pid)
		return true
	}
	runtime.LogDebugf(a.ctx, "IsLLMLoaded: LLM process is not running.")
	return false
}

// SaveSettings saves the configuration to a JSON file.
func (a *App) SaveSettings(settings string) error {
	runtime.LogInfof(a.ctx, "SaveSettings called with raw settings string: %s", settings)
	var config Config
	err := json.Unmarshal([]byte(settings), &config)
	if err != nil {
		runtime.LogErrorf(a.ctx, "Error unmarshalling settings string in SaveSettings: %s", err.Error())
		return err
	}
	runtime.LogInfof(a.ctx, "Config struct after unmarshalling in SaveSettings: %+v", config)

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
	runtime.LogInfof(a.ctx, "a.config state before saving to file: %+v", a.config)

	file, err := os.Create("config.json")
	if err != nil {
		runtime.LogErrorf(a.ctx, "Error creating config.json file: %s", err.Error())
		return err
	}
	defer file.Close()
	encoder := json.NewEncoder(file)
	encoder.SetIndent("", "  ")
	encodeErr := encoder.Encode(a.config)
	if encodeErr != nil {
		runtime.LogErrorf(a.ctx, "Error encoding config to JSON file: %s", encodeErr.Error())
		return encodeErr
	}
	runtime.LogInfo(a.ctx, "Config saved to config.json successfully.")
	return nil
}

// LoadSettings loads the configuration from a JSON file.
func (a *App) LoadSettings() (string, error) {
	file, err := os.Open("config.json")
	if err != nil {
		if os.IsNotExist(err) {
			runtime.LogInfo(a.ctx, "config.json does not exist. Initializing with default config.")
			a.config = Config{}
			a.config.Theme = "default"
			saveErr := a.SaveSettings(`{"theme":"default"}`)
			if saveErr != nil {
				runtime.LogErrorf(a.ctx, "Error saving default config.json: %s", saveErr.Error())
				return "", saveErr
			}
			return `{"theme":"default"}`, nil
		}
		runtime.LogErrorf(a.ctx, "Error opening config.json: %s", err.Error())
		return "", err
	}
	defer file.Close()

	fileContentBytes, readErr := os.ReadFile("config.json")
	if readErr != nil {
		runtime.LogErrorf(a.ctx, "Error reading content from config.json: %s", readErr.Error())
		return "", readErr
	}
	fileContent := string(fileContentBytes)
	runtime.LogInfof(a.ctx, "Content read from config.json: %s", fileContent)

	decoder := json.NewDecoder(strings.NewReader(fileContent))
	err = decoder.Decode(&a.config)
	if err != nil {
		runtime.LogErrorf(a.ctx, "Error decoding config.json content into Config struct: %s", err.Error())
		return "", err
	}
	if a.config.Theme == "" {
		a.config.Theme = "default"
		runtime.LogInfo(a.ctx, "Theme was empty, defaulted to 'default'.")
	}
	runtime.LogInfof(a.ctx, "a.config state after loading and decoding: %+v", a.config)

	configBytes, err := json.Marshal(a.config)
	if err != nil {
		runtime.LogErrorf(a.ctx, "Error marshalling a.config to JSON string for frontend: %s", err.Error())
		return "", err
	}
	runtime.LogInfof(a.ctx, "Returning config JSON string to frontend: %s", string(configBytes))
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
			runtime.LogErrorf(a.ctx, "Error accessing path %s: %v", path, err)
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
		runtime.LogInfo(a.ctx, "Terminating existing LLM server process...")
		if err := a.llmCmd.Process.Kill(); err != nil {
			runtime.LogErrorf(a.ctx, "Failed to terminate existing LLM server: %v", err)
		}
	}
	cmdParts := strings.Fields(command)
	if len(cmdParts) == 0 {
		return "", fmt.Errorf("empty command provided")
	}
	cmd := exec.Command(cmdParts[0], cmdParts[1:]...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		return "", fmt.Errorf("failed to start LLM server: %w", err)
	}
	a.llmCmd = cmd
	go func() {
		if err := cmd.Wait(); err != nil {
			runtime.LogErrorf(a.ctx, "LLM server exited with error: %v", err)
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
		runtime.LogInfo(a.ctx, "Attempting to shut down LLM server...")
		if err := a.llmCmd.Process.Signal(os.Interrupt); err != nil {
			runtime.LogErrorf(a.ctx, "Failed to send SIGTERM to LLM server: %v. Attempting to kill.", err)
			if err := a.llmCmd.Process.Kill(); err != nil {
				runtime.LogErrorf(a.ctx, "Failed to kill LLM server: %v", err)
				return err
			}
		}
	}
	return nil
}

// --- MODIFIED: Call ArtifactService.Shutdown() during app shutdown ---
func (a *App) shutdown(ctx context.Context) bool {
	a.ShutdownLLM()
	if a.ArtifactService != nil {
		a.ArtifactService.Shutdown() // Call the new Shutdown method
	}
	return false
}

// --- END MODIFIED ---

// ChatMessage struct for API communication.
type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// ChatCompletionRequest struct for API communication.
type ChatCompletionRequest struct {
	Messages []ChatMessage `json:"messages"`
	Stream   bool          `json:"stream"`
	NPredict int           `json:"N_precdict,omitempty"` // This will send as "max_tokens" in JSON
}

// LoadChatHistory loads the chat history for a given session into memory.
func (a *App) LoadChatHistory(sessionId int64) ([]ChatMessage, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	runtime.LogInfof(a.ctx, "Loading chat history for session %d", sessionId)

	history, err := a.db.GetChatMessages(sessionId)
	if err != nil {
		runtime.LogErrorf(a.ctx, "Error getting chat messages from db: %s", err.Error())
		return nil, err
	}
	runtime.LogInfof(a.ctx, "Loaded %d messages from db for session %d. Content: %+v", len(history), sessionId, history)

	session, err := a.db.GetChatSession(sessionId)
	if err != nil {
		runtime.LogErrorf(a.ctx, "Error getting chat session from db: %s", err.Error())
		return nil, err
	}

	conv, ok := a.conversations[sessionId]
	if !ok {
		conv = &Conversation{
			messages: make([]ChatMessage, 0),
		}
		a.conversations[sessionId] = conv
	}
	conv.mu.Lock()
	conv.messages = history
	conv.systemPrompt = session.SystemPrompt
	conv.mu.Unlock()
	runtime.LogInfof(a.ctx, "Updated conversation in memory for session %d. System Prompt: '%s'", sessionId, conv.systemPrompt)

	if history == nil {
		return []ChatMessage{}, nil
	}

	return history, nil
}

// HandleChat is the main entry point for handling a user's message.
func (a *App) HandleChat(sessionId int64, message string) {
	conv, ok := a.getConversation(sessionId)
	if !ok {
		runtime.LogErrorf(a.ctx, "Conversation with ID %d not found.", sessionId)
		return
	}
	conv.mu.Lock()
	defer conv.mu.Unlock()

	userMessage := ChatMessage{Role: "user", Content: message}

	var messagesForLLM []ChatMessage
	runtime.LogInfof(a.ctx, "HandleChat: System Prompt for session %d: '%s'", sessionId, conv.systemPrompt)
	if conv.systemPrompt != "" {
		messagesForLLM = append(messagesForLLM, ChatMessage{Role: "system", Content: conv.systemPrompt})
	}
	messagesForLLM = append(messagesForLLM, conv.messages...)
	messagesForLLM = append(messagesForLLM, userMessage)

	messagesJson, err := json.Marshal(messagesForLLM)
	if err != nil {
		runtime.LogErrorf(a.ctx, "HandleChat: Error marshalling messagesForLLM for logging: %v", err)
	} else {
		runtime.LogInfof(a.ctx, "HandleChat: Full message payload to LLM for session %d: %s", sessionId, string(messagesJson))
	}

	conv.messages = append(conv.messages, userMessage)
	if err := a.db.SaveChatMessage(sessionId, "user", message); err != nil {
		runtime.LogErrorf(a.ctx, "Error saving user message: %s", err.Error())
		return
	}

	reqBody := ChatCompletionRequest{Messages: messagesForLLM, Stream: true, NPredict: -1}
	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		runtime.LogErrorf(a.ctx, "Error marshalling request body: %s", err.Error())
		return
	}

	resp, err := http.Post("http://localhost:8080/v1/chat/completions", "application/json", strings.NewReader(string(jsonBody)))
	if err != nil {
		runtime.LogErrorf(a.ctx, "Error making POST request to LLM: %s", err.Error())
		return
	}
	conv.httpResp = resp

	go a.streamHandler(sessionId, resp)
}

// ChatCompletionChunk models a chunk from the LLM stream.
type ChatCompletionChunk struct {
	Choices []struct {
		Delta struct {
			Content string `json:"content"`
		} `json:"delta"`
	} `json:"choices"`
}

func (a *App) streamHandler(sessionID int64, resp *http.Response) {
	defer resp.Body.Close()
	scanner := bufio.NewScanner(resp.Body)

	conv, ok := a.getConversation(sessionID)
	if !ok {
		runtime.LogErrorf(a.ctx, "Conversation with ID %d not found.", sessionID)
		runtime.EventsEmit(a.ctx, "chat-stream", nil)
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
		defer runtime.LogDebugf(a.ctx, "Batch sender goroutine for session %d exited.", sessionID)
		for range ticker.C {
			mu.Lock()
			if currentChunkBuffer.Len() > 0 {
				chunkToSend := currentChunkBuffer.String()
				currentChunkBuffer.Reset()
				mu.Unlock()
				runtime.EventsEmit(a.ctx, "chat-stream", chunkToSend)
			} else {
				mu.Unlock()
			}
		}
	}()

	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "data: ") {
			data := strings.TrimPrefix(line, "data: ")
			if data == "[DONE]" {
				break
			}

			var chunk ChatCompletionChunk
			if err := json.Unmarshal([]byte(data), &chunk); err != nil {
				runtime.LogErrorf(a.ctx, "Error unmarshalling stream data: %s", err.Error())
				continue
			}

			if len(chunk.Choices) > 0 && chunk.Choices[0].Delta.Content != "" {
				content := chunk.Choices[0].Delta.Content

				mu.Lock()
				currentChunkBuffer.WriteString(content)
				fullResponseBuilder.WriteString(content)

				if currentChunkBuffer.Len() >= maxBatchChars {
					chunkToSend := currentChunkBuffer.String()
					currentChunkBuffer.Reset()
					mu.Unlock()
					runtime.EventsEmit(a.ctx, "chat-stream", chunkToSend)
				} else {
					mu.Unlock()
				}
			}
		}
	}

	if err := scanner.Err(); err != nil {
		runtime.LogErrorf(a.ctx, "Error reading stream for session %d: %s", sessionID, err)
	}

	mu.Lock()
	if currentChunkBuffer.Len() > 0 {
		runtime.EventsEmit(a.ctx, "chat-stream", currentChunkBuffer.String())
	}
	mu.Unlock()

	conv.mu.Lock()
	defer conv.mu.Unlock()

	assistantMessage := ChatMessage{Role: "assistant", Content: fullResponseBuilder.String()}
	conv.messages = append(conv.messages, assistantMessage)
	if err := a.db.SaveChatMessage(sessionID, "assistant", fullResponseBuilder.String()); err != nil {
		runtime.LogErrorf(a.ctx, "Error saving assistant message: %s", err.Error())
	}

	runtime.EventsEmit(a.ctx, "chat-stream", nil)
}

// StopStream stops the current chat stream.
func (a *App) StopStream(sessionID int64) {
	conv, ok := a.getConversation(sessionID)
	if !ok {
		runtime.LogErrorf(a.ctx, "Conversation with ID %d not found.", sessionID)
		return
	}
	conv.mu.Lock()
	defer conv.mu.Unlock()
	if conv.httpResp != nil && conv.httpResp.Body != nil {
		conv.httpResp.Body.Close()
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
