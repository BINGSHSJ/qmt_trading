import type { PageResult } from './api';

export interface StrategyFileRecord {
  id: number;
  file_name: string;
  file_path: string;
  strategy_name: string;
  version: string;
  description: string;
  status: string;
  last_modified_at?: string | null;
  last_run_at?: string | null;
  created_at: string;
  today_signal_count: number;
}

export interface StrategyContent {
  strategy_id: number;
  file_name: string;
  code_content: string;
}

export interface StrategyValidationResult {
  valid: boolean;
  message: string;
  technical_detail?: string | null;
  strategy_name?: string | null;
  version?: string | null;
  description?: string | null;
}

export interface StrategyRunRecord {
  id: number;
  run_id: string;
  strategy_id: number;
  strategy_name?: string;
  strategy_file_name?: string;
  strategy_version?: string;
  strategy_code_hash?: string;
  task_id: string;
  status: string;
  signal_count: number;
  started_at?: string | null;
  finished_at?: string | null;
  message: string;
  technical_detail?: string | null;
}

export interface StrategySignalRecord {
  id: number;
  strategy_id: number;
  run_id: string;
  strategy_name: string;
  symbol: string;
  name: string;
  action: string;
  price: number;
  amount?: number | null;
  reason: string;
  status: string;
  signal_time: string;
  created_at: string;
}

export interface StrategyVersionRecord {
  id: number;
  strategy_id: number;
  version_no: string;
  code_hash: string;
  remark?: string | null;
  created_at: string;
}

export interface StrategyVersionDetail extends StrategyVersionRecord {
  code_content: string;
}

export type StrategyFilePage = PageResult<StrategyFileRecord>;
export type StrategyRunPage = PageResult<StrategyRunRecord>;
export type StrategySignalPage = PageResult<StrategySignalRecord>;
export type StrategyVersionPage = PageResult<StrategyVersionRecord>;
