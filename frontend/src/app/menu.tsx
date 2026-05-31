import {
  BarChartOutlined,
  CodeOutlined,
  DatabaseOutlined,
  ExperimentOutlined,
  HomeOutlined,
  SettingOutlined,
  TransactionOutlined,
} from '@ant-design/icons';

export const menuItems = [
  { key: '/dashboard', icon: <HomeOutlined />, label: '总览看板' },
  { key: '/data-center', icon: <DatabaseOutlined />, label: '数据中心' },
  { key: '/strategy-dev', icon: <CodeOutlined />, label: '策略开发' },
  { key: '/backtest', icon: <ExperimentOutlined />, label: '回测研究' },
  { key: '/trading', icon: <TransactionOutlined />, label: '交易执行' },
  { key: '/system', icon: <SettingOutlined />, label: '系统管理' },
] as const;

export type AppMenuItems = typeof menuItems;

export const dashboardIcon = <BarChartOutlined />;
