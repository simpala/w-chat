package main

import (
	"embed"
	"net/http"
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"

	_ "local-llm-chat/artifacts" // Blank import for artifact types
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	userConfigDir, err := os.UserConfigDir()
	if err != nil {
		println("Error getting user config directory:", err.Error())
	}
	appDataDir := filepath.Join(userConfigDir, "local-llm-chat")

	if err := os.MkdirAll(appDataDir, 0755); err != nil {
		println("Error creating app data directory:", err.Error())
		return
	}

	dbPath := filepath.Join(appDataDir, "chat.db")
	db, err := NewDatabase(dbPath)
	if err != nil {
		println("Error creating database instance:", err.Error())
		return
	}
	if err := db.Initialize(); err != nil {
		println("Error initializing database schema:", err.Error())
		return
	}

	app := NewApp() // Create app instance

	artifactsDataDir := filepath.Join(appDataDir, "artifacts")
	if err := os.MkdirAll(artifactsDataDir, 0755); err != nil {
		println("Error creating artifacts directory for asset server:", err.Error())
		return
	}

	err = wails.Run(&options.App{
		Title:  "local-llm-chat",
		Width:  1024,
		Height: 768,
		AssetServer: &assetserver.Options{
			Assets:  assets,
			Handler: http.StripPrefix("/artifacts/", http.FileServer(http.Dir(artifactsDataDir))),
		},
		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		OnStartup:        app.startup,
		OnBeforeClose:    app.shutdown, // This calls app.shutdown(ctx)
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
