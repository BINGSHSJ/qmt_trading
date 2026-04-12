"""
Adapter 工厂 + FastAPI 依赖注入

根据 mock_mode 创建对应的 adapter 实例。
Service 层通过 Depends 注入，不直接耦合具体实现类。

使用可清除的字典缓存代替 @lru_cache()，
以便 preflight refresh 时重建 adapter（例如 xtquant 从不可用变为可用）。
"""

from __future__ import annotations

from typing import Any

from app.core.config import get_env_settings
from app.adapters.xtdata_adapter import XtdataAdapter, MockXtdataAdapter, RealXtdataAdapter
from app.adapters.xttrader_adapter import XttraderAdapter, MockXttraderAdapter, RealXttraderAdapter

_adapter_cache: dict[str, Any] = {}


def get_xtdata_adapter() -> XtdataAdapter:
    if "xtdata" not in _adapter_cache:
        settings = get_env_settings()
        if settings.mock_mode:
            _adapter_cache["xtdata"] = MockXtdataAdapter()
        else:
            _adapter_cache["xtdata"] = RealXtdataAdapter()
    return _adapter_cache["xtdata"]


def get_xttrader_adapter() -> XttraderAdapter:
    if "xttrader" not in _adapter_cache:
        settings = get_env_settings()
        if settings.mock_mode:
            _adapter_cache["xttrader"] = MockXttraderAdapter()
        else:
            _adapter_cache["xttrader"] = RealXttraderAdapter()
    return _adapter_cache["xttrader"]


def clear_adapter_cache() -> None:
    """清除 adapter 缓存，下次调用时重新创建实例。

    适用场景：preflight refresh 时重建 adapter，
    以检测 xtquant 可用性变化。
    """
    _adapter_cache.clear()
