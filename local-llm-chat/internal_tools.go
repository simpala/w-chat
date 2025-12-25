
package main

import (
	"encoding/json"
	"fmt"
	"local-llm-chat/artifacts"
)

// InternalTool represents a tool that is built into the application
type InternalTool struct {
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	InputSchema map[string]interface{} `json:"input_schema"`
}

// GetInternalTools returns a list of all internal tools
func GetInternalTools() []InternalTool {
	return []InternalTool{
		{
			Name:        "create_html_viewer",
			Description: "Creates a new, empty HTML viewer artifact in the side panel. Returns the unique ID of the new artifact.",
			InputSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"name": map[string]interface{}{
						"type":        "string",
						"description": "The title of the HTML viewer artifact.",
					},
				},
				"required": []string{"name"},
			},
		},
		{
			Name:        "update_html_viewer",
			Description: "Updates the content of an existing HTML viewer artifact with new HTML.",
			InputSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"artifact_id": map[string]interface{}{
						"type":        "string",
						"description": "The ID of the viewer to update.",
					},
					"html_content": map[string]interface{}{
						"type":        "string",
						"description": "A string of the new HTML to display.",
					},
				},
				"required": []string{"artifact_id", "html_content"},
			},
		},
	}
}

// ExecuteInternalTool executes an internal tool
func (a *App) ExecuteInternalTool(sessionID int64, toolName string, arguments map[string]interface{}) (map[string]interface{}, error) {
	switch toolName {
	case "create_html_viewer":
		name, ok := arguments["name"].(string)
		if !ok {
			return nil, fmt.Errorf("invalid 'name' argument")
		}
		artifact, err := a.ArtifactService.AddArtifact(fmt.Sprintf("%d", sessionID), artifacts.TypeHTMLViewer, name, "")
		if err != nil {
			return nil, err
		}
		return map[string]interface{}{"artifact_id": artifact.ID}, nil
	case "update_html_viewer":
		artifactID, ok := arguments["artifact_id"].(string)
		if !ok {
			return nil, fmt.Errorf("invalid 'artifact_id' argument")
		}
		htmlContent, ok := arguments["html_content"].(string)
		if !ok {
			return nil, fmt.Errorf("invalid 'html_content' argument")
		}
		err := a.ArtifactService.UpdateHTMLViewerArtifact(artifactID, htmlContent)
		if err != nil {
			return nil, err
		}
		return map[string]interface{}{"status": "success"}, nil
	default:
		return nil, fmt.Errorf("unknown internal tool: %s", toolName)
	}
}
