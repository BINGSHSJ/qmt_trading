class AppError(Exception):
    def __init__(
        self,
        message: str,
        code: str,
        detail: str | None = None,
        suggestion: str | None = None,
        status_code: int = 400,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.detail = detail
        self.suggestion = suggestion
        self.status_code = status_code


class ConfigError(AppError):
    pass


class QmtConnectionError(AppError):
    pass


class DataSyncError(AppError):
    pass


class StrategyValidationError(AppError):
    pass


class StrategyRunError(AppError):
    pass


class BacktestError(AppError):
    pass


class TradingError(AppError):
    pass


class DatabaseError(AppError):
    pass


class TaskCancelledError(AppError):
    pass
