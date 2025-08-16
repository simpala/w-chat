// Package artifacts defines the data structures and core service for managing
// generated content like images, videos, and tool notifications in the application.
package artifacts // <--- ENSURE THIS IS 'package artifacts'

import (
	"context"
	"encoding/base64"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// ArtifactService manages the lifecycle of artifacts within the application.
// It handles storage of artifact metadata (in memory) and content (on disk).
type ArtifactService struct {
	artifacts    map[string]*Artifact // In-memory store for artifact metadata
	mu           sync.RWMutex         // Mutex to protect access to the artifacts map
	artifactsDir string               // Base directory where artifact content files are stored
	// metadataPath string            // REMOVED: Metadata path for persistence
	ctx context.Context // Wails runtime context for event emission
}

// NewArtifactService creates a new instance of the ArtifactService.
// It requires the base directory for storing artifact content and the Wails runtime context.
func NewArtifactService(ctx context.Context, artifactsDir string) *ArtifactService {
	// Ensure the base artifacts directory exists.
	if err := os.MkdirAll(artifactsDir, 0755); err != nil {
		log.Printf("ArtifactService: Error creating artifacts directory %s: %v", artifactsDir, err)
		// By returning a service anyway, we allow the app to run but log the error.
		// Operations requiring the directory will fail gracefully.
	} else {
		log.Printf("ArtifactService: Artifact content will be stored in: %s", artifactsDir)
	}

	service := &ArtifactService{
		artifacts:    make(map[string]*Artifact),
		artifactsDir: artifactsDir,
		// metadataPath: filepath.Join(artifactsDir, "artifacts_metadata.json"), // REMOVED: Define metadata file path
		ctx: ctx,
	}

	// REMOVED: load existing artifacts metadata on startup
	// service.loadArtifactsMetadata()

	return service
}

// REMOVED: saveArtifactsMetadata function definition entirely.
// func (s *ArtifactService) saveArtifactsMetadata() { ... }

// REMOVED: loadArtifactsMetadata function definition entirely.
// func (s *ArtifactService) loadArtifactsMetadata() { ... }

// AddArtifact creates and stores a new artifact.
// It assumes contentBase64 is either actual base64 encoded string data (for files)
// or simple text content (for tool notifications, etc.).
func (s *ArtifactService) AddArtifact(sessionID string, artifactType ArtifactType, name string, contentBase64 string) (*Artifact, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	id := uuid.New().String()
	// Use a clean filename for the stored artifact. Append a UUID for uniqueness.
	storedFileName := fmt.Sprintf("%s_%s_%s", sessionID, id, filepath.Base(name))
	contentPath := "" // Initialize as empty, only set if it's a file type

	var contentBytes []byte
	// For IMAGE or VIDEO types, decode the base64 string and write to disk.
	if artifactType == TypeImage || artifactType == TypeVideo {
		decoded, decodeErr := base64.StdEncoding.DecodeString(contentBase64)
		if decodeErr != nil {
			log.Printf("ArtifactService: AddArtifact: Failed to decode artifact content (invalid base64 for type %s): %v", artifactType, decodeErr)
			return nil, fmt.Errorf("failed to decode artifact content (invalid base64 for type %s): %w", artifactType, decodeErr)
		}
		contentBytes = decoded
		contentPath = filepath.Join(s.artifactsDir, storedFileName) // Set contentPath for file types

		// Ensure the directory exists before writing
		if err := os.MkdirAll(s.artifactsDir, 0755); err != nil {
			log.Printf("ArtifactService: AddArtifact: Failed to ensure artifacts directory exists: %v", err)
			return nil, fmt.Errorf("failed to ensure artifacts directory exists: %w", err)
		}

		log.Printf("ArtifactService: AddArtifact: Attempting to write file to: %s (Size: %d bytes)", contentPath, len(contentBytes))
		if err := os.WriteFile(contentPath, contentBytes, 0644); err != nil {
			log.Printf("ArtifactService: AddArtifact: FAILED to write artifact content to disk at '%s': %v", contentPath, err)
			return nil, fmt.Errorf("failed to write artifact content to disk at '%s': %w", contentPath, err)
		}
		log.Printf("ArtifactService: AddArtifact: Successfully wrote file to: %s", contentPath)

	} else {
		// For other types like TOOL_NOTIFICATION, content is not a file, so no file is written.
		// contentPath remains empty.
		contentBytes = []byte(contentBase64) // Store the notification message as bytes for size
	}

	// The URL must match the AssetServer's prefix + filename for file-based artifacts
	// For non-file artifacts, URL will be empty.
	artifactURL := ""
	if contentPath != "" {
		artifactURL = fmt.Sprintf("/artifacts/%s", storedFileName)
	}

	// Populate metadata based on type
	metadata := make(map[string]interface{})
	metadata["file_name"] = name // Critical for frontend rendering (for file types)
	if artifactType == TypeImage || artifactType == TypeVideo {
		metadata["size_bytes"] = len(contentBytes)
	} else if artifactType == TypeToolNotification {
		metadata["message"] = contentBase64 // The 'contentBase64' param is the message for this type
	}

	artifact := &Artifact{
		ID:           id,
		SessionID:    sessionID,
		Type:         artifactType,
		ContentPath:  contentPath,
		URL:          artifactURL,
		Metadata:     metadata,
		Timestamp:    time.Now().Format(time.RFC3339),
		IsPersistent: false, // Set to false when not using persistence
	}

	s.artifacts[id] = artifact // Store in memory only for current session
	log.Printf("ArtifactService: Added new artifact: %+v", artifact)

	// REMOVED: s.saveArtifactsMetadata() // Removed call to save metadata

	// Notify the frontend that a new artifact has been added.
	if s.ctx != nil {
		runtime.EventsEmit(s.ctx, "artifactAdded", artifact)
	}

	return artifact, nil
}

// DeleteArtifact removes an artifact by its ID and cleans up its associated file.
func (s *ArtifactService) DeleteArtifact(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	artifact, ok := s.artifacts[id]
	if !ok {
		return fmt.Errorf("artifact with ID %s not found", id)
	}

	// Delete the actual content file from disk if ContentPath is set.
	if artifact.ContentPath != "" {
		if err := os.Remove(artifact.ContentPath); err != nil {
			log.Printf("ArtifactService: Error deleting artifact file %s: %v", artifact.ContentPath, err)
			// Don't return error here, just log, so metadata can still be removed.
			// In a production app, you might want more robust error handling or retry logic.
		}
	}

	delete(s.artifacts, id)
	log.Printf("ArtifactService: Deleted artifact: ID=%s", id)

	// REMOVED: s.saveArtifactsMetadata() // Removed call to save metadata

	// Notify the frontend of the deletion.
	if s.ctx != nil {
		runtime.EventsEmit(s.ctx, "artifactDeleted", id)
	}

	return nil
}

// ListArtifacts returns a slice of all artifacts for a given session,
// sorted by timestamp.
func (s *ArtifactService) ListArtifacts(sessionID string) ([]*Artifact, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var result []*Artifact
	for _, artifact := range s.artifacts {
		// In the main app, you might choose to filter by IsPersistent here
		// For now, we'll list all for the session.
		if artifact.SessionID == sessionID {
			result = append(result, artifact)
		}
	}

	// Sort by timestamp so they appear in chronological order.
	sort.Slice(result, func(i, j int) bool {
		return result[i].Timestamp < result[j].Timestamp
	})

	log.Printf("ArtifactService: Listed %d artifacts for session %s", len(result), sessionID)
	return result, nil
}

// CleanupNonPersistentArtifacts iterates through all artifacts for the given session
// and removes any that are not marked as persistent. This is intended to be
// called at the end of a session or on application exit.
func (s *ArtifactService) CleanupNonPersistentArtifacts(sessionID string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	var idsToDelete []string
	for id, artifact := range s.artifacts {
		// Only cleanup if it's for the current session and not persistent
		if artifact.SessionID == sessionID && !artifact.IsPersistent {
			idsToDelete = append(idsToDelete, id)
		}
	}

	for _, id := range idsToDelete {
		// Call DeleteArtifact's core logic directly to avoid re-locking mutex
		artifact := s.artifacts[id]
		if artifact.ContentPath != "" {
			if err := os.Remove(artifact.ContentPath); err != nil {
				log.Printf("ArtifactService: Error deleting non-persistent artifact file %s: %v", artifact.ContentPath, err)
			}
		}
		delete(s.artifacts, id)
		log.Printf("ArtifactService: Cleaned up non-persistent artifact: ID=%s", id)

		// Notify frontend if needed (e.g., if panel is open during cleanup)
		if s.ctx != nil {
			runtime.EventsEmit(s.ctx, "artifactDeleted", id)
		}
	}
	// Removed s.saveArtifactsMetadata() call here, as per previous agreement.
}

// Shutdown is a method to be called when the application is shutting down.
// It ensures that artifact metadata is saved.
func (s *ArtifactService) Shutdown() {
	log.Println("ArtifactService: Shutting down. (No explicit metadata save here)")
	log.Println("ArtifactService: Shutdown complete.")
}

// Helper function for min (Go 1.20+)
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
