package main

import (
	"database/sql"
	"fmt"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

// Database struct
type Database struct {
	db *sql.DB
}

// NewDatabase creates a new Database struct
func NewDatabase(dbPath string) (*Database, error) {
	db, err := sql.Open("sqlite3", dbPath)
	if err != nil {
		return nil, err
	}
	if err := db.Ping(); err != nil {
		return nil, err
	}
	return &Database{db: db}, nil
}

// Initialize initializes the database
func (d *Database) Initialize() error {
	_, err := d.db.Exec(`
		CREATE TABLE IF NOT EXISTS chat_sessions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			system_prompt TEXT DEFAULT '', -- Added system_prompt column
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		);

		CREATE TABLE IF NOT EXISTS chat_messages (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			session_id INTEGER NOT NULL,
			sender TEXT NOT NULL,
			message TEXT NOT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY(session_id) REFERENCES chat_sessions(id)
		);
	`)
	return err
}

// ChatSession struct
type ChatSession struct {
	ID           int64  `json:"id"`
	Name         string `json:"name"`
	SystemPrompt string `json:"system_prompt"` // Added SystemPrompt field
	CreatedAt    string `json:"created_at"`
}

// NewChatSession creates a new chat session with an optional system prompt
func (d *Database) NewChatSession(systemPrompt string) (int64, error) { // Modified signature to accept systemPrompt
	name := fmt.Sprintf("Chat Session %s", time.Now().Format("01-02 15:04"))
	// Insert system_prompt into the table
	result, err := d.db.Exec("INSERT INTO chat_sessions (name, system_prompt) VALUES (?, ?)", name, systemPrompt)
	if err != nil {
		return 0, err
	}
	id, err := result.LastInsertId()
	if err != nil {
		return 0, err
	}
	return id, nil
}

// GetChatSessions retrieves all chat sessions.
func (d *Database) GetChatSessions() ([]ChatSession, error) {
	rows, err := d.db.Query("SELECT id, name, system_prompt, created_at FROM chat_sessions ORDER BY created_at DESC") // Select system_prompt
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var sessions []ChatSession
	for rows.Next() {
		var session ChatSession
		var createdAt time.Time
		// Scan system_prompt
		if err := rows.Scan(&session.ID, &session.Name, &session.SystemPrompt, &createdAt); err != nil {
			return nil, err
		}
		session.CreatedAt = createdAt.Format(time.RFC3339)
		sessions = append(sessions, session)
	}
	return sessions, nil
}

// GetChatSession retrieves a single chat session by ID.
func (d *Database) GetChatSession(id int64) (*ChatSession, error) {
	var session ChatSession
	var createdAt time.Time
	// Select system_prompt
	err := d.db.QueryRow("SELECT id, name, system_prompt, created_at FROM chat_sessions WHERE id = ?", id).Scan(&session.ID, &session.Name, &session.SystemPrompt, &createdAt)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("chat session with ID %d not found", id)
		}
		return nil, err
	}
	session.CreatedAt = createdAt.Format(time.RFC3339)
	return &session, nil
}

// DeleteChatSession deletes a chat session and its messages
func (d *Database) DeleteChatSession(id int64) error {
	tx, err := d.db.Begin()
	if err != nil {
		return err
	}
	_, err = tx.Exec("DELETE FROM chat_messages WHERE session_id = ?", id)
	if err != nil {
		tx.Rollback()
		return err
	}
	_, err = tx.Exec("DELETE FROM chat_sessions WHERE id = ?", id)
	if err != nil {
		tx.Rollback()
		return err
	}
	return tx.Commit()
}

// SaveChatMessage saves a single chat message to the database.
func (d *Database) SaveChatMessage(sessionID int64, sender, message string) error {
	_, err := d.db.Exec("INSERT INTO chat_messages (session_id, sender, message) VALUES (?, ?, ?)", sessionID, sender, message)
	return err
}

// GetChatMessages retrieves all chat messages for a given session, ordered by creation time.
func (d *Database) GetChatMessages(sessionID int64) ([]ChatMessage, error) {
	rows, err := d.db.Query("SELECT sender, message FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC", sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var messages []ChatMessage
	for rows.Next() {
		var msg ChatMessage
		if err := rows.Scan(&msg.Role, &msg.Content); err != nil {
			return nil, err
		}
		messages = append(messages, msg)
	}
	return messages, nil
}
