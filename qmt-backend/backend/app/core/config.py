"""
配置加载模块

加载优先级（高覆盖低）:
  1. 环境变量 / .env
  2. config.local.yaml（本机覆盖，不提交 Git）
  3. config.{ENV}.yaml（按环境加载）
"""

from __future__ import annotations

from pathlib import Path
from functools import lru_cache
from typing import Any

import yaml
from pydantic_settings import BaseSettings

# backend/
BASE_DIR = Path(__file__).resolve().parent.parent.parent


class EnvSettings(BaseSettings):
    """从 .env 读取的敏感 / 环境变量"""

    qmt_account_id: str = ""
    qmt_exe_path: str = ""
    secret_key: str = "change-me"
    api_key: str = "dev-api-key"
    env: str = "dev"
    mock_mode: bool = True

    model_config = {"env_file": str(BASE_DIR / ".env"), "extra": "ignore"}


def _deep_merge(base: dict, override: dict) -> None:
    """将 override 递归合并入 base（原地修改）"""
    for k, v in override.items():
        if k in base and isinstance(base[k], dict) and isinstance(v, dict):
            _deep_merge(base[k], v)
        else:
            base[k] = v


def _load_yaml(path: Path) -> dict:
    if not path.exists():
        return {}
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def _load_yaml_config(env: str) -> dict:
    """按优先级加载 config.{env}.yaml → config.local.yaml"""
    cfg = _load_yaml(BASE_DIR / f"config.{env}.yaml")
    local = _load_yaml(BASE_DIR / "config.local.yaml")
    if local:
        _deep_merge(cfg, local)
    return cfg


@lru_cache()
def get_env_settings() -> EnvSettings:
    return EnvSettings()


@lru_cache()
def get_yaml_config() -> dict:
    return _load_yaml_config(get_env_settings().env)


# ── 便捷取值函数 ──────────────────────────────────────


def yaml_get(*keys: str, default: Any = None) -> Any:
    """按层级路径取 YAML 配置值，如 yaml_get("log", "level", default="INFO")"""
    cfg = get_yaml_config()
    for k in keys:
        if not isinstance(cfg, dict):
            return default
        cfg = cfg.get(k)
        if cfg is None:
            return default
    return cfg


def get_db_path() -> Path:
    relative = yaml_get("database", "path", default="app/db/app.db")
    return BASE_DIR / relative


def get_runtime_dir(sub: str = "") -> Path:
    """获取 runtime 子目录，自动创建"""
    if sub:
        relative = yaml_get("runtime", f"{sub}_dir", default=f"runtime/{sub}")
    else:
        relative = "runtime"
    p = BASE_DIR / relative
    p.mkdir(parents=True, exist_ok=True)
    return p
