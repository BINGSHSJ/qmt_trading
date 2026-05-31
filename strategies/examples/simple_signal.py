class Strategy:
    name = "示例信号策略"
    version = "1.0.0"
    description = "读取最新价格并生成一个 WATCH 信号。"
    params = {
        "symbol": "600000.SH"
    }

    def __init__(self, context):
        self.context = context

    def run(self):
        symbol = self.params["symbol"]
        price = self.context.get_latest_price(symbol)
        self.context.log(f"读取 {symbol} 最新价：{price}")
        return [
            {
                "symbol": symbol,
                "name": "浦发银行",
                "action": "WATCH",
                "price": price,
                "amount": 0,
                "reason": "示例策略：观察最新价。",
            }
        ]
