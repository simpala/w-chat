// Package artifacts defines the data structures and core service for managing
// generated content like images, videos, and tool notifications in the application.
package artifacts

import "time"

// ArtifactType is a string constant representing the type of an artifact.
type ArtifactType string

const (
	// TypeImage represents an artifact that is an image.
	TypeImage ArtifactType = "IMAGE"
	// TypeVideo represents an artifact that is a video.
	TypeVideo ArtifactType = "VIDEO"
	// TypeToolNotification represents a simple text notification from a tool.
	TypeToolNotification ArtifactType = "TOOL_NOTIFICATION"

	// --- Future placeholder types ---
	// TypeCode represents a block of generated code.
	// TypeCode ArtifactType = "CODE"
	// TypeGeneratedHTML represents a snippet of generated HTML for rendering.
	// TypeGeneratedHTML ArtifactType = "GENERATED_HTML"
	// TypeDiffusionTextImage represents a text-to-image diffusion model result.
	// TypeDiffusionTextImage ArtifactType = "DIFFUSION_TEXT_IMAGE"
)

// Artifact represents a piece of generated, non-textual content.
// Its metadata is stored in memory, while its content may be stored on disk.
type Artifact struct {
	// ID is the unique identifier for the artifact (UUID).
	ID string `json:"id"`

	// SessionID is the identifier for the chat session this artifact belongs to.
	SessionID string `json:"sessionID"`

	// Type indicates the kind of content the artifact holds.
	Type ArtifactType `json:"type"`

	// ContentPath is the absolute file path to the artifact's content on disk.
	// This is used for content that is too large to hold in memory, like images or videos.
	// For purely metadata-based artifacts (e.g., TOOL_NOTIFICATION), this may be empty.
	ContentPath string `json:"contentPath"`

	// Metadata is a flexible map for storing type-specific data.
	// Examples:
	// - For CODE: {"language": "python", "lines": 150}
	// - For VIDEO: {"duration": "2:35"}
	// - For TOOL_NOTIFICATION: {"message": "Tool execution started..."}
	Metadata map[string]interface{} `json:"metadata"`

	// Timestamp is the time the artifact was created.
	Timestamp time.Time `json:"timestamp"`

	// IsPersistent indicates whether the artifact should survive session reloads.
	// Persistent artifacts (and their associated files) are not cleaned up automatically.
	// Non-persistent artifacts are cleaned up when the session ends.
	IsPersistent bool `json:"isPersistent"`
}
