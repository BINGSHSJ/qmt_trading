"""
Phase 2 接口预留 — 占位模块

为第二阶段功能预留扩展点和接口定义，便于后续开发无缝接入。
各接口均未实现，仅定义签名和文档说明。

第二阶段规划:
  1. 真实 QMT Adapter 对接（替换 Mock）
  2. 高级风控（止损止盈、组合风控、夜间检查）
  3. 策略进程管理（子进程 / 独立脚本运行）
  4. 用户认证 & RBAC（JWT + 角色权限）
  5. WebSocket 推送替代轮询
  6. 真实交易日历（节假日 / 半天市）
  7. 多账户支持
"""

from __future__ import annotations

import abc
from typing import Any


# ═══════════════════════════════════════════════════════
# 1. 真实 Adapter 接口（继承现有抽象类即可）
# ═══════════════════════════════════════════════════════

class RealXtdataAdapter:
    """
    Phase 2: 对接真实 xtdata SDK

    实现思路:
      - 继承 XtdataAdapter 抽象类
      - 在 __init__ 中连接 xtdata (xtdata.connect())
      - 行情订阅采用回调 + 内存缓存
      - check_health 检查 xtdata 进程存活

    接入点: app/adapters/factory.py 中根据 mock_mode 选择实例
    """
    pass


class RealXttraderAdapter:
    """
    Phase 2: 对接真实 xttrader SDK

    实现思路:
      - 继承 XttraderAdapter 抽象类
      - 在 __init__ 中创建 XtQuantTrader 实例并注册回调
      - place_order 调用 xttrader.order_stock()
      - 成交回调通过 WebSocket 推送到前端

    接入点: app/adapters/factory.py 中根据 mock_mode 选择实例
    """
    pass


# ═══════════════════════════════════════════════════════
# 2. 高级风控接口
# ═══════════════════════════════════════════════════════

class AdvancedRiskEngine(abc.ABC):
    """
    Phase 2: 高级风控引擎

    扩展项:
      - 单笔止损/止盈自动撤单
      - 组合层面最大回撤限制
      - 板块集中度限制
      - 夜间持仓风险检查（盘后任务）
      - max_daily_loss_pct 实时计算（需盘中资产快照）

    接入点: services/risk_service.py 的 check_risk() 中链式调用
    """

    @abc.abstractmethod
    async def check_portfolio_risk(self, account_id: str) -> dict[str, Any]:
        """组合层面风控检查"""

    @abc.abstractmethod
    async def check_stop_loss(self, strategy_id: int, position: dict) -> dict[str, Any]:
        """单策略止损检查"""

    @abc.abstractmethod
    async def overnight_risk_scan(self) -> list[dict[str, Any]]:
        """盘后持仓风险扫描"""


# ═══════════════════════════════════════════════════════
# 3. 策略进程管理
# ═══════════════════════════════════════════════════════

class StrategyProcessManager(abc.ABC):
    """
    Phase 2: 策略子进程管理

    功能:
      - 启动/停止策略脚本（subprocess 或 multiprocessing）
      - 心跳监控 + 自动重启
      - 日志收集（stdout/stderr → 系统日志表）
      - 资源限制（CPU / 内存）

    接入点: services/strategy_service.py 的 start_strategy() 中调用
    """

    @abc.abstractmethod
    async def start_process(self, strategy_id: int, script_path: str) -> int:
        """启动策略进程，返回 PID"""

    @abc.abstractmethod
    async def stop_process(self, strategy_id: int) -> bool:
        """停止策略进程"""

    @abc.abstractmethod
    async def get_process_status(self, strategy_id: int) -> dict[str, Any]:
        """获取进程状态（PID、CPU、内存、运行时长）"""


# ═══════════════════════════════════════════════════════
# 4. 用户认证 & RBAC
# ═══════════════════════════════════════════════════════

class AuthService(abc.ABC):
    """
    Phase 2: JWT 认证 + 角色权限

    功能:
      - 用户注册/登录 → JWT Token
      - 角色定义: admin, operator, viewer
      - 权限矩阵: 策略管理(admin/operator), 下单(admin/operator),
                   日志查看(all), 系统配置(admin)
      - Token 刷新 + 黑名单

    接入点:
      - 替换 core/dependencies.py 中 verify_api_key
      - 新增 models/tables.py 中 User / Role 表
      - 新增 api/auth.py 路由
    """

    @abc.abstractmethod
    async def login(self, username: str, password: str) -> dict[str, str]:
        """登录，返回 {access_token, refresh_token}"""

    @abc.abstractmethod
    async def verify_token(self, token: str) -> dict[str, Any]:
        """验证 Token，返回用户信息"""

    @abc.abstractmethod
    async def check_permission(self, user_id: int, resource: str, action: str) -> bool:
        """检查用户权限"""


# ═══════════════════════════════════════════════════════
# 5. WebSocket 推送（替代轮询）
# ═══════════════════════════════════════════════════════

class RealtimePushService(abc.ABC):
    """
    Phase 2: WebSocket 推送替代前端轮询

    扩展项:
      - 行情推送（订阅指定标的实时行情）
      - 策略状态变更推送
      - 持仓变动推送
      - 风控告警推送
      - 前端 polling → WS subscription 模型

    接入点: api/ws.py 的 ConnectionManager 扩展
    """

    @abc.abstractmethod
    async def subscribe(self, client_id: str, channels: list[str]) -> None:
        """客户端订阅频道"""

    @abc.abstractmethod
    async def publish(self, channel: str, data: dict) -> int:
        """发布消息到频道，返回接收客户端数"""


# ═══════════════════════════════════════════════════════
# 6. 真实交易日历
# ═══════════════════════════════════════════════════════

class TradingCalendarService(abc.ABC):
    """
    Phase 2: 完整交易日历

    扩展项:
      - 从交易所 / 第三方数据源同步节假日
      - 半天市支持（春节前 / 国庆前）
      - 数据库存储 + 年度预加载
      - A 股 / 港股 / 美股 多市场支持

    接入点: core/trading_calendar.py 替换硬编码逻辑
    """

    @abc.abstractmethod
    async def is_trading_day(self, date_str: str, market: str = "A") -> bool:
        """判断指定日期是否为交易日"""

    @abc.abstractmethod
    async def get_next_trading_day(self, date_str: str, market: str = "A") -> str:
        """获取下一个交易日"""


# ═══════════════════════════════════════════════════════
# 7. 多账户支持
# ═══════════════════════════════════════════════════════

class MultiAccountManager(abc.ABC):
    """
    Phase 2: 多账户管理

    功能:
      - 多个 QMT 账户注册/切换
      - 每个策略绑定指定账户
      - 账户级别风控独立
      - 合并持仓/收益视图

    接入点:
      - 新增 models/tables.py 中 Account 表
      - services/trading_service.py 按策略获取 account_id
    """

    @abc.abstractmethod
    async def register_account(self, account_id: str, config: dict) -> None:
        """注册交易账户"""

    @abc.abstractmethod
    async def get_account(self, account_id: str) -> dict[str, Any]:
        """获取账户信息"""
