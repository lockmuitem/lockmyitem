import json
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any


class HistoryResultStore:
    def __init__(self, path: str | Path):
        self.path = Path(path).expanduser().resolve()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as connection:
            connection.execute(
                "CREATE TABLE IF NOT EXISTS history_results (source_id TEXT PRIMARY KEY, result_json TEXT NOT NULL, created_at REAL NOT NULL)"
            )

    @contextmanager
    def _connect(self):
        connection = sqlite3.connect(self.path, timeout=15)
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def get(self, source_id: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute("SELECT result_json FROM history_results WHERE source_id = ?", (source_id,)).fetchone()
        return json.loads(row[0]) if row else None

    def put(self, source_id: str, result: dict[str, Any]) -> None:
        encoded = json.dumps(result, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        with self._connect() as connection:
            connection.execute(
                "INSERT OR REPLACE INTO history_results (source_id, result_json, created_at) VALUES (?, ?, ?)",
                (source_id, encoded, time.time()),
            )

    def all(self) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute("SELECT result_json FROM history_results ORDER BY created_at, source_id").fetchall()
        return [json.loads(row[0]) for row in rows]
