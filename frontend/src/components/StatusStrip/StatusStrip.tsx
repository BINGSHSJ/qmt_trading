import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Tooltip, Typography } from 'antd';
import { BgColorsOutlined, ClockCircleOutlined, SettingOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import StatusChip from '../StatusChip';
import { getDashboardSummary } from '../../services/dashboard';
import type { DashboardSummary } from '../../types/dashboard';
import { formatMoney } from '../../utils/format';
import { formatQmtModeLabel } from '../../utils/sourceLabels';
import { formatNow } from '../../utils/time';
import { useThemeMode } from '../../theme/ThemeModeContext';

const SUMMARY_POLL_MS = 30000;
const SUMMARY_CACHE_TTL_MS = 15000;
const SUMMARY_CACHE_KEY = 'lqc_status_strip_summary_cache';

interface StatusStripProps {
  workspaceTitle?: ReactNode;
  workspaceIcon?: ReactNode;
}

function readCachedSummary() {
  try {
    const raw = window.localStorage.getItem(SUMMARY_CACHE_KEY);
    if (!raw) return null;
    const payload = JSON.parse(raw) as { loadedAt?: number; summary?: DashboardSummary };
    if (!payload.loadedAt || !payload.summary) return null;
    if (Date.now() - payload.loadedAt > SUMMARY_CACHE_TTL_MS) return null;
    return payload.summary;
  } catch {
    return null;
  }
}

function writeCachedSummary(summary: DashboardSummary) {
  try {
    window.localStorage.setItem(SUMMARY_CACHE_KEY, JSON.stringify({ loadedAt: Date.now(), summary }));
  } catch {
    // Ignore cache failures; status strip should never block the app shell.
  }
}

export default function StatusStrip({ workspaceTitle, workspaceIcon }: StatusStripProps) {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [clock, setClock] = useState(formatNow());
  const inFlightRef = useRef(false);
  const { mode, setMode } = useThemeMode();

  useEffect(() => {
    const load = async (force = false) => {
      if (inFlightRef.current || document.hidden) return;
      if (!force) {
        const cached = readCachedSummary();
        if (cached) {
          setSummary(cached);
          return;
        }
      }
      inFlightRef.current = true;
      try {
        const nextSummary = await getDashboardSummary();
        writeCachedSummary(nextSummary);
        setSummary(nextSummary);
      } catch {
        setSummary(null);
      } finally {
        inFlightRef.current = false;
      }
    };
    const handleVisible = () => {
      if (!document.hidden) void load(true);
    };
    void load(true);
    const timer = window.setInterval(() => {
      setClock(formatNow());
      void load();
    }, SUMMARY_POLL_MS);
    document.addEventListener('visibilitychange', handleVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisible);
    };
  }, []);

  const qmtConnected = summary?.qmt_connected ?? false;
  const qmtMode = formatQmtModeLabel(summary?.qmt_mode, { testIsolation: '测试隔离', real: '真实只读' });
  const qmtText = !summary ? '未检测' : qmtConnected ? qmtMode : qmtMode === '未检测' ? '未检测' : '未连接';
  const qmtTone = !summary ? 'neutral' : qmtConnected ? 'success' : 'warning';
  const assetText = summary?.asset.has_account ? formatTerminalMoney(summary.asset.total_asset) : '暂无资产';
  const taskTone = summary?.failed_task_count ? 'danger' : 'info';
  const taskText = summary ? `${summary.running_task_count} 运行 / ${summary.failed_task_count} 失败` : '未加载';
  const stripTone = !qmtConnected || summary?.failed_task_count ? 'status-strip--warning' : '';
  const nextThemeMode = mode === 'dark' ? 'light' : 'dark';
  const currentThemeText = mode === 'dark' ? '深色' : '浅色';
  const nextThemeText = nextThemeMode === 'dark' ? '深色' : '浅色';

  return (
    <header className={`status-strip ${stripTone}`}>
      <div className="status-strip__workspace" aria-label="当前工作区">
        <span className="status-strip__workspace-icon">{workspaceIcon}</span>
        <span className="status-strip__workspace-copy">
          <Typography.Text className="status-strip__workspace-title">{workspaceTitle}</Typography.Text>
        </span>
      </div>
      <div className="status-strip__left">
        <div className="status-strip__chips">
          <Link className="status-strip__link" to="/system?tab=环境检测" aria-label="查看 QMT 环境检测">
            <StatusChip label="QMT" value={qmtText} tone={qmtTone} testId="status-qmt" />
          </Link>
          <Link className="status-strip__link" to="/dashboard" aria-label="查看资产总览">
            <StatusChip label="资产" value={assetText} tone={summary?.asset.has_account ? 'info' : 'neutral'} />
          </Link>
          <Link className="status-strip__link" to="/system?tab=运行监控" aria-label="查看运行监控">
            <StatusChip label="任务" value={taskText} tone={taskTone} />
          </Link>
        </div>
      </div>
      <div className="status-strip__right">
        <Typography.Text className="status-strip__clock">
          <ClockCircleOutlined /> {clock}
        </Typography.Text>
        <Tooltip title={`切换为${nextThemeText}主题`}>
          <Button
            aria-label={`切换为${nextThemeText}主题`}
            title={`切换为${nextThemeText}主题`}
            icon={<BgColorsOutlined />}
            data-testid="btn-theme-mode"
            className="status-strip__theme-toggle"
            onClick={() => setMode(nextThemeMode)}
          >
            {currentThemeText}
          </Button>
        </Tooltip>
        <Tooltip title="系统管理">
          <Link to="/system">
            <Button aria-label="打开系统管理" title="打开系统管理" icon={<SettingOutlined />} data-testid="btn-open-system" className="status-strip__settings" />
          </Link>
        </Tooltip>
      </div>
    </header>
  );
}

function formatTerminalMoney(value?: number | null) {
  const text = formatMoney(value).replace(/\s*元$/, '');
  return text === '暂无' ? text : `¥${text}`;
}
