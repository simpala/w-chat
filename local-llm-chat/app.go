package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/mark3labs/mcp-go/mcp"
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
	router          *Router
}

// ModelSettings struct to hold arguments for a specific model
type ModelSettings struct {
	Args string `json:"args"`
}

// Config struct - Add the Theme field here
type Config struct {
	LlamaCppDir         string                   `json:"llama_cpp_dir"`
	ModelsDir           string                   `json:"models_dir"`
	SelectedModel       string                   `json:"selected_model"`
	ModelSettings       map[string]ModelSettings `json:"model_settings"`
	Theme               string                   `json:"theme"`
	McpConnectionStates map[string]bool          `json:"mcp_connection_states"`
	ToolCallIterations  int                      `json:"tool_call_iterations"`
	ToolCallCooldown    int                      `json:"tool_call_cooldown"`
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

	if config.ModelSettings == nil {
		config.ModelSettings = make(map[string]ModelSettings)
	}
	a.config = config

	// Initialize router
	a.router = NewRouter(a)

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
		messages:     make([]ChatMessage, 0),
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

	// Ensure the ModelSettings map in the existing config is not nil
	if a.config.ModelSettings == nil {
		a.config.ModelSettings = make(map[string]ModelSettings)
	}

	// Merge the new model settings with the existing ones
	if config.ModelSettings != nil {
		for modelPath, newSettings := range config.ModelSettings {
			a.config.ModelSettings[modelPath] = newSettings
		}
	}

	// Update other fields from the incoming config
	a.config.LlamaCppDir = config.LlamaCppDir
	a.config.ModelsDir = config.ModelsDir
	a.config.SelectedModel = config.SelectedModel
	a.config.Theme = config.Theme
	a.config.ToolCallIterations = config.ToolCallIterations
	a.config.ToolCallCooldown = config.ToolCallCooldown
	// Note: McpConnectionStates is not managed here as it's transient state
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
	if a.config.ModelSettings == nil {
		a.config.ModelSettings = make(map[string]ModelSettings)
		wailsruntime.LogInfo(a.ctx, "ModelSettings was nil, initialized to empty map.")
	}
	// Set default values for new tool settings if they are not present
	if a.config.ToolCallIterations == 0 {
		a.config.ToolCallIterations = 5 // Default to 5 iterations
		wailsruntime.LogInfo(a.ctx, "ToolCallIterations was 0, defaulted to 5.")
	}
	// ToolCallCooldown can default to 0, so no check is needed unless we want a different default.

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

// getServerConfig returns the configuration for a specific MCP server
func (a *App) getServerConfig(serverName string) McpServerConfig {
	// Load the MCP configuration
	mcpConfigContent, err := a.GetMcpServers()
	if err != nil {
		wailsruntime.LogErrorf(a.ctx, "Error loading MCP servers config: %s", err.Error())
		return McpServerConfig{}
	}

	var mcpConfig McpConfig
	err = json.Unmarshal([]byte(mcpConfigContent), &mcpConfig)
	if err != nil {
		wailsruntime.LogErrorf(a.ctx, "Error unmarshalling MCP config: %s", err.Error())
		return McpServerConfig{}
	}

	// Return the specific server config
	if serverConfig, ok := mcpConfig.McpServers[serverName]; ok {
		return serverConfig
	}

	return McpServerConfig{}
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

// findExecutable searches for an executable file in a directory and its subdirectories.
func (a *App) findExecutable(rootDir, exeName string) (string, error) {
	var exePath string
	exeFullName := exeName

	env := wailsruntime.Environment(a.ctx)

	if env.Platform == "windows" {
		exeFullName += ".exe"
	}

	err := filepath.Walk(rootDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if !info.IsDir() && strings.EqualFold(info.Name(), exeFullName) {
			exePath = path
			return filepath.SkipDir // Stop searching once found
		}
		return nil
	})

	if err != nil {
		return "", err
	}
	if exePath == "" {
		return "", fmt.Errorf("executable '%s' not found in '%s' or its subdirectories", exeFullName, rootDir)
	}
	return exePath, nil
}

// LaunchLLM launches the LLM server in the background.
func (a *App) LaunchLLM(modelPath string, modelArgs string) (string, error) {
	if a.llmCmd != nil && a.llmCmd.Process != nil {
		wailsruntime.LogInfo(a.ctx, "Terminating existing LLM server process...")
		if err := a.llmCmd.Process.Kill(); err != nil {
			wailsruntime.LogErrorf(a.ctx, "Failed to terminate existing LLM server: %v", err)
		}
	}
	serverPath, err := a.findExecutable(a.config.LlamaCppDir, "llama-server")
	if err != nil {
		return "", fmt.Errorf("could not find llama-server executable: %w", err)
	}

	// Construct the command arguments
	args := []string{"-m", modelPath}
	if modelArgs != "" {
		args = append(args, strings.Fields(modelArgs)...)
	}

	cmd := exec.Command(serverPath, args...)

	userConfigDir, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("failed to get user config dir: %w", err)
	}
	artifactsDir := filepath.Join(userConfigDir, "local-llm-chat", "artifacts")
	logFilePath := filepath.Join(artifactsDir, "llm-server.log")
	logFile, err := os.Create(logFilePath)
	if err != nil {
		return "", fmt.Errorf("failed to create log file: %w", err)
	}
	cmd.Stdout = logFile
	cmd.Stderr = logFile

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
	wailsruntime.LogInfo(a.ctx, "Attempting to shut down LLM server...")
	if err := shutdownLLM(a.llmCmd); err != nil {
		wailsruntime.LogErrorf(a.ctx, "Failed to shut down LLM server: %v. Attempting to kill.", err)
		if err := a.llmCmd.Process.Kill(); err != nil {
			wailsruntime.LogErrorf(a.ctx, "Failed to kill LLM server: %v", err)
			return err
		}
	}
	return nil
}

