from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


BASE_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="LQC_", env_file=".env", extra="ignore")

    app_name: str = "本地量化控制台"
    app_version: str = "0.1.0"
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:3000"])
    data_dir: Path = BASE_DIR / "data"
    logs_dir: Path = BASE_DIR / "logs"
    backups_dir: Path = BASE_DIR / "backups"
    database_path: Path = BASE_DIR / "data" / "local_quant_console.db"
    strategy_user_dir: Path = BASE_DIR / "strategies" / "user"
    strategy_example_dir: Path = BASE_DIR / "strategies" / "examples"


settings = Settings()
