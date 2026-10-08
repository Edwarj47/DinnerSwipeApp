from __future__ import annotations

import json
import threading
import time
from collections import OrderedDict
from typing import Any


class TemporaryNutritionCache:
    """RAM only: provider content never enters SQL, files, logs or backups."""

    def __init__(self, max_bytes: int = 8_388_608, max_entries: int = 128) -> None:
        self.entries: OrderedDict[str, tuple[float, float, bytes]] = OrderedDict()
        self.max_bytes = max_bytes
        self.max_entries = max_entries
        self.lock = threading.RLock()
        self.cleaner_started = False

    def purge(self) -> int:
        with self.lock:
            expired = [
                key
                for key, (expiry, wall_expiry, _) in self.entries.items()
                if expiry <= time.monotonic() or wall_expiry <= time.time()
            ]
            for key in expired:
                del self.entries[key]
            return len(expired)

    def _clean(self) -> None:
        while True:
            time.sleep(30)
            self.purge()

    def get(self, key: str) -> dict[str, Any] | None:
        with self.lock:
            self.purge()
            if key not in self.entries:
                return None
            self.entries.move_to_end(key)
            return dict(json.loads(self.entries[key][2]))

    def put(self, key: str, payload: dict[str, Any], lifetime: float) -> None:
        encoded = json.dumps(payload).encode()
        with self.lock:
            self.purge()
            if lifetime <= 0 or len(encoded) > self.max_bytes:
                return
            lifetime = min(lifetime, 82800)
            self.entries[key] = (time.monotonic() + lifetime, time.time() + lifetime, encoded)
            self.entries.move_to_end(key)
            while (
                len(self.entries) > self.max_entries
                or sum(len(value[2]) for value in self.entries.values()) > self.max_bytes
            ):
                self.entries.popitem(last=False)
            if not self.cleaner_started:
                self.cleaner_started = True
                threading.Thread(
                    target=self._clean, daemon=True, name="nutrition-cache-purge"
                ).start()