func (a *App) shutdown(ctx context.Context) bool {
	a.ShutdownLLM()
	for _, client := range a.mcpClients {
		client.Disconnect()
	}
	if a.ArtifactService != nil {
		a.ArtifactService.Shutdown()
	}
	return false
}

// ConnectMcpClient connects to an MCP server.
func (a *App) ConnectMcpClient(serverName string, command string, args []string) error {
	a.mu.Lock()
	defer a.mu.Unlock()

	if _, ok := a.mcpClients[serverName]; ok {
		return fmt.Errorf("client for server %s is already connected", serverName)
	}

	client := mcpclient.NewMcpClient()
	if err := client.Connect(command, args); err != nil {
		return err
	}

	a.mcpClients[serverName] = client
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

// ChatMessage struct for API communication.
type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// ChatCompletionRequest struct for API communication.
type ChatCompletionRequest struct {
	Messages []ChatMessage `json:"messages"`
	Stream   bool          `json:"stream"`
	NPredict int           `json:"N_precdict,omitempty"`
	AddBos   bool          `json:"add_bos"`
}

// LoadChatHistory loads the chat history for a given session into memory.
func (a *App) LoadChatHistory(sessionId int64) ([]ChatMessage, error) {
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
			messages: make([]ChatMessage, 0),
		}
		a.conversations[sessionId] = conv
	}

	// Create a cleaned version of the history for the in-memory context.
	cleanedHistory := make([]ChatMessage, len(history))
	for i, msg := range history {
		if msg.Role == "assistant" {
			cleanedHistory[i] = ChatMessage{
				Role:    msg.Role,
				Content: stripThinkTags(msg.Content),
			}
		} else {
			cleanedHistory[i] = msg
		}
	}

	conv.mu.Lock()
	conv.messages = cleanedHistory // Use the cleaned history for the in-memory context
	conv.systemPrompt = session.SystemPrompt
	conv.mu.Unlock()
	wailsruntime.LogInfof(a.ctx, "Updated conversation in memory for session %d with cleaned history. System Prompt: '%s'", sessionId, conv.systemPrompt)

	if history == nil {
		return []ChatMessage{}, nil
	}

	// Return the original history to the frontend for display
	return history, nil
}

