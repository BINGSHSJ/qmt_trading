-- 首批建表迁移：9 张核心表 + 全部索引
-- 所有 CREATE 使用 IF NOT EXISTS，可重复执行

-- 1. strategy — 策略元数据
CREATE TABLE IF NOT EXISTS strategy (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    strategy_id   TEXT    NOT NULL UNIQUE,
    name          TEXT    NOT NULL DEFAULT '',
    description   TEXT    NOT NULL DEFAULT '',
    status        TEXT    NOT NULL DEFAULT 'registered',
    source_type   TEXT    NOT NULL DEFAULT 'strategy',
    config_json   TEXT    NOT NULL DEFAULT '{}',
    start_script  TEXT    NOT NULL DEFAULT '',
    stop_script   TEXT    NOT NULL DEFAULT '',
    working_dir   TEXT    NOT NULL DEFAULT '',
    created_at    DATETIME NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at    DATETIME NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ix_strategy_strategy_id ON strategy(strategy_id);

-- 2. strategy_runtime_state — 策略运行时状态
CREATE TABLE IF NOT EXISTS strategy_runtime_state (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    strategy_id         TEXT    NOT NULL,
    pid                 INTEGER NOT NULL DEFAULT 0,
    status              TEXT    NOT NULL DEFAULT 'stopped',
    last_heartbeat_time DATETIME,
    last_signal_time    DATETIME,
    error_message       TEXT    NOT NULL DEFAULT '',
    created_at          DATETIME NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at          DATETIME NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS ix_strategy_runtime_state_strategy_id ON strategy_runtime_state(strategy_id);

-- 3. signal_record — 策略信号记录
CREATE TABLE IF NOT EXISTS signal_record (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    signal_id       TEXT    NOT NULL UNIQUE,
    strategy_id     TEXT    NOT NULL,
    symbol          TEXT    NOT NULL DEFAULT '',
    signal_type     TEXT    NOT NULL DEFAULT 'BUY',
    signal_price    REAL    NOT NULL DEFAULT 0.0,
    target_volume   INTEGER NOT NULL DEFAULT 0,
    target_value    REAL    NOT NULL DEFAULT 0.0,
    confidence      REAL    NOT NULL DEFAULT 0.0,
    reason          TEXT    NOT NULL DEFAULT '',
    decision_status TEXT    NOT NULL DEFAULT 'pending',
    decision_reason TEXT    NOT NULL DEFAULT '',
    created_at      DATETIME NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS ix_signal_record_strategy_created ON signal_record(strategy_id, created_at);

-- 4. order_record — 委托记录
CREATE TABLE IF NOT EXISTS order_record (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id       TEXT    NOT NULL UNIQUE,
    signal_id      TEXT,
    strategy_id    TEXT    NOT NULL,
    account_id     TEXT    NOT NULL DEFAULT '',
    symbol         TEXT    NOT NULL DEFAULT '',
    order_type     TEXT    NOT NULL DEFAULT 'BUY',
    price          REAL    NOT NULL DEFAULT 0.0,
    volume         INTEGER NOT NULL DEFAULT 0,
    filled_volume  INTEGER NOT NULL DEFAULT 0,
    filled_amount  REAL    NOT NULL DEFAULT 0.0,
    status         TEXT    NOT NULL DEFAULT 'pending',
    source_type    TEXT    NOT NULL DEFAULT 'strategy',
    remark         TEXT    NOT NULL DEFAULT '',
    created_at     DATETIME NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at     DATETIME NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS ix_order_record_strategy_created ON order_record(strategy_id, created_at);

-- 5. fill_record — 成交记录
CREATE TABLE IF NOT EXISTS fill_record (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    fill_id      TEXT    NOT NULL UNIQUE,
    order_id     TEXT    NOT NULL,
    strategy_id  TEXT    NOT NULL,
    account_id   TEXT    NOT NULL DEFAULT '',
    symbol       TEXT    NOT NULL DEFAULT '',
    fill_price   REAL    NOT NULL DEFAULT 0.0,
    fill_volume  INTEGER NOT NULL DEFAULT 0,
    fill_amount  REAL    NOT NULL DEFAULT 0.0,
    direction    TEXT    NOT NULL DEFAULT 'BUY',
    filled_at    DATETIME NOT NULL DEFAULT (datetime('now', 'localtime')),
    created_at   DATETIME NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS ix_fill_record_order_id ON fill_record(order_id);

-- 6. position_snapshot — 持仓快照
CREATE TABLE IF NOT EXISTS position_snapshot (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id       TEXT    NOT NULL DEFAULT '',
    symbol           TEXT    NOT NULL DEFAULT '',
    volume           INTEGER NOT NULL DEFAULT 0,
    available_volume INTEGER NOT NULL DEFAULT 0,
    cost_price       REAL    NOT NULL DEFAULT 0.0,
    market_value     REAL    NOT NULL DEFAULT 0.0,
    profit           REAL    NOT NULL DEFAULT 0.0,
    profit_pct       REAL    NOT NULL DEFAULT 0.0,
    source_type      TEXT    NOT NULL DEFAULT 'unattributed',
    snapshot_time    DATETIME NOT NULL DEFAULT (datetime('now', 'localtime')),
    created_at       DATETIME NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS ix_position_snapshot_acct_sym_time ON position_snapshot(account_id, symbol, snapshot_time);

-- 7. risk_event — 风控拦截事件
CREATE TABLE IF NOT EXISTS risk_event (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    strategy_id  TEXT    NOT NULL,
    signal_id    TEXT,
    rule_name    TEXT    NOT NULL DEFAULT '',
    risk_level   TEXT    NOT NULL DEFAULT 'medium',
    description  TEXT    NOT NULL DEFAULT '',
    detail_json  TEXT    NOT NULL DEFAULT '{}',
    created_at   DATETIME NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS ix_risk_event_strategy_created ON risk_event(strategy_id, created_at);
CREATE INDEX IF NOT EXISTS ix_risk_event_risk_level ON risk_event(risk_level);

-- 8. system_log — 系统日志
CREATE TABLE IF NOT EXISTS system_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    module      TEXT    NOT NULL DEFAULT '',
    level       TEXT    NOT NULL DEFAULT 'INFO',
    message     TEXT    NOT NULL DEFAULT '',
    detail      TEXT    NOT NULL DEFAULT '',
    request_id  TEXT    NOT NULL DEFAULT '',
    created_at  DATETIME NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS ix_system_log_module_created ON system_log(module, created_at);

-- 9. audit_log — 审计日志
CREATE TABLE IF NOT EXISTS audit_log (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    action       TEXT    NOT NULL DEFAULT '',
    target_type  TEXT    NOT NULL DEFAULT '',
    target_id    TEXT    NOT NULL DEFAULT '',
    before_json  TEXT    NOT NULL DEFAULT '{}',
    after_json   TEXT    NOT NULL DEFAULT '{}',
    operator     TEXT    NOT NULL DEFAULT 'system',
    remark       TEXT    NOT NULL DEFAULT '',
    created_at   DATETIME NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS ix_audit_log_target ON audit_log(target_type, target_id);
CREATE INDEX IF NOT EXISTS ix_audit_log_created ON audit_log(created_at);
