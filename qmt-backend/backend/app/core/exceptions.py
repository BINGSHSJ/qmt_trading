"""
业务异常类 — 与错误码体系对应，由全局异常处理器捕获并转为统一响应
"""

from app.core.response import (
    ERR_PARAM_MISSING, ERR_PARAM_INVALID, ERR_NOT_FOUND,
    ERR_STATE_CONFLICT, ERR_RISK_BLOCKED, ERR_AUTH_MISSING,
    ERR_AUTH_FORBIDDEN, ERR_INTERNAL,
    ERR_XTDATA, ERR_XTTRADER,
    ERR_STRATEGY_START, ERR_STRATEGY_STOP,
)


class BizError(Exception):
    """业务异常基类"""

    def __init__(self, code: int, message: str, data=None):
        self.code = code
        self.message = message
        self.data = data
        super().__init__(message)


class ParamMissing(BizError):
    def __init__(self, message: str = "必填参数缺失"):
        super().__init__(ERR_PARAM_MISSING, message)


class ParamInvalid(BizError):
    def __init__(self, message: str = "参数格式非法"):
        super().__init__(ERR_PARAM_INVALID, message)


class NotFound(BizError):
    def __init__(self, message: str = "资源不存在"):
        super().__init__(ERR_NOT_FOUND, message)


class StateConflict(BizError):
    def __init__(self, message: str = "状态冲突"):
        super().__init__(ERR_STATE_CONFLICT, message)


class RiskBlocked(BizError):
    def __init__(self, message: str = "风控拦截", data=None):
        super().__init__(ERR_RISK_BLOCKED, message, data)


class AuthMissing(BizError):
    def __init__(self, message: str = "鉴权信息缺失"):
        super().__init__(ERR_AUTH_MISSING, message)


class AuthForbidden(BizError):
    def __init__(self, message: str = "无操作权限"):
        super().__init__(ERR_AUTH_FORBIDDEN, message)


class InternalError(BizError):
    def __init__(self, message: str = "服务内部错误"):
        super().__init__(ERR_INTERNAL, message)


class StrategyStartError(BizError):
    def __init__(self, message: str = "策略启动失败"):
        super().__init__(ERR_STRATEGY_START, message)


class StrategyStopError(BizError):
    def __init__(self, message: str = "策略停止失败"):
        super().__init__(ERR_STRATEGY_STOP, message)


class XtdataError(BizError):
    def __init__(self, message: str = "xtdata 行情服务异常"):
        super().__init__(ERR_XTDATA, message)


class XttraderError(BizError):
    def __init__(self, message: str = "xttrader 交易服务异常"):
        super().__init__(ERR_XTTRADER, message)