// HandleChat is the main entry point for handling a user's message.
func (a *App) HandleChat(sessionId int64, message string) {
	conv, ok := a.getConversation(sessionId)
	if !ok {
		wailsruntime.LogErrorf(a.ctx, "Conversation with ID %d not found.", sessionId)
		return
	}

	userMessage := ChatMessage{Role: "user", Content: message}
	conv.mu.Lock()
	conv.messages = append(conv.messages, userMessage)
	if err := a.db.SaveChatMessage(sessionId, "user", message); err != nil {
		conv.mu.Unlock()
		wailsruntime.LogErrorf(a.ctx, "Error saving user message: %s", err.Error())
		return
	}
	conv.mu.Unlock()

	// If this is the first user message, generate and set the session name
	go func() {
		if len(conv.messages) == 1 {
			newName, err := a.generateSessionName(message)
			if err != nil {
				wailsruntime.LogErrorf(a.ctx, "Error generating session name: %s", err.Error())
				return
			}
			err = a.db.UpdateChatSessionName(sessionId, newName)
			if err != nil {
				wailsruntime.LogErrorf(a.ctx, "Error updating session name: %s", err.Error())
				return
			}
			wailsruntime.EventsEmit(a.ctx, "sessionNameUpdated", map[string]interface{}{"sessionID": sessionId, "newName": newName})
		}
	}()

	// --- Two-Agent System Logic ---
	needsTools, err := a.router.NeedsTools(message)
	if err != nil {
		wailsruntime.LogErrorf(a.ctx, "Error checking for tool needs: %v", err)
		// Fallback to standard chat if router agent fails
		a.standardChat(sessionId, message)
		return
	}

	if needsTools {
		wailsruntime.LogInfo(a.ctx, "Router Agent decided tools are needed. Starting Tool-Using Agent.")
		a.toolAgentChat(sessionId)
	} else {
		wailsruntime.LogInfo(a.ctx, "Router Agent decided no tools are needed. Proceeding with standard chat.")
		a.standardChat(sessionId, message)
	}
}

func (a *App) standardChat(sessionId int64, message string) {
	conv, ok := a.getConversation(sessionId)
	if !ok {
		wailsruntime.LogErrorf(a.ctx, "Conversation with ID %d not found.", sessionId)
		return
	}

	var messagesForLLM []ChatMessage
	conv.mu.Lock()
	if conv.systemPrompt != "" {
		messagesForLLM = append(messagesForLLM, ChatMessage{Role: "system", Content: conv.systemPrompt})
	}
	messagesForLLM = append(messagesForLLM, conv.messages...)
	conv.mu.Unlock()

	// Start streaming response
	a.streamResponse(sessionId, messagesForLLM)
}

