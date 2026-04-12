"""
统一响应格式与错误码体系

响应结构: { code, message, data, timestamp, request_id }
错误码区间见 docs/mvp_scope.md §八
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel


class ApiResponse(BaseModel):
    code: int = 0
    message: str = "ok"
    data: Any = None
    timestamp: str = ""
    request_id: str = ""

    @classmethod
    def success(cls, data: Any = None, message: str = "ok", request_id: str = "") -> "ApiResponse":
        return cls(
            code=0,
            message=message,
            data=data,
            timestamp=datetime.now().isoformat(timespec="seconds"),
            request_id=request_id or uuid.uuid4().hex,
        )

    @classmethod
    def error(cls, code: int, message: str, data: Any = None, request_id: str = "") -> "ApiResponse":
        return cls(
            code=code,
            message=message,
            data=data,
            timestamp=datetime.now().isoformat(timespec="seconds"),
            request_id=request_id or uuid.uuid4().hex,
        )


# ── 错误码常量 ──────────────────────────────────────────
# 0        成功
# 1000-1999 参数错误
ERR_PARAM_MISSING = 1001
ERR_PARAM_INVALID = 1002

# 2000-2999 业务错误
ERR_BIZ_DUPLICATE = 2001
ERR_RISK_BLOCKED = 2002
ERR_NOT_FOUND = 2003
ERR_STATE_CONFLICT = 2004

# 3000-3999 系统错误
ERR_DB = 3001
ERR_INTERNAL = 3002

# 4000-4999 权限错误
ERR_AUTH_MISSING = 4001
ERR_AUTH_FORBIDDEN = 4002

# 5000-5999 外部依赖错误
ERR_QMT_CONNECT = 5001
ERR_XTDATA = 5002
ERR_XTTRADER = 5003

# 6000-6999 策略运行错误
ERR_STRATEGY_HEARTBEAT = 6001
ERR_STRATEGY_START = 6002
ERR_STRATEGY_STOP = 6003
