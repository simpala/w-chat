package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App struct
type App struct {
	ctx           context.Context
	config        Config
	db            *Database
	llmCmd        *exec.Cmd
	conversations map[int64]*Conversation
	mu            sync.Mutex
}

// Config struct
type Config struct {
	LlamaCppDir   string            `json:"llama_cpp_dir"`
	ModelsDir     string            `json:"models_dir"`
	SelectedModel string            `json:"selected_model"`
	ModelArgs     map[string]string `json:"model_args"`
}

// Conversation struct to hold the state of a single chat session
type Conversation struct {
	messages []ChatMessage
	httpResp *http.Response
	mu       sync.Mutex
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{
		conversations: make(map[int64]*Conversation),
	}
}

// startup is called when the app starts.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
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
	settings, err := a.LoadSettings()
	if err != nil {
		runtime.LogErrorf(a.ctx, "Error loading config: %s", err.Error())
	}
	var config Config
	err = json.Unmarshal([]byte(settings), &config)
	if err != nil {
		runtime.LogErrorf(a.ctx, "Error unmarshalling settings: %s", err.Error())
	}
	if config.ModelArgs == nil {
		config.ModelArgs = make(map[string]string)
	}
	a.config = config
}

// NewChat creates a new chat session.
func (a *App) NewChat() (int64, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	id, err := a.db.NewChatSession()
	if err != nil {
		return 0, err
	}
	a.conversations[id] = &Conversation{
		messages: make([]ChatMessage, 0),
	}
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

// SaveSettings saves the configuration to a JSON file.
func (a *App) SaveSettings(settings string) error {
	var config Config
	err := json.Unmarshal([]byte(settings), &config)
	if err != nil {
		return err
	}
	if a.config.ModelArgs == nil {
		a.config.ModelArgs = make(map[string]string)
	}
	for model, args := range a.config.ModelArgs {
		if _, ok := config.ModelArgs[model]; !ok {
			config.ModelArgs[model] = args
		}
	}
	a.config = config
	file, err := os.Create("config.json")
	if err != nil {
		return err
	}
	defer file.Close()
	encoder := json.NewEncoder(file)
	return encoder.Encode(a.config)
}

// LoadSettings loads the configuration from a JSON file.
func (a *App) LoadSettings() (string, error) {
	file, err := os.Open("config.json")
	if err != nil {
		if os.IsNotExist(err) {
			a.config = Config{}
			err := a.SaveSettings("{}")
			if err != nil {
				return "", err
			}
			return "{}", nil
		}
		return "", err
	}
	defer file.Close()
	decoder := json.NewDecoder(file)
	err = decoder.Decode(&a.config)
	if err != nil {
		return "", err
	}
	configBytes, err := json.Marshal(a.config)
	return string(configBytes), err
}

// GetModels returns a list of .GGUF models in the models directory.
func (a *App) GetModels() ([]string, error) {
	var models []string
	modelsDir := a.config.ModelsDir
	err := filepath.Walk(modelsDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if !info.IsDir() && (strings.HasSuffix(info.Name(), ".gguf") || strings.HasSuffix(info.Name(), ".GGUF")) {
			models = append(models, path)
		}
		return nil
	})
	return models, err
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

// ShutdownLLM attempts to gracefully shut down the LLM server.
func (a *App) shutdown(ctx context.Context) bool {
	if a.llmCmd != nil && a.llmCmd.Process != nil {
		runtime.LogInfo(a.ctx, "Attempting to shut down LLM server...")
		if err := a.llmCmd.Process.Signal(os.Interrupt); err != nil {
			runtime.LogErrorf(a.ctx, "Failed to send SIGTERM to LLM server: %v. Attempting to kill.", err)
			if err := a.llmCmd.Process.Kill(); err != nil {
				runtime.LogErrorf(a.ctx, "Failed to kill LLM server: %v", err)
			}
		}
	}
	return false
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
	runtime.LogInfof(a.ctx, "Loaded %d messages from db for session %d", len(history), sessionId)

	conv, ok := a.conversations[sessionId]
	if !ok {
		conv = &Conversation{
			messages: make([]ChatMessage, 0),
		}
		a.conversations[sessionId] = conv
	}
	conv.mu.Lock()
	conv.messages = history
	conv.mu.Unlock()
	runtime.LogInfof(a.ctx, "Updated conversation in memory for session %d", sessionId)

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

	userMessage := ChatMessage{Role: "user", Content: message}
	conv.messages = append(conv.messages, userMessage)
	if err := a.db.SaveChatMessage(sessionId, "user", message); err != nil {
		runtime.LogErrorf(a.ctx, "Error saving user message: %s", err.Error())
		conv.mu.Unlock()
		return
	}

	reqBody := ChatCompletionRequest{Messages: conv.messages, Stream: true}
	conv.mu.Unlock()

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
	conv.mu.Lock()
	conv.httpResp = resp
	conv.mu.Unlock()

	go a.streamHandler(sessionId, resp)
}

// streamHandler processes the SSE stream from the LLM.
func (a *App) streamHandler(sessionID int64, resp *http.Response) {
	defer resp.Body.Close()
	scanner := bufio.NewScanner(resp.Body)
	var fullResponse strings.Builder

	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "data: ") {
			data := strings.TrimPrefix(line, "data: ")
			if data == "[DONE]" {
				break
			}

			var result map[string]interface{}
			if err := json.Unmarshal([]byte(data), &result); err != nil {
				runtime.LogErrorf(a.ctx, "Error unmarshalling stream data: %s", err.Error())
				continue
			}

			choices, ok := result["choices"].([]interface{})
			if !ok || len(choices) == 0 {
				continue
			}
			firstChoice, ok := choices[0].(map[string]interface{})
			if !ok {
				continue
			}
			delta, ok := firstChoice["delta"].(map[string]interface{})
			if !ok {
				continue
			}
			content, ok := delta["content"].(string)
			if !ok {
				continue
			}

			fullResponse.WriteString(content)
			runtime.EventsEmit(a.ctx, "chat-stream", content)
		}
	}

	if err := scanner.Err(); err != nil {
		runtime.LogErrorf(a.ctx, "Error reading stream for session %d: %s", sessionID, err)
	}

	conv, ok := a.getConversation(sessionID)
	if !ok {
		runtime.LogErrorf(a.ctx, "Conversation with ID %d not found.", sessionID)
		return
	}
	conv.mu.Lock()
	defer conv.mu.Unlock()
	re := regexp.MustCompile(`<think>([\s\S]*?)<\/think>`)
	cleanResponse := re.ReplaceAllString(fullResponse.String(), "")
	assistantMessage := ChatMessage{Role: "assistant", Content: cleanResponse}
	conv.messages = append(conv.messages, assistantMessage)
	if err := a.db.SaveChatMessage(sessionID, "assistant", cleanResponse); err != nil {
		runtime.LogErrorf(a.ctx, "Error saving assistant message: %s", err.Error())
	}

	runtime.EventsEmit(a.ctx, "chat-stream", nil) // Signal end of stream
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
