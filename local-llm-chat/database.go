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
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			system_prompt TEXT DEFAULT '' -- Add this line
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
	if err != nil {
		return err
	}

	// This block attempts to add the system_prompt column if it doesn't exist.
	// It's a basic migration strategy.
	_, err = d.db.Exec(`
		PRAGMA foreign_keys = OFF;
		CREATE TABLE IF NOT EXISTS chat_sessions_new (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			system_prompt TEXT DEFAULT ''
		);
		INSERT INTO chat_sessions_new (id, name, created_at, system_prompt)
		SELECT id, name, created_at, '' FROM chat_sessions;
		DROP TABLE chat_sessions;
		ALTER TABLE chat_sessions_new RENAME TO chat_sessions;
		PRAGMA foreign_keys = ON;
	`)
	// We ignore the error here because the column might already exist after the first run.
	if err != nil {
		fmt.Printf("Warning: Could not alter chat_sessions table to add system_prompt column (it might already exist): %v\n", err)
	}

	return nil
}

// ChatSession struct
type ChatSession struct {
	ID           int64  `json:"id"`
	Name         string `json:"name"`
	CreatedAt    string `json:"created_at"`
	SystemPrompt string `json:"system_prompt"` // Add this line
}

// NewChatSession creates a new chat session with an optional system prompt
func (d *Database) NewChatSession(systemPrompt string) (int64, error) { // <--- **FIX: Add systemPrompt string parameter**
	name := fmt.Sprintf("Chat %s", time.Now().Format("2006-01-02 15:04:05"))
	// Insert the system_prompt into the chat_sessions table
	res, err := d.db.Exec("INSERT INTO chat_sessions (name, system_prompt) VALUES (?, ?)", name, systemPrompt) // <--- **FIX: Pass systemPrompt here**
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// GetChatSessions retrieves all chat sessions
func (d *Database) GetChatSessions() ([]ChatSession, error) {
	rows, err := d.db.Query("SELECT id, name, created_at, system_prompt FROM chat_sessions ORDER BY created_at DESC") // <--- **FIX: Select system_prompt**
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var sessions []ChatSession
	for rows.Next() {
		var session ChatSession
		var createdAt time.Time
		// Scan into the new SystemPrompt field
		if err := rows.Scan(&session.ID, &session.Name, &createdAt, &session.SystemPrompt); err != nil { // <--- **FIX: Scan into session.SystemPrompt**
			return nil, err
		}
		session.CreatedAt = createdAt.Format(time.RFC3339)
		sessions = append(sessions, session)
	}
	return sessions, nil
}

// GetChatSession retrieves a single chat session by ID
func (d *Database) GetChatSession(id int64) (*ChatSession, error) {
	row := d.db.QueryRow("SELECT id, name, created_at, system_prompt FROM chat_sessions WHERE id = ?", id)
	var session ChatSession
	var createdAt time.Time
	if err := row.Scan(&session.ID, &session.Name, &createdAt, &session.SystemPrompt); err != nil {
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
