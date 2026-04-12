"""
Adapter 层异常 — 统一映射到错误码体系

所有 adapter 异常继承 AdapterError → BizError，
全局异常处理器自动转为统一响应。
"""

from app.core.exceptions import BizError
from app.core.response import ERR_QMT_CONNECT, ERR_XTDATA, ERR_XTTRADER


class AdapterError(BizError):
    """adapter 层异常基类"""
    pass


class QmtConnectError(AdapterError):
    """QMT 连接失败"""
    def __init__(self, message: str = "QMT 连接失败"):
        super().__init__(ERR_QMT_CONNECT, message)


class XtdataError(AdapterError):
    """xtdata 行情接口异常"""
    def __init__(self, message: str = "xtdata 接口异常"):
        super().__init__(ERR_XTDATA, message)


class XttraderError(AdapterError):
    """xttrader 交易接口异常"""
    def __init__(self, message: str = "xttrader 接口异常"):
        super().__init__(ERR_XTTRADER, message)
