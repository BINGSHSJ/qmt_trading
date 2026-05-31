import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import AppShell from '../components/AppShell';
import { menuItems } from './menu';

const Dashboard = lazy(() => import('../pages/Dashboard/Dashboard'));
const DataCenter = lazy(() => import('../pages/DataCenter/DataCenter'));
const StrategyDev = lazy(() => import('../pages/StrategyDev/StrategyDev'));
const BacktestResearch = lazy(() => import('../pages/BacktestResearch/BacktestResearch'));
const TradingExecution = lazy(() => import('../pages/TradingExecution/TradingExecution'));
const SystemManage = lazy(() => import('../pages/SystemManage/SystemManage'));
const NotFoundPage = lazy(() => import('../pages/NotFound/NotFoundPage'));

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const selectedKey = menuItems.find((item) => location.pathname === item.key || location.pathname.startsWith(`${item.key}/`))?.key;

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const scrollTargets = document.querySelectorAll<HTMLElement>('.module-page, .workspace-canvas, .app-content');
      scrollTargets.forEach((target) => {
        if (target.scrollTop > 0) {
          target.scrollTo({ top: 0, left: 0 });
        }
      });
      window.scrollTo({ top: 0, left: 0 });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [location.pathname, location.search]);

  return (
    <AppShell selectedKey={selectedKey} menu={menuItems} onNavigate={(key) => navigate(key)}>
      <Suspense
        fallback={
          <div className="app-page-loading">
            <span className="page-loading-dot" />
            <span>正在加载页面...</span>
          </div>
        }
      >
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/data-center" element={<DataCenter />} />
          <Route path="/strategy-dev" element={<StrategyDev />} />
          <Route path="/backtest" element={<BacktestResearch />} />
          <Route path="/trading" element={<TradingExecution />} />
          <Route path="/system" element={<SystemManage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
}
