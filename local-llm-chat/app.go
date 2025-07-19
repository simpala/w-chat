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
	"strings"
	"sync"
	"time"

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

// Config struct - Add the Theme field here
type Config struct {
	LlamaCppDir   string            `json:"llama_cpp_dir"`
	ModelsDir     string            `json:"models_dir"`
	SelectedModel string            `json:"selected_model"`
	ModelArgs     map[string]string `json:"model_args"`
	Theme         string            `json:"theme"` // Add this line for theme persistence
}

// Conversation struct to hold the state of a single chat session
type Conversation struct {
	messages     []ChatMessage
	systemPrompt string // Add this line
	httpResp     *http.Response
	mu           sync.Mutex
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

	// Log the expected path of config.json
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
	runtime.LogInfof(a.ctx, "Final a.config state after startup: %+v", a.config)
}

// NewChat creates a new chat session.
func (a *App) NewChat(systemPrompt string) (int64, error) { // Modified signature
	a.mu.Lock()
	defer a.mu.Unlock()
	id, err := a.db.NewChatSession(systemPrompt) // Pass systemPrompt here
	if err != nil {
		return 0, err
	}
	a.conversations[id] = &Conversation{
		messages:     make([]ChatMessage, 0),
		systemPrompt: systemPrompt, // Store the system prompt in the in-memory conversation
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

	// Preserve existing ModelArgs if not provided in the new settings string
	if a.config.ModelArgs == nil {
		a.config.ModelArgs = make(map[string]string)
	}
	if config.ModelArgs == nil { // If the incoming config doesn't have ModelArgs, use existing
		config.ModelArgs = a.config.ModelArgs
	} else { // Merge or overwrite ModelArgs
		for model, args := range a.config.ModelArgs {
			if _, ok := config.ModelArgs[model]; !ok {
				config.ModelArgs[model] = args
			}
		}
	}
	a.config = config // Update the app's config
	runtime.LogInfof(a.ctx, "a.config state before saving to file: %+v", a.config)

	file, err := os.Create("config.json")
	if err != nil {
		runtime.LogErrorf(a.ctx, "Error creating config.json file: %s", err.Error())
		return err
	}
	defer file.Close()
	encoder := json.NewEncoder(file)
	encoder.SetIndent("", "  ") // Pretty print JSON
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
			a.config = Config{} // Initialize with default empty config
			// Set a default theme if config.json doesn't exist yet
			a.config.Theme = "default"
			// Save the default config to create the file
			// Note: Calling SaveSettings here will trigger its own logging.
			saveErr := a.SaveSettings(`{"theme":"default"}`)
			if saveErr != nil {
				runtime.LogErrorf(a.ctx, "Error saving default config.json: %s", saveErr.Error())
				return "", saveErr
			}
			return `{"theme":"default"}`, nil // Return default theme in JSON
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

	decoder := json.NewDecoder(strings.NewReader(fileContent)) // Use strings.NewReader for decoding
	err = decoder.Decode(&a.config)
	if err != nil {
		runtime.LogErrorf(a.ctx, "Error decoding config.json content into Config struct: %s", err.Error())
		return "", err
	}
	// Ensure Theme is set if it's missing from loaded config (e.g., old config file)
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
		return []string{}, nil // Return empty if no models directory is set
	}
	err := filepath.Walk(modelsDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			// Log the error but continue walking if possible
			runtime.LogErrorf(a.ctx, "Error accessing path %s: %v", path, err)
			return nil // Return nil to continue walking
		}
		if !info.IsDir() && (strings.HasSuffix(info.Name(), ".gguf") || strings.HasSuffix(info.Name(), ".GGUF")) {
			models = append(models, path)
		}
		return nil
	})
	if err != nil {
		// Only return error if the initial walk failed (e.g., directory doesn't exist)
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

func (a *App) shutdown(ctx context.Context) bool {
	a.ShutdownLLM()
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

	// Fetch the chat session to get the system prompt
	session, err := a.db.GetChatSession(sessionId) // Call the new GetChatSession from database.go
	if err != nil {
		runtime.LogErrorf(a.ctx, "Error getting chat session from db: %s", err.Error())
		// You might want to handle this more gracefully, e.g., proceed without a system prompt
		// if the session itself is somehow missing, but its messages are present.
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
	conv.systemPrompt = session.SystemPrompt // Assign the loaded system prompt
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
	defer conv.mu.Unlock() // Ensure mutex is unlocked at the end of the function

	userMessage := ChatMessage{Role: "user", Content: message}

	// Construct messages for the LLM API call, including the system prompt
	var messagesForLLM []ChatMessage
	runtime.LogInfof(a.ctx, "HandleChat: System Prompt for session %d: '%s'", sessionId, conv.systemPrompt) // NEW LOG
	if conv.systemPrompt != "" {
		messagesForLLM = append(messagesForLLM, ChatMessage{Role: "system", Content: conv.systemPrompt}) // Add system prompt first
	}
	messagesForLLM = append(messagesForLLM, conv.messages...) // Add existing chat history
	messagesForLLM = append(messagesForLLM, userMessage)      // Add the current user message

	// Log the full message payload being sent to the LLM
	messagesJson, err := json.Marshal(messagesForLLM)
	if err != nil {
		runtime.LogErrorf(a.ctx, "HandleChat: Error marshalling messagesForLLM for logging: %v", err)
	} else {
		runtime.LogInfof(a.ctx, "HandleChat: Full message payload to LLM for session %d: %s", sessionId, string(messagesJson)) // NEW LOG
	}

	// Update the in-memory conversation with the new user message
	conv.messages = append(conv.messages, userMessage)
	if err := a.db.SaveChatMessage(sessionId, "user", message); err != nil {
		runtime.LogErrorf(a.ctx, "Error saving user message: %s", err.Error())
		return // Return early if saving fails
	}

	// Use messagesForLLM for the request body
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
	conv.httpResp = resp // Store the http.Response for potential StopStream
	// No need to unlock/relock around this if using defer conv.mu.Unlock()

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
	defer resp.Body.Close() // Ensure the HTTP response body is closed
	scanner := bufio.NewScanner(resp.Body)

	// Retrieve the conversation. This mutex is important for protecting conv.messages.
	conv, ok := a.getConversation(sessionID)
	if !ok {
		runtime.LogErrorf(a.ctx, "Conversation with ID %d not found.", sessionID)
		// It's good practice to signal the end of the stream to the frontend
		// even if an error occurs early.
		runtime.EventsEmit(a.ctx, "chat-stream", nil)
		return
	}

	// --- Batching mechanism variables ---
	var mu sync.Mutex                       // Mutex to protect `currentChunkBuffer` as it's accessed by two goroutines
	var currentChunkBuffer strings.Builder  // Accumulates small content chunks before sending to frontend
	var fullResponseBuilder strings.Builder // Accumulates *all* content for saving to DB at the end

	// Configure batching parameters. Adjust these values to fine-tune performance vs. real-time feel.
	const batchInterval = 50 * time.Millisecond // How often to send accumulated chunks (e.g., 50ms)
	const maxBatchChars = 80                    // Send immediately if buffer grows beyond this many characters

	ticker := time.NewTicker(batchInterval) // Create a ticker for time-based flushing
	defer ticker.Stop()                     // Ensure ticker is stopped when streamHandler exits

	// --- Goroutine for Time-Based Flushing ---
	// This goroutine runs in the background and periodically sends whatever is in the buffer.
	go func() {
		defer runtime.LogDebugf(a.ctx, "Batch sender goroutine for session %d exited.", sessionID) // For debugging
		for range ticker.C {                                                                       // This loop runs every 'batchInterval'
			mu.Lock() // Lock to safely access the shared buffer
			if currentChunkBuffer.Len() > 0 {
				chunkToSend := currentChunkBuffer.String()            // Get content from buffer
				currentChunkBuffer.Reset()                            // Clear the buffer
				mu.Unlock()                                           // Unlock before emitting (emission might block)
				runtime.EventsEmit(a.ctx, "chat-stream", chunkToSend) // Send to frontend
			} else {
				mu.Unlock() // Unlock even if buffer is empty
			}
		}
	}()
	// --- End Goroutine for Time-Based Flushing ---

	// --- Main Loop: Process incoming LLM stream chunks ---
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "data: ") {
			data := strings.TrimPrefix(line, "data: ")
			if data == "[DONE]" {
				break // Signal from LLM that the stream is complete
			}

			var chunk ChatCompletionChunk
			if err := json.Unmarshal([]byte(data), &chunk); err != nil {
				runtime.LogErrorf(a.ctx, "Error unmarshalling stream data: %s", err.Error())
				continue
			}

			// Check if there's actual content in the chunk
			if len(chunk.Choices) > 0 && chunk.Choices[0].Delta.Content != "" {
				content := chunk.Choices[0].Delta.Content

				mu.Lock()                                // Lock before writing to shared buffers
				currentChunkBuffer.WriteString(content)  // Add to buffer for frontend
				fullResponseBuilder.WriteString(content) // Add to full response for DB

				// --- Character-Based Flushing ---
				// If the buffer gets large enough, send it immediately without waiting for the ticker.
				if currentChunkBuffer.Len() >= maxBatchChars {
					chunkToSend := currentChunkBuffer.String()
					currentChunkBuffer.Reset()
					mu.Unlock() // Unlock before emitting
					runtime.EventsEmit(a.ctx, "chat-stream", chunkToSend)
				} else {
					mu.Unlock() // Unlock if not sending immediately
				}
				// --- End Character-Based Flushing ---
			}
		}
	}

	// Handle any errors that occurred during scanning the response body
	if err := scanner.Err(); err != nil {
		runtime.LogErrorf(a.ctx, "Error reading stream for session %d: %s", sessionID, err)
	}

	// --- Final Flush at End of Stream ---
	// After the main loop finishes (either by breaking or scanner.Err()),
	// ensure any remaining content in the buffer is sent to the frontend.
	mu.Lock()
	if currentChunkBuffer.Len() > 0 {
		runtime.EventsEmit(a.ctx, "chat-stream", currentChunkBuffer.String())
		// No need to reset currentChunkBuffer here as the function is about to exit.
	}
	mu.Unlock()
	// --- End Final Flush ---

	// --- Save the full, accumulated response to the database ---
	conv.mu.Lock()         // Lock the conversation mutex before modifying its state
	defer conv.mu.Unlock() // Ensure conversation mutex is unlocked when leaving this block

	assistantMessage := ChatMessage{Role: "assistant", Content: fullResponseBuilder.String()}
	conv.messages = append(conv.messages, assistantMessage)
	if err := a.db.SaveChatMessage(sessionID, "assistant", fullResponseBuilder.String()); err != nil {
		runtime.LogErrorf(a.ctx, "Error saving assistant message: %s", err.Error())
	}

	// --- Signal End of Stream to Frontend --
	// Send a nil (or special empty string) to the frontend to signal the end of the stream.
	// Your JavaScript `EventsOn("chat-stream")` listener already expects `data === null` for this.
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
