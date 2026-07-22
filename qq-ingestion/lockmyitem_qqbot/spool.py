import hashlib
import json
import sqlite3
import time
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class SpoolRecord:
    batch_id: str
    payload: dict[str, Any]
    attempts: int


def batch_id_for(payload: dict[str, Any]) -> str:
    group_id = str(payload.get("groupId") or "")
    message_ids = sorted(str(value) for value in payload.get("messageIds") or [] if str(value))
    canonical = json.dumps([group_id, message_ids], ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


class DurableSpool:
    """Local durable queue for aggregated QQ batches.

    Pending payloads may contain private images and are removed immediately after the
    backend acknowledges them. Only a batch hash is retained for local deduplication.
    """

    def __init__(self, path: str | Path):
        self.path = Path(path).expanduser().resolve()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    @contextmanager
    def _connect(self):
        connection = sqlite3.connect(self.path, timeout=15)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA synchronous=FULL")
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS pending_batches (
                    batch_id TEXT PRIMARY KEY,
                    payload_json TEXT NOT NULL,
                    attempts INTEGER NOT NULL DEFAULT 0,
                    next_attempt_at REAL NOT NULL DEFAULT 0,
                    last_error TEXT NOT NULL DEFAULT '',
                    created_at REAL NOT NULL,
                    updated_at REAL NOT NULL
                );
                CREATE TABLE IF NOT EXISTS processed_batches (
                    batch_id TEXT PRIMARY KEY,
                    completed_at REAL NOT NULL
                );
                """
            )

    def enqueue(self, payload: dict[str, Any]) -> tuple[str, bool]:
        batch_id = batch_id_for(payload)
        now = time.time()
        encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        with self._connect() as connection:
            if connection.execute(
                "SELECT 1 FROM processed_batches WHERE batch_id = ?", (batch_id,)
            ).fetchone():
                return batch_id, False
            cursor = connection.execute(
                """
                INSERT OR IGNORE INTO pending_batches
                    (batch_id, payload_json, attempts, next_attempt_at, created_at, updated_at)
                VALUES (?, ?, 0, 0, ?, ?)
                """,
                (batch_id, encoded, now, now),
            )
            return batch_id, cursor.rowcount == 1

    def due(self, limit: int = 10, now: float | None = None) -> list[SpoolRecord]:
        current = time.time() if now is None else float(now)
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT batch_id, payload_json, attempts
                FROM pending_batches
                WHERE next_attempt_at <= ?
                ORDER BY created_at ASC
                LIMIT ?
                """,
                (current, max(1, int(limit))),
            ).fetchall()
        return [
            SpoolRecord(row["batch_id"], json.loads(row["payload_json"]), int(row["attempts"]))
            for row in rows
        ]

    def mark_retry(self, batch_id: str, error: str, delay_seconds: float) -> None:
        now = time.time()
        with self._connect() as connection:
            connection.execute(
                """
                UPDATE pending_batches
                SET attempts = attempts + 1,
                    next_attempt_at = ?,
                    last_error = ?,
                    updated_at = ?
                WHERE batch_id = ?
                """,
                (now + max(0.0, float(delay_seconds)), str(error or "")[:500], now, batch_id),
            )

    def mark_sent(self, batch_id: str) -> None:
        now = time.time()
        with self._connect() as connection:
            connection.execute("DELETE FROM pending_batches WHERE batch_id = ?", (batch_id,))
            connection.execute(
                "INSERT OR REPLACE INTO processed_batches (batch_id, completed_at) VALUES (?, ?)",
                (batch_id, now),
            )

    def cleanup_processed(self, retention_seconds: float = 7 * 24 * 60 * 60) -> int:
        cutoff = time.time() - max(0.0, float(retention_seconds))
        with self._connect() as connection:
            cursor = connection.execute(
                "DELETE FROM processed_batches WHERE completed_at < ?", (cutoff,)
            )
            return cursor.rowcount

    def stats(self) -> dict[str, int]:
        with self._connect() as connection:
            pending = connection.execute("SELECT COUNT(*) FROM pending_batches").fetchone()[0]
            processed = connection.execute("SELECT COUNT(*) FROM processed_batches").fetchone()[0]
        return {"pending": int(pending), "processed": int(processed)}
