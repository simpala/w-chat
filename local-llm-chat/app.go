package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// App struct
type App struct {
	ctx    context.Context
	config Config
	db     *Database
	llmCmd *exec.Cmd // Add this line to store the LLM command
}

// Config struct
type Config struct {
	LlamaCppDir   string            `json:"llama_cpp_dir"`
	ModelsDir     string            `json:"models_dir"`
	SelectedModel string            `json:"selected_model"`
	ModelArgs     map[string]string `json:"model_args"`
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{}
}
// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	db, err := NewDatabase("chat.db")
	if err != nil {
		fmt.Println("Error opening database:", err)
		return
	}
	a.db = db
	err = a.db.Initialize()
	if err != nil {
		fmt.Println("Error initializing database:", err)
		return
	}
	settings, err := a.LoadSettings()
	if err != nil {
		// Log the error or handle it appropriately
		fmt.Println("Error loading config:", err)
	}
	var config Config
	err = json.Unmarshal([]byte(settings), &config)
	if err != nil {
		fmt.Println("Error unmarshalling settings:", err)
	}
	if config.ModelArgs == nil {
		config.ModelArgs = make(map[string]string)
	}
	a.config = config
}

// NewChat creates a new chat session
func (a *App) NewChat() (int64, error) {
	return a.db.NewChatSession()
}

// LoadChatSessions loads all chat sessions
func (a *App) LoadChatSessions() ([]ChatSession, error) {
	return a.db.GetChatSessions()
}

// DeleteChatSession deletes a chat session
func (a *App) DeleteChatSession(id int64) error {
	return a.db.DeleteChatSession(id)
}

// SaveSettings saves the configuration to a JSON file
func (a *App) SaveSettings(settings string) error {
	var config Config
	err := json.Unmarshal([]byte(settings), &config)
	if err != nil {
		return err
	}
	if a.config.ModelArgs == nil {
		a.config.ModelArgs = make(map[string]string)
	}
	// Preserve existing model args
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
	err = encoder.Encode(a.config)
	if err != nil {
		return err
	}

	return nil
}

// LoadSettings loads the configuration from a JSON file
func (a *App) LoadSettings() (string, error) {
	file, err := os.Open("config.json")
	if err != nil {
		if os.IsNotExist(err) {
			// Create a default config if the file doesn't exist
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
	if err != nil {
		return "", err
	}

	return string(configBytes), nil
}

// GetModels returns a list of .GGUF models in the models directory
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
	if err != nil {
		return nil, err
	}
	return models, nil
}

// LaunchLLM launches the LLM server in the background
func (a *App) LaunchLLM(command string) (string, error) {
	cmdParts := strings.Fields(command)
	if len(cmdParts) == 0 {
		return "", fmt.Errorf("empty command provided")
	}

	// If an LLM command is already running, try to kill it first
	if a.llmCmd != nil && a.llmCmd.Process != nil {
		fmt.Println("Terminating existing LLM server process...")
		err := a.llmCmd.Process.Kill()
		if err != nil {
			fmt.Printf("Failed to terminate existing LLM server: %v\n", err)
		}
		a.llmCmd = nil // Clear the reference
	}

	cmd := exec.Command(cmdParts[0], cmdParts[1:]...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	err := cmd.Start()
	if err != nil {
		return "", fmt.Errorf("failed to start LLM server: %w", err)
	}

	a.llmCmd = cmd // Store the command

	// Detach the process by not waiting for it, but keep the reference
	go func() {
		err := cmd.Wait()
		if err != nil {
			fmt.Printf("LLM server exited with error: %v\n", err)
		}
		a.llmCmd = nil // Clear the reference when it exits
	}()

	return "LLM server launched successfully!", nil
}

// ShutdownLLM attempts to gracefully shut down the LLM server
func (a *App) ShutdownLLM() {
	if a.llmCmd != nil && a.llmCmd.Process != nil {
		fmt.Println("Attempting to shut down LLM server...")
		// Send SIGTERM first for graceful shutdown
		err := a.llmCmd.Process.Signal(os.Interrupt)
		if err != nil {
			fmt.Printf("Failed to send SIGTERM to LLM server: %v. Attempting to kill.\n", err)
			// If SIGTERM fails, force kill
			err = a.llmCmd.Process.Kill()
			if err != nil {
				fmt.Printf("Failed to kill LLM server: %v\n", err)
			}
		}
		// Wait a short period for the process to exit after signal
		go func() {
			_ = a.llmCmd.Wait() // Wait for it to exit
			a.llmCmd = nil
		}()
	}
}

// shutdown is called when the app is shutting down
func (a *App) shutdown(ctx context.Context) bool {
	a.ShutdownLLM()
	return false // Allow the application to close
}