func (a *App) toolAgentChat(sessionId int64) {
	conv, ok := a.getConversation(sessionId)
	if !ok {
		wailsruntime.LogErrorf(a.ctx, "Conversation with ID %d not found.", sessionId)
		return
	}

	// 1. Get Tool Manifest
	toolManifest, err := a.router.GetToolManifest()
	if err != nil {
		wailsruntime.LogErrorf(a.ctx, "Tool Agent: Error getting tool manifest: %v", err)
		// Fallback to standard chat
		a.standardChat(sessionId, "") // Pass empty message as context is already in conv.messages
		return
	}

	// 2. Create a new system prompt for the tool agent
	toolSystemPrompt := toolManifest

	// Agentic loop
	maxIterations := a.config.ToolCallIterations
	if maxIterations <= 0 {
		maxIterations = 5 // Default to 5 if not set or set to 0/negative
	}
	for i := 0; i < maxIterations; i++ { // Use the configured limit
		var messagesForLLM []ChatMessage
		messagesForLLM = append(messagesForLLM, ChatMessage{Role: "system", Content: toolSystemPrompt})
		conv.mu.Lock()
		prunedHistory := a.pruneHistory(conv.messages)
		conv.mu.Unlock()
		messagesForLLM = append(messagesForLLM, prunedHistory...)

		// 3. Call LLM (non-streaming)
		llmResponse, err := a.makeLLMRequest(messagesForLLM, false)
		if err != nil {
			wailsruntime.LogErrorf(a.ctx, "Tool Agent: Error making LLM request: %v", err)
			return
		}

		// 4. Check for tool call by looking for a JSON object
		var toolCallJSON string
		firstBrace := strings.Index(llmResponse, "{")
		lastBrace := strings.LastIndex(llmResponse, "}")

		// Ensure that both braces are found and in the correct order
		if firstBrace != -1 && lastBrace != -1 && lastBrace > firstBrace {
			// Extract the JSON part of the response
			toolCallJSON = llmResponse[firstBrace : lastBrace+1]
		}

		if toolCallJSON != "" {
			// Save the full message (with tags) to the database first.
			if errDb := a.db.SaveChatMessage(sessionId, "assistant", llmResponse); errDb != nil {
				wailsruntime.LogErrorf(a.ctx, "Error saving assistant's tool call message: %s", errDb.Error())
			}

			// Now, create a cleaned version for the in-memory context.
			cleanedResponse := stripThinkTags(llmResponse)
			assistantMessage := ChatMessage{Role: "assistant", Content: cleanedResponse}

			// Lock the conversation to update the in-memory message list with the cleaned message.
			conv.mu.Lock()
			conv.messages = append(conv.messages, assistantMessage)
			conv.mu.Unlock()

			wailsruntime.LogInfof(a.ctx, "Tool Agent: Detected tool call: %s", toolCallJSON)

			// Execute tool call
			result, err := a.router.ExecuteToolCall(toolCallJSON)
			var toolResultContent string
			if err != nil {
				wailsruntime.LogErrorf(a.ctx, "Tool Agent: Error executing tool call: %v", err)
				toolResultContent = fmt.Sprintf("Error executing tool: %v", err)
			} else {
				// Format the result for the LLM
				var contentBuilder strings.Builder
				for _, content := range result.Content {
					if textContent, ok := content.(mcp.TextContent); ok {
						contentBuilder.WriteString(textContent.Text)
					}
				}
				toolResultContent = contentBuilder.String()
			}

			// Add tool result to conversation history.
			// WORKAROUND: Use "user" role for tool result to satisfy restrictive chat templates.
			toolMessage := ChatMessage{Role: "user", Content: toolResultContent}
			conv.mu.Lock()
			conv.messages = append(conv.messages, toolMessage)
			if err := a.db.SaveChatMessage(sessionId, "user", toolResultContent); err != nil {
				wailsruntime.LogErrorf(a.ctx, "Error saving tool message: %s", err.Error())
			}
			conv.mu.Unlock()

			// Emit the tool result to the frontend so the user sees it
			wailsruntime.EventsEmit(a.ctx, "chat-stream", toolResultContent)

			// Continue the loop to send the tool result back to the LLM
			continue
		}

		// 5. If no tool call, this is the final answer. Stream it.
		wailsruntime.LogInfo(a.ctx, "Tool Agent: No more tool calls detected. Generating final answer via streaming.")

		// The conversation history is already up-to-date with all the tool calls and results.
		// We can now call the standard streaming function to get the final, consolidated response.
		var finalMessages []ChatMessage
		finalMessages = append(finalMessages, ChatMessage{Role: "system", Content: toolSystemPrompt})
		conv.mu.Lock()
		prunedHistory = a.pruneHistory(conv.messages)
		conv.mu.Unlock()
		finalMessages = append(finalMessages, prunedHistory...)

		a.streamResponse(sessionId, finalMessages)
		return // End the agentic loop
	}

	// Handle case where max iterations are exceeded
	wailsruntime.LogWarningf(a.ctx, "Tool Agent: Exceeded max iterations (%d). Ending loop.", maxIterations)

	// Create a user-friendly error message
	errorMessage := fmt.Sprintf("The assistant reached the maximum number of tool calls (%d) without providing a final answer. The task has been stopped.", maxIterations)

	// Add the error message to the conversation history
	assistantMessage := ChatMessage{Role: "assistant", Content: errorMessage}
	conv.mu.Lock()
	conv.messages = append(conv.messages, assistantMessage)
	if err := a.db.SaveChatMessage(sessionId, "assistant", errorMessage); err != nil {
		wailsruntime.LogErrorf(a.ctx, "Error saving max iterations error message: %s", err.Error())
	}
	conv.mu.Unlock()

	// Send the error message to the frontend
	wailsruntime.EventsEmit(a.ctx, "chat-stream", errorMessage)

	// Signal the end of the stream
	wailsruntime.EventsEmit(a.ctx, "chat-stream", nil)
}

func (a *App) pruneHistory(history []ChatMessage) []ChatMessage {
	const maxHistory = 8 // Keep the last 4 pairs of assistant/user tool messages
	if len(history) > maxHistory {
		// Keep the original user query (index 0) and the most recent `maxHistory` messages
		prunedHistory := []ChatMessage{history[0]}
		prunedHistory = append(prunedHistory, history[len(history)-maxHistory:]...)
		return prunedHistory
	}
	return history
}

