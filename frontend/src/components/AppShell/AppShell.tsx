import { Layout, Menu } from 'antd';
import type { ReactNode } from 'react';
import StatusStrip from '../StatusStrip';
import { designTokens } from '../../theme/tokens';
import type { AppMenuItems } from '../../app/menu';
import BottomStatusBar from './BottomStatusBar';
import { useThemeMode } from '../../theme/ThemeModeContext';

interface AppShellProps {
  selectedKey?: string;
  menu: AppMenuItems;
  onNavigate: (key: string) => void;
  children: ReactNode;
}

export default function AppShell({ selectedKey, menu, onNavigate, children }: AppShellProps) {
  const activeItem = menu.find((item) => item.key === selectedKey) ?? menu[0];
  const { mode } = useThemeMode();

  return (
    <Layout className="app-shell">
      <Layout.Sider width={designTokens.sidebarWidth} className="app-shell__sider">
        <div className="app-shell__brand" aria-label="本地量化控制台" title="本地量化控制台">
          <div className="app-shell__brand-mark" aria-hidden="true">LQ</div>
        </div>
        <nav className="app-shell__nav" aria-label="六大主菜单">
          <Menu
            theme={mode}
            mode="inline"
            selectedKeys={selectedKey ? [selectedKey] : []}
            items={[...menu]}
            onClick={({ key }) => onNavigate(String(key))}
            className="app-shell__menu"
          />
        </nav>
      </Layout.Sider>
      <Layout className="app-shell__main">
        <div className="app-shell__top-chrome">
          <StatusStrip workspaceTitle={activeItem?.label} workspaceIcon={activeItem?.icon} />
        </div>
        <Layout.Content className="app-content">
          <div className="workspace-canvas">{children}</div>
        </Layout.Content>
        <BottomStatusBar />
      </Layout>
    </Layout>
  );
}
