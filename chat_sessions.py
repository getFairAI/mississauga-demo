"""Persistent chat session store backed by SQLite.

Holds conversation history so the UI can list and reopen past chats and
follow-ups have LLM context. Persists across server restarts.

The LLM context returned by ``get_or_create`` is capped at the most recent
``MAX_TURNS`` user/assistant pairs to keep token cost bounded; full history
remains available via ``load_full`` for the UI.
"""

from __future__ import annotations

import os
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from typing import Optional

MAX_TURNS = int(os.getenv("CHAT_SESSION_MAX_TURNS", "20"))  # cap LLM context length

_DB_PATH = Path(
    os.getenv("CHAT_SESSION_DB", str(Path(__file__).parent / "data" / "chat_sessions.db"))
)
_lock = threading.Lock()
_conn: Optional[sqlite3.Connection] = None


def _connect() -> sqlite3.Connection:
    global _conn
    if _conn is not None:
        return _conn
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(_DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS sessions (
            id         TEXT PRIMARY KEY,
            title      TEXT,
            created_at REAL NOT NULL,
            last_seen  REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS messages (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            role       TEXT NOT NULL,
            content    TEXT NOT NULL,
            created_at REAL NOT NULL,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_messages_session
            ON messages(session_id, id);
        CREATE INDEX IF NOT EXISTS idx_sessions_last_seen
            ON sessions(last_seen DESC);
        """
    )
    conn.commit()
    _conn = conn
    return conn


def _truncate_title(text: str, limit: int = 7) -> str:
    s = text.strip().replace("\n", " ")
    if len(s) <= limit:
        return s
    return s[:limit] + "..."


def create(title: Optional[str] = None) -> dict:
    """Create a new empty session and return its summary row."""
    now = time.time()
    new_id = uuid.uuid4().hex
    clean_title = _truncate_title(title) if title else None
    with _lock:
        conn = _connect()
        conn.execute(
            "INSERT INTO sessions (id, title, created_at, last_seen) "
            "VALUES (?, ?, ?, ?)",
            (new_id, clean_title, now, now),
        )
        conn.commit()
    return {
        "id": new_id,
        "title": clean_title,
        "created_at": now,
        "last_seen": now,
        "message_count": 0,
    }


def get_or_create(session_id: Optional[str]) -> tuple[str, list[dict]]:
    """Return ``(session_id, recent_messages_for_llm)``.

    Mints a new id when ``session_id`` is missing or unknown. The returned
    messages are capped at the last ``MAX_TURNS`` pairs to bound LLM context.
    """
    now = time.time()
    with _lock:
        conn = _connect()
        if session_id:
            row = conn.execute(
                "SELECT id FROM sessions WHERE id = ?", (session_id,)
            ).fetchone()
            if row is not None:
                conn.execute(
                    "UPDATE sessions SET last_seen = ? WHERE id = ?",
                    (now, session_id),
                )
                conn.commit()
                limit = MAX_TURNS * 2
                rows = conn.execute(
                    "SELECT role, content FROM messages "
                    "WHERE session_id = ? ORDER BY id DESC LIMIT ?",
                    (session_id, limit),
                ).fetchall()
                msgs = [{"role": r["role"], "content": r["content"]} for r in rows][::-1]
                return session_id, msgs

        new_id = uuid.uuid4().hex
        conn.execute(
            "INSERT INTO sessions (id, title, created_at, last_seen) "
            "VALUES (?, NULL, ?, ?)",
            (new_id, now, now),
        )
        conn.commit()
        return new_id, []


def append_turn(
    session_id: str,
    user_message: dict,
    assistant_message: dict,
) -> list[dict]:
    """Append a user/assistant turn pair and return the recent LLM-context slice."""
    now = time.time()
    with _lock:
        conn = _connect()
        # Ensure the session exists (defensive — the assistant flow always
        # creates one before calling here, but a stale id passed straight to
        # append_turn would otherwise FK-fail).
        existing = conn.execute(
            "SELECT title FROM sessions WHERE id = ?", (session_id,)
        ).fetchone()
        if existing is None:
            conn.execute(
                "INSERT INTO sessions (id, title, created_at, last_seen) "
                "VALUES (?, NULL, ?, ?)",
                (session_id, now, now),
            )

        conn.execute(
            "INSERT INTO messages (session_id, role, content, created_at) "
            "VALUES (?, ?, ?, ?)",
            (session_id, user_message["role"], user_message["content"], now),
        )
        conn.execute(
            "INSERT INTO messages (session_id, role, content, created_at) "
            "VALUES (?, ?, ?, ?)",
            (
                session_id,
                assistant_message["role"],
                assistant_message["content"],
                now,
            ),
        )

        # Set the title from the first user message if not already set.
        if existing is None or existing["title"] is None:
            conn.execute(
                "UPDATE sessions SET title = ?, last_seen = ? WHERE id = ?",
                (_truncate_title(user_message["content"]), now, session_id),
            )
        else:
            conn.execute(
                "UPDATE sessions SET last_seen = ? WHERE id = ?",
                (now, session_id),
            )
        conn.commit()

        limit = MAX_TURNS * 2
        rows = conn.execute(
            "SELECT role, content FROM messages "
            "WHERE session_id = ? ORDER BY id DESC LIMIT ?",
            (session_id, limit),
        ).fetchall()
        return [{"role": r["role"], "content": r["content"]} for r in rows][::-1]


def get_messages(session_id: str) -> list[dict]:
    """Return the recent LLM-context slice (empty if unknown)."""
    with _lock:
        conn = _connect()
        row = conn.execute(
            "SELECT id FROM sessions WHERE id = ?", (session_id,)
        ).fetchone()
        if row is None:
            return []
        conn.execute(
            "UPDATE sessions SET last_seen = ? WHERE id = ?",
            (time.time(), session_id),
        )
        conn.commit()
        limit = MAX_TURNS * 2
        rows = conn.execute(
            "SELECT role, content FROM messages "
            "WHERE session_id = ? ORDER BY id DESC LIMIT ?",
            (session_id, limit),
        ).fetchall()
        return [{"role": r["role"], "content": r["content"]} for r in rows][::-1]


def load_full(session_id: str) -> Optional[dict]:
    """Return ``{id, title, created_at, last_seen, messages}`` or None."""
    with _lock:
        conn = _connect()
        row = conn.execute(
            "SELECT id, title, created_at, last_seen FROM sessions WHERE id = ?",
            (session_id,),
        ).fetchone()
        if row is None:
            return None
        msgs = conn.execute(
            "SELECT role, content, created_at FROM messages "
            "WHERE session_id = ? ORDER BY id ASC",
            (session_id,),
        ).fetchall()
        return {
            "id": row["id"],
            "title": row["title"],
            "created_at": row["created_at"],
            "last_seen": row["last_seen"],
            "messages": [
                {
                    "role": m["role"],
                    "content": m["content"],
                    "created_at": m["created_at"],
                }
                for m in msgs
            ],
        }


def list_sessions() -> list[dict]:
    """Return all sessions sorted by recency, with message counts."""
    with _lock:
        conn = _connect()
        rows = conn.execute(
            "SELECT s.id, s.title, s.created_at, s.last_seen, "
            "       COUNT(m.id) AS message_count "
            "FROM sessions s "
            "LEFT JOIN messages m ON m.session_id = s.id "
            "GROUP BY s.id "
            "ORDER BY s.last_seen DESC"
        ).fetchall()
        return [
            {
                "id": r["id"],
                "title": r["title"],
                "created_at": r["created_at"],
                "last_seen": r["last_seen"],
                "message_count": r["message_count"],
            }
            for r in rows
        ]


def drop(session_id: str) -> bool:
    """Forget a session. Returns True if it existed."""
    with _lock:
        conn = _connect()
        cur = conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
        conn.commit()
        return cur.rowcount > 0


def stats() -> dict:
    with _lock:
        conn = _connect()
        row = conn.execute("SELECT COUNT(*) AS c FROM sessions").fetchone()
        return {
            "active_sessions": row["c"],
            "max_turns": MAX_TURNS,
            "db_path": str(_DB_PATH),
        }