// makeLLMRequest sends a request to the LLM and returns the complete response content.
func (a *App) makeLLMRequest(messages []ChatMessage, stream bool) (string, error) {
	reqBody := ChatCompletionRequest{Messages: messages, Stream: stream, NPredict: -1, AddBos: false}
	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("error marshalling request body: %w", err)
	}

	resp, err := http.Post("http://localhost:8080/v1/chat/completions", "application/json", bytes.NewReader(jsonBody))
	if err != nil {
		return "", fmt.Errorf("error making POST request to LLM: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("error reading response body: %w", err)
	}

	// Assuming the non-streaming response has a similar structure to the streaming one
	// and we can just grab the content from the first choice.
	var result struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}

	if err := json.Unmarshal(body, &result); err != nil {
		return "", fmt.Errorf("error unmarshalling LLM response: %w", err)
	}

	if len(result.Choices) > 0 {
		return result.Choices[0].Message.Content, nil
	}

	return "", fmt.Errorf("no content in LLM response")
}

// streamResponse handles sending a request to the LLM and streaming the response.
func (a *App) streamResponse(sessionID int64, messages []ChatMessage) {
	conv, ok := a.getConversation(sessionID)
	if !ok {
		wailsruntime.LogErrorf(a.ctx, "Conversation with ID %d not found.", sessionID)
		return
	}

	reqBody := ChatCompletionRequest{Messages: messages, Stream: true, NPredict: -1, AddBos: false}
	jsonBody, err := json.Marshal(reqBody)
	if err != nil {
		wailsruntime.LogErrorf(a.ctx, "Error marshalling request body: %s", err.Error())
		return
	}

	resp, err := http.Post("http://localhost:8080/v1/chat/completions", "application/json", strings.NewReader(string(jsonBody)))
	if err != nil {
		wailsruntime.LogErrorf(a.ctx, "Error making POST request to LLM: %s", err.Error())
		return
	}
	conv.mu.Lock()
	conv.httpResp = resp
	conv.mu.Unlock()

	go a.streamHandler(sessionID, resp)
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

	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "data: ") {
			data := strings.TrimPrefix(line, "data: ")
			if data == "[DONE]" {
				break
			}

			var chunk ChatCompletionChunk
			if err := json.Unmarshal([]byte(data), &chunk); err != nil {
				wailsruntime.LogErrorf(a.ctx, "Error unmarshalling stream data: %s", err.Error())
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
					wailsruntime.EventsEmit(a.ctx, "chat-stream", chunkToSend)
				} else {
					mu.Unlock()
				}
			}
		}
	}

	if err := scanner.Err(); err != nil {
		wailsruntime.LogErrorf(a.ctx, "Error reading stream for session %d: %s", sessionID, err)
	}

	// Flush any remaining text in the buffer
	mu.Lock()
	if currentChunkBuffer.Len() > 0 {
		wailsruntime.EventsEmit(a.ctx, "chat-stream", currentChunkBuffer.String())
	}
	mu.Unlock()

	// Get the complete response
	fullResponse := fullResponseBuilder.String()

	// Save the full message (with tags) to the database first.
	if err := a.db.SaveChatMessage(sessionID, "assistant", fullResponse); err != nil {
		wailsruntime.LogErrorf(a.ctx, "Error saving assistant message: %s", err.Error())
	}

	// Now, create a cleaned version for the in-memory context.
	cleanedResponse := stripThinkTags(fullResponse)
	assistantMessage := ChatMessage{Role: "assistant", Content: cleanedResponse}

	// Lock the conversation to update the in-memory message list with the cleaned message.
	conv.mu.Lock()
	conv.messages = append(conv.messages, assistantMessage)
	conv.mu.Unlock()

	// Finally, send the end-of-stream signal to the frontend
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

// stripThinkTags removes <think> tags and surrounding whitespace from a string.
func stripThinkTags(content string) string {
	reThink := regexp.MustCompile(`(?s)<think>.*?</think>`)
	strippedContent := reThink.ReplaceAllString(content, "")
	// Also remove any leading/trailing whitespace that might be left
	return strings.TrimSpace(strippedContent)
}

func (a *App) generateSessionName(message string) (string, error) {
	// Strip <think> tags from the message
	reThink := regexp.MustCompile(`(?s)<think>.*?</think>`)
	cleanedMessage := reThink.ReplaceAllString(message, "")

	// Strip <|...|> tags from the message
	reChannel := regexp.MustCompile(`(?s)<\|.*?\|>`)
	cleanedMessage = reChannel.ReplaceAllString(cleanedMessage, "")

	// Also remove any leading/trailing whitespace that might be left
	cleanedMessage = strings.TrimSpace(cleanedMessage)

	// Use the cleaned message, truncated to 20 characters, as the session name.
	if len(cleanedMessage) > 20 {
		cleanedMessage = cleanedMessage[:20]
	}
	return cleanedMessage, nil
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
