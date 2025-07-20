package artifacts

import (
	"time"
)

// Artifact represents a piece of content (image, video, tool notification, etc.)
// generated or uploaded within a chat session.
type Artifact struct {
	ID           string                 `json:"id"`            // Unique identifier for the artifact
	SessionID    string                 `json:"session_id"`    // ID of the chat session it belongs to
	Type         ArtifactType           `json:"type"`          // Type of the artifact (e.g., "IMAGE", "VIDEO")
	ContentPath  string                 `json:"content_path"`  // File path on disk where content is stored (if applicable)
	URL          string                 `json:"url"`           // URL for frontend to access the content via asset server
	Metadata     map[string]interface{} `json:"metadata"`      // Additional metadata (e.g., file_name, size_bytes, message)
	Timestamp    time.Time              `json:"timestamp"`     // When the artifact was created
	IsPersistent bool                   `json:"is_persistent"` // Whether the artifact should persist across sessions
}

// ArtifactType defines the type of content an artifact represents.
type ArtifactType string

const (
	TypeImage            ArtifactType = "IMAGE"
	TypeVideo            ArtifactType = "VIDEO"
	TypeToolNotification ArtifactType = "TOOL_NOTIFICATION"
)
