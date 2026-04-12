-- 第2批收口：strategy 表新增 env_overrides 字段（JSON 文本）
ALTER TABLE strategy ADD COLUMN env_overrides TEXT NOT NULL DEFAULT '{}';
