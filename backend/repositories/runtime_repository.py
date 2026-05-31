from pathlib import Path

from backend.core.config import settings


class RuntimeRepository:
    def ensure_runtime_directories(self) -> dict[str, Path]:
        directories = {
            "data": settings.data_dir,
            "logs": settings.logs_dir,
            "backups": settings.backups_dir,
        }
        for directory in directories.values():
            directory.mkdir(parents=True, exist_ok=True)
        return directories
