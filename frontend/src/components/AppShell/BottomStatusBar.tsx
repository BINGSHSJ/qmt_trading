export default function BottomStatusBar() {
  return (
    <footer className="app-shell__bottom-status" aria-label="本地运行状态">
      <span className="app-shell__bottom-status-item app-shell__bottom-status-item--ok">LOCAL</span>
      <span className="app-shell__bottom-status-item">SQLite 本地落库</span>
      <span className="app-shell__bottom-status-item">真实 QMT 只读优先</span>
      <span className="app-shell__bottom-status-item">自动实盘默认关闭</span>
      <span className="app-shell__bottom-status-fill" />
      <span className="app-shell__bottom-status-item">Local Quant Console</span>
    </footer>
  );
}
