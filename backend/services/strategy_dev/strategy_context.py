from backend.repositories.data_center.data_center_repository import DataCenterRepository
from backend.schemas.common import PageQuery


class StrategyContext:
    def __init__(self) -> None:
        self.repository = DataCenterRepository()
        self.logs: list[str] = []

    def get_stock_list(self, keyword: str | None = None, limit: int = 200):
        safe_limit = min(max(int(limit), 1), 6000)
        items = []
        page = 1
        while len(items) < safe_limit:
            page_size = min(200, safe_limit - len(items))
            result = self.repository.list_stocks(PageQuery(page=page, page_size=page_size, keyword=keyword))
            items.extend(item.model_dump() for item in result.items)
            if not result.has_more:
                break
            page += 1
        return items

    def get_stock_universe(
        self,
        min_market_cap_yi: float | None = None,
        max_market_cap_yi: float | None = None,
        start_date: str | None = None,
        end_date: str | None = None,
        limit: int = 6000,
    ):
        return self.repository.list_market_cap_universe(
            min_market_cap_yi=min_market_cap_yi,
            max_market_cap_yi=max_market_cap_yi,
            start_date=start_date,
            end_date=end_date,
            limit=limit,
        )

    def get_market_cap_yi(self, symbol: str, start_date: str | None = None, end_date: str | None = None) -> float | None:
        return self.repository.get_market_cap_yi(symbol, start_date, end_date)

    def get_latest_minute_trade_date(self, symbol: str, start_date: str | None = None, end_date: str | None = None) -> str | None:
        return self.repository.latest_minute_trade_date(symbol, start_date, end_date, "1m")

    def find_minute_amount_triggers(
        self,
        symbols: list[str],
        start_date: str | None = None,
        end_date: str | None = None,
        start_time: str = "09:30:00",
        end_time: str = "10:30:00",
        min_amount: float = 50_000_000,
        consecutive_minutes: int = 3,
        limit: int = 20,
    ):
        return self.repository.find_minute_amount_triggers(
            symbols=symbols,
            start_date=start_date,
            end_date=end_date,
            start_time=start_time,
            end_time=end_time,
            min_amount=min_amount,
            consecutive_minutes=consecutive_minutes,
            limit=limit,
        )

    def get_daily_bars(self, symbol: str, start_date: str | None = None, end_date: str | None = None):
        items = []
        page = 1
        while True:
            query = PageQuery(
                page=page,
                page_size=200,
                sort_field="trade_date",
                sort_order="asc",
                start_date=start_date,
                end_date=end_date,
            )
            result = self.repository.list_daily_kline(query, symbol)
            items.extend(item.model_dump() for item in result.items)
            if not result.has_more or page >= 50:
                break
            page += 1
        return items

    def get_minute_bars(self, symbol: str, start_time: str | None = None, end_time: str | None = None):
        return self.repository.list_minute_kline_rows(
            symbol,
            start_time or "1900-01-01 00:00:00",
            end_time or "9999-12-31 23:59:59",
            "1m",
            limit=5000,
        )

    def get_latest_price(self, symbol: str) -> float:
        quotes = self.repository.latest_quotes([symbol])
        return quotes[0].last_price if quotes else 0.0

    def get_account_snapshot(self):
        account = self.repository.latest_account()
        return account.model_dump() if account else None

    def get_positions(self):
        return [item.model_dump() for item in self.repository.list_positions(PageQuery(page=1, page_size=200), latest_only=True).items]

    def get_trading_calendar(self, start_date: str, end_date: str):
        items = []
        page = 1
        while True:
            query = PageQuery(
                page=page,
                page_size=200,
                sort_field="trade_date",
                sort_order="asc",
                start_date=start_date,
                end_date=end_date,
            )
            result = self.repository.list_trading_calendar(query)
            items.extend(item.model_dump() for item in result.items)
            if not result.has_more or page >= 20:
                break
            page += 1
        return items

    def log(self, message: str) -> None:
        self.logs.append(str(message))
