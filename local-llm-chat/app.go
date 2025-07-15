package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// App struct
type App struct {
	ctx    context.Context
	config Config
}

// Config struct
type Config struct {
	LlamaCppDir   string `json:"llama_cpp_dir"`
	ModelsDir     string `json:"models_dir"`
	SelectedModel string `json:"selected_model"`
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{}
}
// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	err := a.LoadConfig()
	if err != nil {
		// Log the error or handle it appropriately
		fmt.Println("Error loading config:", err)
	}
}

// Greet returns a greeting for the given name
func (a *App) Greet(name string) string {
	return fmt.Sprintf("Hello %s, It's show time!", name)
}

// LoadConfig loads the configuration from a JSON file
func (a *App) LoadConfig() error {
	file, err := os.Open("config.json")
	if err != nil {
		if os.IsNotExist(err) {
			// Create a default config if the file doesn't exist
			a.config = Config{}
			return a.SaveConfig()
		}
		return err
	}
	defer file.Close()

	decoder := json.NewDecoder(file)
	err = decoder.Decode(&a.config)
	if err != nil {
		return err
	}

	return nil
}

// SaveConfig saves the configuration to a JSON file
func (a *App) SaveConfig() error {
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

// GetModels returns a list of .GGUF models in the models directory
func (a *App) GetModels() ([]string, error) {
	var models []string
	err := filepath.Walk(a.config.ModelsDir, func(path string, info os.FileInfo, err error) error {
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
