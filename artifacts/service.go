// Package artifacts defines the data structures and core service for managing
// generated content like images, videos, and tool notifications in the application.
package artifacts

import (
	"context"
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
// NOTE: For true persistence across application restarts, the artifact metadata
// would need to be saved to a database (e.g., SQLite). Currently, only the
// content files of 'IsPersistent' artifacts survive restarts; the metadata does not.
type ArtifactService struct {
	artifacts    map[string]*Artifact
	mu           sync.RWMutex
	artifactsDir string
	ctx          context.Context
}

// NewArtifactService creates a new instance of the ArtifactService.
// It requires the base directory for storing artifact content and the Wails runtime context.
func NewArtifactService(ctx context.Context, artifactsDir string) *ArtifactService {
	// Ensure the base artifacts directory exists.
	if err := os.MkdirAll(artifactsDir, 0755); err != nil {
		log.Printf("Error creating artifacts directory: %v", err)
		// By returning a service anyway, we allow the app to run but log the error.
		// Operations requiring the directory will fail gracefully.
	}

	return &ArtifactService{
		artifacts:    make(map[string]*Artifact),
		artifactsDir: artifactsDir,
		ctx:          ctx,
	}
}

// AddArtifact creates a new artifact, saves its content to disk if necessary,
// stores its metadata in memory, and notifies the frontend.
func (s *ArtifactService) AddArtifact(sessionID string, artifactType ArtifactType, content []byte, metadata map[string]interface{}, isPersistent bool) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	artifactID := uuid.New().String()
	contentPath := ""
	var err error
	var url string

	// For types that require file storage, save the content to disk.
	if len(content) > 0 {
		switch artifactType {
		case TypeImage, TypeVideo:
			// Ensure the session-specific directory exists.
			sessionArtifactsDir := filepath.Join(s.artifactsDir, sessionID)
			if err = os.MkdirAll(sessionArtifactsDir, 0755); err != nil {
				return "", fmt.Errorf("failed to create session artifacts directory: %w", err)
			}

			// Determine file extension (this is a simplification).
			ext := ".bin" // Default binary extension
			if artifactType == TypeImage {
				ext = ".png" // Assume PNG for now
			} else if artifactType == TypeVideo {
				ext = ".mp4" // Assume MP4 for now
			}

			fileName := fmt.Sprintf("%s%s", artifactID, ext)
			filePath := filepath.Join(sessionArtifactsDir, fileName)

			if err = os.WriteFile(filePath, content, 0644); err != nil {
				return "", fmt.Errorf("failed to write artifact content to disk: %w", err)
			}
			contentPath = filePath
			url = "/wails/assetserver/" + contentPath
		}
	}

	artifact := &Artifact{
		ID:           artifactID,
		SessionID:    sessionID,
		Type:         artifactType,
		ContentPath:  contentPath,
		URL:          url,
		Metadata:     metadata,
		Timestamp:    time.Now(),
		IsPersistent: isPersistent,
	}

	s.artifacts[artifactID] = artifact

	log.Printf("Added new artifact: ID=%s, Type=%s, Persistent=%t", artifactID, artifactType, isPersistent)

	// Notify the frontend that a new artifact is available.
	if s.ctx != nil {
		runtime.EventsEmit(s.ctx, "newArtifactAdded", artifactID)
	}

	return artifactID, nil
}

// GetArtifact retrieves a single artifact by its ID.
func (s *ArtifactService) GetArtifact(id string) (*Artifact, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	artifact, exists := s.artifacts[id]
	if !exists {
		return nil, fmt.Errorf("artifact with ID '%s' not found", id)
	}
	return artifact, nil
}

// DeleteArtifact removes an artifact from memory and, if it's persistent,
// deletes its associated content file from disk.
func (s *ArtifactService) DeleteArtifact(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	artifact, exists := s.artifacts[id]
	if !exists {
		return fmt.Errorf("artifact with ID '%s' not found for deletion", id)
	}

	// If the artifact is persistent and has a file on disk, remove it.
	if artifact.IsPersistent && artifact.ContentPath != "" {
		if err := os.Remove(artifact.ContentPath); err != nil {
			// Log the error but don't block deletion of metadata.
			log.Printf("Warning: failed to delete artifact file '%s': %v", artifact.ContentPath, err)
		}
	}

	delete(s.artifacts, id)

	log.Printf("Deleted artifact: ID=%s", id)

	// Notify the frontend of the deletion.
	if s.ctx != nil {
		runtime.EventsEmit(s.ctx, "artifactDeleted", id)
	}

	return nil
}

// ListArtifacts returns a slice of all persistent artifacts for the current session,
// sorted by timestamp. Non-persistent artifacts are excluded.
func (s *ArtifactService) ListArtifacts(sessionID string) ([]*Artifact, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var result []*Artifact
	for _, artifact := range s.artifacts {
		if artifact.SessionID == sessionID && artifact.IsPersistent {
			result = append(result, artifact)
		}
	}

	// Sort by timestamp so they appear in chronological order.
	sort.Slice(result, func(i, j int) bool {
		return result[i].Timestamp.Before(result[j].Timestamp)
	})

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
		if artifact.SessionID == sessionID && !artifact.IsPersistent {
			idsToDelete = append(idsToDelete, id)
		}
	}

	for _, id := range idsToDelete {
		delete(s.artifacts, id)
		log.Printf("Cleaned up non-persistent artifact: ID=%s", id)
	}
}
