"""验证 Adapter 层 mock 数据完整性"""
import httpx, json

BASE = "http://127.0.0.1:8001"
HEADERS = {"X-API-Key": "dev-api-key-change-me"}
results = []

def check(name, ok, detail=""):
    tag = "PASS" if ok else "FAIL"
    results.append(ok)
    print(f"[{len(results)}] {name}: {tag}  {detail}")

# 1) system-health 返回 components
r = httpx.get(f"{BASE}/api/v1/system-health", headers=HEADERS)
d = r.json()
data = d["data"]
check("system-health 200", r.status_code == 200)
check("mock_mode=true", data["mock_mode"] is True)
check("mode=simulated", data["mode"] == "simulated")
check("status=normal", data["status"] == "normal")
check("components.xtdata exists", "xtdata" in data.get("components", {}))
check("components.xttrader exists", "xttrader" in data.get("components", {}))
check("xtdata.connected=true", data["components"]["xtdata"]["connected"] is True)
check("xtdata.mode=mock", data["components"]["xtdata"]["mode"] == "mock")
check("xttrader.connected=true", data["components"]["xttrader"]["connected"] is True)
check("xttrader.mode=mock", data["components"]["xttrader"]["mode"] == "mock")

# 2) 直接实例化 adapter 测试 mock 数据
print("\n--- 直接测试 adapter 数据完整性 ---")
import asyncio
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
os.chdir(os.path.join(os.path.dirname(os.path.dirname(__file__))))

from app.adapters.xtdata_adapter import MockXtdataAdapter
from app.adapters.xttrader_adapter import MockXttraderAdapter

async def test_adapters():
    xd = MockXtdataAdapter()
    xt = MockXttraderAdapter()
    acct = "40235910"

    # xtdata: single snapshot
    snap = await xd.get_market_snapshot("000001.SZ")
    check("xtdata.snapshot has last_price", snap.get("last_price", 0) > 0, f"price={snap.get('last_price')}")
    check("xtdata.snapshot has name", snap.get("name") == "平安银行")

    # xtdata: batch snapshots
    snaps = await xd.get_market_snapshots(["000001.SZ", "600519.SH", "999999.XX"])
    check("xtdata.batch returns 3", len(snaps) == 3)
    check("xtdata.unknown symbol handled", snaps[2].get("last_price") == 0.0)

    # xtdata: instrument info
    info = await xd.get_instrument_info("600519.SH")
    check("xtdata.instrument_info has exchange", info.get("exchange") == "SH")

    # xtdata: health
    h = await xd.check_health()
    check("xtdata.health.connected", h["connected"] is True)

    # xttrader: positions
    positions = await xt.query_positions(acct)
    check("xttrader.positions count>=3", len(positions) >= 3, f"count={len(positions)}")
    p0 = positions[0]
    check("position has volume", p0.get("volume", 0) > 0)
    check("position has market_value", p0.get("market_value", 0) > 0)

    # xttrader: orders
    orders = await xt.query_orders(acct)
    check("xttrader.orders count>=3", len(orders) >= 3, f"count={len(orders)}")
    check("order has status", "status" in orders[0])

    # xttrader: fills
    fills = await xt.query_fills(acct)
    check("xttrader.fills count>=2", len(fills) >= 2, f"count={len(fills)}")
    check("fill has fill_price", fills[0].get("fill_price", 0) > 0)

    # xttrader: account
    account = await xt.query_account(acct)
    check("xttrader.account total_asset>0", account.get("total_asset", 0) > 0, f"total={account.get('total_asset')}")
    check("account has cash", account.get("cash", 0) > 0)

    # xttrader: place_order
    result = await xt.place_order(acct, "000001.SZ", "BUY", 12.35, 1000)
    check("place_order returns order_id", result.get("order_id", "").startswith("MOCK-ORD-"))
    check("place_order status=submitted", result.get("status") == "submitted")

    # xttrader: cancel_order
    cancel = await xt.cancel_order(acct, "MOCK-ORD-001")
    check("cancel_order status=canceled", cancel.get("status") == "canceled")

    # xttrader: health
    h2 = await xt.check_health()
    check("xttrader.health.connected", h2["connected"] is True)

asyncio.run(test_adapters())

# Summary
print()
passed = sum(results)
total = len(results)
print(f"=== {passed}/{total} PASS ===" if all(results) else f"=== {passed}/{total} — SOME FAILED ===")
