import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const shouldCapture = process.env.LQC_CAPTURE_DEVICE_DENSITY === '1';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outputDir = path.resolve(__dirname, '../../../docs/reports/screenshots/device-density-20260523');

const routes = [
  { url: '/dashboard', title: '总览看板', slug: 'dashboard' },
  { url: '/data-center', title: '数据中心', slug: 'data-center' },
  { url: '/data-center?tab=数据来源', title: '数据中心', slug: 'data-center-source' },
  { url: '/data-center?tab=账户数据', title: '数据中心', slug: 'data-center-account' },
  { url: '/data-center?tab=行情数据', title: '数据中心', slug: 'data-center-market' },
  { url: '/data-center?tab=基础资料', title: '数据中心', slug: 'data-center-basic' },
  { url: '/data-center?tab=数据同步', title: '数据中心', slug: 'data-center-sync' },
  { url: '/data-center?tab=数据质量', title: '数据中心', slug: 'data-center-quality' },
  { url: '/data-center?tab=数据字典', title: '数据中心', slug: 'data-center-dictionary' },
  { url: '/strategy-dev', title: '策略开发', slug: 'strategy-dev' },
  { url: '/strategy-dev?tab=代码编辑', title: '策略开发', slug: 'strategy-dev-editor' },
  { url: '/strategy-dev?tab=运行调试', title: '策略开发', slug: 'strategy-dev-runs' },
  { url: '/strategy-dev?tab=策略信号', title: '策略开发', slug: 'strategy-dev-signals' },
  { url: '/strategy-dev?tab=版本记录', title: '策略开发', slug: 'strategy-dev-versions' },
  { url: '/backtest', title: '回测研究', slug: 'backtest' },
  { url: '/backtest?tab=回测任务', title: '回测研究', slug: 'backtest-tasks' },
  { url: '/backtest?tab=绩效结果', title: '回测研究', slug: 'backtest-report' },
  { url: '/backtest?tab=交易明细', title: '回测研究', slug: 'backtest-trades' },
  { url: '/backtest?tab=回测日志', title: '回测研究', slug: 'backtest-logs' },
  { url: '/trading', title: '交易执行', slug: 'trading' },
  { url: '/trading?tab=交易面板', title: '交易执行', slug: 'trading-panel' },
  { url: '/trading?tab=当前持仓', title: '交易执行', slug: 'trading-positions' },
  { url: '/trading?tab=委托记录', title: '交易执行', slug: 'trading-orders' },
  { url: '/trading?tab=成交记录', title: '交易执行', slug: 'trading-trades' },
  { url: '/trading?tab=执行日志', title: '交易执行', slug: 'trading-logs' },
  { url: '/system', title: '系统管理', slug: 'system' },
  { url: '/system?tab=基础设置', title: '系统管理', slug: 'system-basic' },
  { url: '/system?tab=环境检测', title: '系统管理', slug: 'system-env' },
  { url: '/system?tab=交易设置', title: '系统管理', slug: 'system-trading-settings' },
  { url: '/system?tab=策略设置', title: '系统管理', slug: 'system-strategy-settings' },
  { url: '/system?tab=日志中心', title: '系统管理', slug: 'system-logs' },
  { url: '/system?tab=运行监控', title: '系统管理', slug: 'system-monitor' },
  { url: '/system?tab=备份恢复', title: '系统管理', slug: 'system-backups' },
  { url: '/system?tab=操作记录', title: '系统管理', slug: 'system-operations' },
];

const viewports = [
  { name: 'macbook-pro-14-effective', width: 1512, height: 982 },
  { name: 'macbook-pro-14-browser-safe', width: 1512, height: 820 },
  { name: 'macbook-pro-14-chrome-safe', width: 1512, height: 702 },
  { name: 'windows-27-qhd', width: 2560, height: 1440 },
  { name: 'windows-27-4k-125-effective', width: 3072, height: 1728 },
];

const isMacViewport = (viewportName: string) => viewportName.startsWith('macbook-pro-14');
const isShortMacViewport = (viewportName: string) => (
  viewportName === 'macbook-pro-14-browser-safe' || viewportName === 'macbook-pro-14-chrome-safe'
);
const is4kViewport = (viewportName: string) => viewportName === 'windows-27-4k-125-effective';

async function closeTransientOverlays(page: Page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const visibleDialogCount = await page.locator('.ant-modal-root .ant-modal:visible, [role="dialog"]:visible').count();
    if (visibleDialogCount === 0) return;

    const closeButton = page.locator(
      [
        '.ant-modal-root .ant-modal:visible .ant-modal-close',
        '[role="dialog"]:visible .ant-modal-close',
        '[role="dialog"]:visible button[aria-label="Close"]',
        '[role="dialog"]:visible button:has-text("关闭")',
      ].join(', '),
    ).first();

    if (await closeButton.isVisible().catch(() => false)) {
      await closeButton.click({ force: true });
    } else {
      await page.keyboard.press('Escape');
    }

    await page.waitForTimeout(120);
  }
}

function getMaxBottomBlankHeight(viewportName: string) {
  if (is4kViewport(viewportName)) {
    return 30;
  }
  if (isMacViewport(viewportName)) {
    return 30;
  }
  return 30;
}

function getExpectedContentCoverage(routeUrl: string, viewportName: string) {
  const isMac = isMacViewport(viewportName);
  const is4k = is4kViewport(viewportName);

  if (routeUrl === '/dashboard') {
    return isMac ? 0.98 : is4k ? 0.95 : 0.94;
  }
  if (routeUrl === '/strategy-dev') {
    return isMac ? 0.95 : is4k ? 0.84 : 0.9;
  }
  if (routeUrl === '/strategy-dev?tab=代码编辑') {
    return isMac ? 0.98 : is4k ? 0.88 : 0.92;
  }
  if (
    routeUrl === '/strategy-dev?tab=运行调试' ||
    routeUrl === '/strategy-dev?tab=策略信号' ||
    routeUrl === '/strategy-dev?tab=版本记录'
  ) {
    return isMac ? 0.9 : is4k ? 0.78 : 0.9;
  }
  if (routeUrl === '/backtest') {
    return isMac ? 0.9 : is4k ? 0.78 : 0.9;
  }
  if (routeUrl === '/backtest?tab=绩效结果') {
    return isMac ? 0.9 : is4k ? 0.62 : 0.7;
  }
  if (routeUrl === '/backtest?tab=交易明细') {
    return isMac ? 0.9 : is4k ? 0.7 : 0.82;
  }
  if (routeUrl === '/backtest?tab=回测日志') {
    return isMac ? 0.98 : is4k ? 0.95 : 0.95;
  }
  if (
    routeUrl === '/trading' ||
    routeUrl === '/trading?tab=当前持仓' ||
    routeUrl === '/trading?tab=委托记录' ||
    routeUrl === '/trading?tab=成交记录' ||
    routeUrl === '/trading?tab=执行日志'
  ) {
    return isMac ? 0.9 : is4k ? 0.85 : 0.9;
  }
  if (routeUrl === '/trading?tab=交易面板') {
    return isMac ? 0.98 : is4k ? 0.95 : 0.95;
  }
  if (routeUrl === '/data-center?tab=账户数据' || routeUrl === '/data-center?tab=基础资料') {
    return isMac ? 0.98 : 0.95;
  }
  if (routeUrl === '/data-center?tab=数据来源') {
    return isMac ? 0.95 : is4k ? 0.82 : 0.9;
  }
  if (routeUrl === '/data-center?tab=数据字典') {
    return isMac ? 0.95 : is4k ? 0.82 : 0.9;
  }
  if (routeUrl === '/data-center?tab=数据同步') {
    return isMac ? 0.98 : is4k ? 0.9 : 0.94;
  }
  if (routeUrl === '/system' || routeUrl === '/system?tab=基础设置') {
    return isMac ? 0.98 : is4k ? 0.95 : 0.94;
  }
  if (routeUrl === '/system?tab=环境检测') {
    return isMac ? 0.98 : 0.95;
  }
  if (routeUrl === '/system?tab=交易设置') {
    return isMac ? 0.94 : is4k ? 0.95 : 0.95;
  }
  if (routeUrl === '/system?tab=策略设置') {
    return isMac ? 0.98 : is4k ? 0.95 : 0.95;
  }
  if (routeUrl === '/system?tab=日志中心' || routeUrl === '/system?tab=操作记录') {
    return isMac ? 0.96 : is4k ? 0.86 : 0.9;
  }

  return null;
}

async function readPageMetrics(page: Page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const style = window.getComputedStyle(root);
    const modulePage = document.querySelector<HTMLElement>('.module-page');
    const status = document.querySelector<HTMLElement>('.status-strip');
    const appContent = document.querySelector<HTMLElement>('.app-content');
    const bottomStatus = document.querySelector<HTMLElement>(
      '.app-shell__bottom-status, .bottom-status-bar, .app-bottom-status, .terminal-statusbar',
    );
    const sider = document.querySelector<HTMLElement>('.app-shell__sider');
    const commandItems = Array.from(document.querySelectorAll<HTMLElement>('.command-panel__item'));
    const metricCards = Array.from(document.querySelectorAll<HTMLElement>('.metric-strip .metric-card'));
    const tables = Array.from(document.querySelectorAll<HTMLElement>('.ant-table-wrapper'));
    const cards = Array.from(document.querySelectorAll<HTMLElement>('.ant-card, .workspace-panel, .data-table'));
    const isVisible = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect();
      const elementStyle = window.getComputedStyle(element);
      return (
        rect.width > 8 &&
        rect.height > 8 &&
        elementStyle.display !== 'none' &&
        elementStyle.visibility !== 'hidden' &&
        elementStyle.opacity !== '0'
      );
    };
    const buttons = Array.from(document.querySelectorAll<HTMLElement>('.ant-btn')).filter(isVisible);
    const inputs = Array.from(
      document.querySelectorAll<HTMLElement>(
        '.ant-input, .ant-input-affix-wrapper, .ant-input-number, .ant-picker, .ant-select-selector',
      ),
    ).filter((element) => isVisible(element) && !(element.closest('.monaco-editor') && ['INPUT', 'TEXTAREA'].includes(element.tagName)));
    const actionableElements = Array.from(
      document.querySelectorAll<HTMLElement>(
        [
          'button',
          'a[href]',
          'input',
          'textarea',
          '.ant-select-selector',
          '.ant-picker',
          '.ant-tabs-tab',
          '[role="button"]',
          '.ant-pagination-item',
          '.ant-pagination-prev',
          '.ant-pagination-next',
        ].join(', '),
      ),
    ).filter(isVisible);
    const actionZones = Array.from(
      document.querySelectorAll<HTMLElement>(
        '.page-header-actions, .command-panel__actions, .toolbar, .data-table__toolbar, .backtest-report-workbench__topbar-meta, .strategy-workflow-actions, .backtest-task-flow-actions, .trading-signal-flow-actions, .system-form-actions',
      ),
    ).filter(isVisible);
    const strategyWorkflowRail = document.querySelector<HTMLElement>('.strategy-file-layout__rail');
    const backtestTaskFlowRail = document.querySelector<HTMLElement>('.backtest-task-layout__rail');
    const tradingSignalSafetyRail = document.querySelector<HTMLElement>('.trading-signal-layout__rail');
    const tradingManualWorkbench = document.querySelector<HTMLElement>('.trading-manual-workbench');
    const tradingRecordWorkbench = document.querySelector<HTMLElement>('.trading-record-workbench');
    const dataSyncWorkbench = document.querySelector<HTMLElement>('.data-sync-workbench');
    const dataSourceWorkbench = document.querySelector<HTMLElement>('.data-source-workbench');
    const dataDictionaryWorkbench = document.querySelector<HTMLElement>('.data-dictionary-workbench');
    const systemAuditWorkbench = document.querySelector<HTMLElement>('.system-audit-workbench-card');
    const systemSettingsWorkbench = document.querySelector<HTMLElement>('.system-settings-workbench');
    const systemPathInputs = Array.from(document.querySelectorAll<HTMLElement>('.system-path-input-grid .ant-input-search')).filter(isVisible);
    const marketKlineWorkbench = document.querySelector<HTMLElement>('.market-kline-workbench');
    const klineCanvas = document.querySelector<HTMLElement>('.market-kline-workbench .kline-chart__canvas');
    const strategyEditorWorkbench = document.querySelector<HTMLElement>('.strategy-workbench');
    const strategyEditorShell = document.querySelector<HTMLElement>('.strategy-editor-shell, .strategy-editor-skeleton');
    const backtestReportWorkbench = document.querySelector<HTMLElement>('.backtest-report-workbench');
    const backtestReportEmptyWorkbench = document.querySelector<HTMLElement>('.backtest-report-empty-workbench');
    const dashboardDetailTabs = document.querySelector<HTMLElement>('.dashboard-detail-tabs');
    const dashboardTaskList = document.querySelector<HTMLElement>('.dashboard-task-list');
    const emptyGuides = Array.from(document.querySelectorAll<HTMLElement>('.empty-guide')).filter(isVisible);
    const emptyRows = Array.from(document.querySelectorAll<HTMLElement>('.ant-table-placeholder')).filter(isVisible);
    const countRows = (items: HTMLElement[]) => {
      const centers = items
        .filter(isVisible)
        .map((item) => {
          const rect = item.getBoundingClientRect();
          return Math.round(rect.top + rect.height / 2);
        })
        .sort((a, b) => a - b);
      return centers.reduce<number[]>((rows, center) => {
        if (!rows.some((rowCenter) => Math.abs(rowCenter - center) <= 6)) rows.push(center);
        return rows;
      }, []).length;
    };
    const pageHeaderRows = Math.max(
      countRows(Array.from(document.querySelectorAll<HTMLElement>('.page-header-actions > .ant-space-item'))),
      countRows(Array.from(document.querySelectorAll<HTMLElement>('.dashboard-header-actions > .ant-space-item'))),
    );
    const commandActionRows = countRows(Array.from(document.querySelectorAll<HTMLElement>('.command-panel__actions > .ant-space-item')));
    const moduleChildren = modulePage
      ? Array.from(modulePage.children).filter((child): child is HTMLElement => child instanceof HTMLElement && isVisible(child))
      : [];
    const contentLandmarks = Array.from(
      document.querySelectorAll<HTMLElement>(
        [
          '.backtest-report-empty-workbench',
          '.backtest-report-workbench',
          '.data-table',
          '.strategy-workbench',
          '.system-settings-workbench',
          '.market-kline-workbench',
          '.trading-signal-layout',
          '.trading-manual-workbench',
          '.trading-record-workbench',
          '.data-sync-workbench',
          '.data-source-workbench',
          '.data-dictionary-workbench',
          '.system-audit-workbench-card',
          '.system-config-workbench-card',
          '.backtest-task-layout',
          '.strategy-file-layout',
        ].join(', '),
      ),
    ).filter(isVisible);
    const directChildRects = moduleChildren
      .map((child) => child.getBoundingClientRect())
      .filter((rect) => rect.width > 24 && rect.height > 16)
      .sort((a, b) => a.top - b.top);
    const childRects = [...moduleChildren, ...contentLandmarks]
      .map((child) => child.getBoundingClientRect())
      .filter((rect) => rect.width > 24 && rect.height > 16)
      .sort((a, b) => a.top - b.top);
    const bottomStatusRect = bottomStatus && isVisible(bottomStatus)
      ? bottomStatus.getBoundingClientRect()
      : null;
    const appContentRect = appContent && isVisible(appContent)
      ? appContent.getBoundingClientRect()
      : null;
    const statusTop = bottomStatusRect ? bottomStatusRect.top : window.innerHeight;
    const firstModuleTop = childRects.length ? Math.min(...childRects.map((rect) => rect.top)) : 0;
    const lastModuleBottom = childRects.length
      ? Math.max(...childRects.map((rect) => Math.min(rect.bottom, statusTop)))
      : 0;
    const availableModuleHeight = Math.max(1, statusTop - firstModuleTop);
    const contentCoverage = childRects.length
      ? Number(((lastModuleBottom - firstModuleTop) / availableModuleHeight).toFixed(3))
      : 0;
    const bottomBlankHeight = childRects.length ? Math.round(Math.max(0, statusTop - lastModuleBottom)) : 0;
    const directModuleGaps = directChildRects
      .slice(1)
      .map((rect, index) => Math.max(0, Math.round(rect.top - directChildRects[index].bottom)));
    const hasHorizontalIntersection = (a: DOMRect, b: DOMRect) => {
      const overlap = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
      return overlap > Math.min(a.width, b.width) * 0.35;
    };
    const directModuleOverlapCount = directChildRects
      .slice(1)
      .filter((rect, index) => rect.top < directChildRects[index].bottom - 2 && hasHorizontalIntersection(directChildRects[index], rect))
      .length;
    const visibleFlowChildren = (parent: HTMLElement) => Array.from(parent.children)
      .filter((child): child is HTMLElement => child instanceof HTMLElement && isVisible(child))
      .filter((child) => {
        const childStyle = window.getComputedStyle(child);
        if (childStyle.position === 'absolute' || childStyle.position === 'fixed') return false;
        const rect = child.getBoundingClientRect();
        return rect.width > 40 && rect.height > 24;
      });
    const siblingOverlapCount = (parent: HTMLElement) => {
      const children = visibleFlowChildren(parent);
      let count = 0;
      for (let index = 0; index < children.length; index += 1) {
        const current = children[index].getBoundingClientRect();
        for (let nextIndex = index + 1; nextIndex < children.length; nextIndex += 1) {
          const next = children[nextIndex].getBoundingClientRect();
          const overlapWidth = Math.max(0, Math.min(current.right, next.right) - Math.max(current.left, next.left));
          const overlapHeight = Math.max(0, Math.min(current.bottom, next.bottom) - Math.max(current.top, next.top));
          const hasMeaningfulOverlap =
            overlapWidth > Math.min(current.width, next.width) * 0.35 &&
            overlapHeight > Math.max(4, Math.min(current.height, next.height) * 0.12);
          if (hasMeaningfulOverlap) count += 1;
        }
      }
      return count;
    };
    const nestedModuleOverlapCount = Array.from(new Set([...contentLandmarks, ...moduleChildren]))
      .reduce((count, parent) => count + siblingOverlapCount(parent), 0);
    const controlRoots = Array.from(
      document.querySelectorAll<HTMLElement>(
        [
          '.workspace-canvas > .module-page.module-page input.ant-input',
          '.workspace-canvas > .module-page.module-page .ant-input-affix-wrapper',
          '.workspace-canvas > .module-page.module-page .ant-input-number',
          '.workspace-canvas > .module-page.module-page .ant-picker',
          '.workspace-canvas > .module-page.module-page .ant-select-selector',
        ].join(', '),
      ),
    ).filter((element) => isVisible(element) && !(element.closest('.monaco-editor') && ['INPUT', 'TEXTAREA'].includes(element.tagName)));
    const getControlTextElement = (control: HTMLElement) => {
      if (control.matches('input.ant-input')) return control;
      const preferredVisibleText = [
        '.ant-select-selection-item',
        '.ant-select-selection-placeholder',
        'input.ant-input',
        '.ant-input-number-input',
        '.ant-picker-input > input',
      ]
        .map((selector) => control.querySelector<HTMLElement>(selector))
        .find((element): element is HTMLElement => Boolean(element && isVisible(element)));
      return preferredVisibleText ?? control.querySelector<HTMLElement>('.ant-select-selection-search-input');
    };
    const controlTextMetrics = controlRoots
      .map((control) => {
        const textElement = getControlTextElement(control);
        if (!textElement || !isVisible(textElement)) return null;
        const controlRect = control.getBoundingClientRect();
        const textRect = textElement.getBoundingClientRect();
        const textStyle = window.getComputedStyle(textElement);
        const rawLineHeight = Number.parseFloat(textStyle.lineHeight);
        const fontSize = Number.parseFloat(textStyle.fontSize);
        const lineHeight = Number.isFinite(rawLineHeight) ? rawLineHeight : fontSize * 1.2;
        const centerDrift = Math.abs(
          (textRect.top + textRect.height / 2) - (controlRect.top + controlRect.height / 2),
        );
        return {
          centerDrift,
          lineOverflow: Math.max(0, lineHeight - Math.max(0, controlRect.height - 2)),
          outside: Math.max(0, controlRect.top - textRect.top) + Math.max(0, textRect.bottom - controlRect.bottom),
          controlHeight: controlRect.height,
        };
      })
      .filter((item): item is { centerDrift: number; lineOverflow: number; outside: number; controlHeight: number } => item !== null);
    const badControlTextAlignmentCount = controlTextMetrics.filter((item) => (
      item.centerDrift > 2.5 ||
      item.lineOverflow > 1 ||
      item.outside > 1 ||
      item.controlHeight < 26 ||
      item.controlHeight > 32
    )).length;
    const isAllowedActionBlocker = (target: HTMLElement, top: Element | null) => {
      if (!top) return true;
      if (target === top || target.contains(top) || top.contains(target)) return true;
      if (top.closest('.ant-tooltip,.ant-dropdown,.ant-select-dropdown,.ant-picker-dropdown,.ant-popover,.ant-modal,.ant-message,.ant-notification')) return true;
      if (top.closest('.ant-spin')) return true;
      if (target.classList.contains('ant-select-selection-search-input') && top.closest('.ant-select-selection-item')) return true;
      if (target.closest('.ant-table-filter-trigger') && top.closest('.ant-table-cell')) return true;
      if (target.closest('.ant-table') && top.closest('.ant-table-cell-fix-left,.ant-table-cell-fix-right,.ant-table-sticky-scroll')) return true;
      return false;
    };
    const isPointInsideVisibleClip = (target: HTMLElement, x: number, y: number) => {
      let current = target.parentElement;
      while (current && current !== document.body) {
        const style = window.getComputedStyle(current);
        const overflow = `${style.overflow} ${style.overflowX} ${style.overflowY}`;
        if (/(auto|scroll|hidden|clip)/.test(overflow)) {
          const rect = current.getBoundingClientRect();
          if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return false;
        }
        current = current.parentElement;
      }
      return true;
    };
    const blockedActionCount = actionableElements.filter((target) => {
      const rect = target.getBoundingClientRect();
      const insetX = Math.min(8, Math.max(2, rect.width / 3));
      const points = [
        [rect.left + rect.width / 2, rect.top + rect.height / 2],
        [rect.left + insetX, rect.top + rect.height / 2],
        [rect.right - insetX, rect.top + rect.height / 2],
      ].filter(([x, y]) => x >= 0 && y >= 0 && x <= window.innerWidth && y <= window.innerHeight)
        .filter(([x, y]) => isPointInsideVisibleClip(target, x, y));
      if (points.length === 0) return false;
      return points.every(([x, y]) => !isAllowedActionBlocker(target, document.elementFromPoint(x, y)));
    }).length;

    return {
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      density: root.dataset.density ?? '',
      bodyOverflowX: root.scrollWidth - root.clientWidth,
      bodyOverflowY: Math.max(0, root.scrollHeight - root.clientHeight),
      moduleOverflowX: modulePage ? modulePage.scrollWidth - modulePage.clientWidth : 0,
      bottomStatusPosition: bottomStatus ? window.getComputedStyle(bottomStatus).position : '',
      appContentBottomGap: appContentRect && bottomStatusRect
        ? Math.round(bottomStatusRect.top - appContentRect.bottom)
        : 0,
      bottomStatusLeftDelta: appContentRect && bottomStatusRect
        ? Math.round(bottomStatusRect.left - appContentRect.left)
        : 0,
      bottomStatusRightDelta: appContentRect && bottomStatusRect
        ? Math.round(bottomStatusRect.right - appContentRect.right)
        : 0,
      appContentScrollable: appContent ? appContent.scrollHeight > appContent.clientHeight + 2 : false,
      sidebarWidth: Math.round(sider?.getBoundingClientRect().width ?? 0),
      statusHeight: Math.round(status?.getBoundingClientRect().height ?? 0),
      tableCount: tables.length,
      cardCount: cards.length,
      maxCommandItemWidth: commandItems.length
        ? Math.round(Math.max(...commandItems.map((item) => item.getBoundingClientRect().width)))
        : 0,
      maxMetricCardWidth: metricCards.length
        ? Math.round(Math.max(...metricCards.map((item) => item.getBoundingClientRect().width)))
        : 0,
      maxButtonHeight: buttons.length
        ? Math.round(Math.max(...buttons.map((item) => item.getBoundingClientRect().height)))
        : 0,
      maxInputHeight: inputs.length
        ? Math.round(Math.max(...inputs.map((item) => item.getBoundingClientRect().height)))
        : 0,
      minInputHeight: inputs.length
        ? Math.round(Math.min(...inputs.map((item) => item.getBoundingClientRect().height)))
        : 0,
      badControlTextAlignmentCount,
      maxControlTextCenterDrift: controlTextMetrics.length
        ? Number(Math.max(...controlTextMetrics.map((item) => item.centerDrift)).toFixed(2))
        : 0,
      maxControlLineOverflow: controlTextMetrics.length
        ? Number(Math.max(...controlTextMetrics.map((item) => item.lineOverflow)).toFixed(2))
        : 0,
      maxControlTextOutside: controlTextMetrics.length
        ? Number(Math.max(...controlTextMetrics.map((item) => item.outside)).toFixed(2))
        : 0,
      maxSystemPathInputWidth: systemPathInputs.length
        ? Math.round(Math.max(...systemPathInputs.map((item) => item.getBoundingClientRect().width)))
        : 0,
      maxEmptyGuideHeight: emptyGuides.length
        ? Math.round(Math.max(...emptyGuides.map((item) => item.getBoundingClientRect().height)))
        : 0,
      maxEmptyRowHeight: emptyRows.length
        ? Math.round(Math.max(...emptyRows.map((item) => item.getBoundingClientRect().height)))
        : 0,
      maxDirectModuleGap: directModuleGaps.length ? Math.max(...directModuleGaps) : 0,
      directModuleOverlapCount,
      nestedModuleOverlapCount,
      contentCoverage,
      bottomBlankHeight,
      actionZoneOverflowCount: actionZones.filter((zone) => {
        const rect = zone.getBoundingClientRect();
        return zone.scrollWidth > zone.clientWidth + 2 || zone.scrollHeight > Math.max(rect.height + 2, 64);
      }).length,
      blockedActionCount,
      pageHeaderRows,
      commandActionRows,
      strategyWorkflowRailWidth:
        strategyWorkflowRail && isVisible(strategyWorkflowRail)
          ? Math.round(strategyWorkflowRail.getBoundingClientRect().width)
          : 0,
      strategyWorkflowRailHeight:
        strategyWorkflowRail && isVisible(strategyWorkflowRail)
          ? Math.round(strategyWorkflowRail.getBoundingClientRect().height)
          : 0,
      backtestTaskFlowRailWidth:
        backtestTaskFlowRail && isVisible(backtestTaskFlowRail)
          ? Math.round(backtestTaskFlowRail.getBoundingClientRect().width)
          : 0,
      backtestTaskFlowRailHeight:
        backtestTaskFlowRail && isVisible(backtestTaskFlowRail)
          ? Math.round(backtestTaskFlowRail.getBoundingClientRect().height)
          : 0,
      tradingSignalSafetyRailWidth:
        tradingSignalSafetyRail && isVisible(tradingSignalSafetyRail)
          ? Math.round(tradingSignalSafetyRail.getBoundingClientRect().width)
          : 0,
      tradingSignalSafetyRailHeight:
        tradingSignalSafetyRail && isVisible(tradingSignalSafetyRail)
          ? Math.round(tradingSignalSafetyRail.getBoundingClientRect().height)
          : 0,
      tradingManualWorkbenchHeight:
        tradingManualWorkbench && isVisible(tradingManualWorkbench)
          ? Math.round(tradingManualWorkbench.getBoundingClientRect().height)
          : 0,
      tradingRecordWorkbenchHeight:
        tradingRecordWorkbench && isVisible(tradingRecordWorkbench)
          ? Math.round(tradingRecordWorkbench.getBoundingClientRect().height)
          : 0,
      dataSyncWorkbenchHeight:
        dataSyncWorkbench && isVisible(dataSyncWorkbench)
          ? Math.round(dataSyncWorkbench.getBoundingClientRect().height)
          : 0,
      dataSourceWorkbenchHeight:
        dataSourceWorkbench && isVisible(dataSourceWorkbench)
          ? Math.round(dataSourceWorkbench.getBoundingClientRect().height)
          : 0,
      dataDictionaryWorkbenchHeight:
        dataDictionaryWorkbench && isVisible(dataDictionaryWorkbench)
          ? Math.round(dataDictionaryWorkbench.getBoundingClientRect().height)
          : 0,
      systemAuditWorkbenchHeight:
        systemAuditWorkbench && isVisible(systemAuditWorkbench)
          ? Math.round(systemAuditWorkbench.getBoundingClientRect().height)
          : 0,
      systemSettingsWorkbenchWidth:
        systemSettingsWorkbench && isVisible(systemSettingsWorkbench)
          ? Math.round(systemSettingsWorkbench.getBoundingClientRect().width)
          : 0,
      systemSettingsWorkbenchHeight:
        systemSettingsWorkbench && isVisible(systemSettingsWorkbench)
          ? Math.round(systemSettingsWorkbench.getBoundingClientRect().height)
          : 0,
      marketKlineWorkbenchWidth:
        marketKlineWorkbench && isVisible(marketKlineWorkbench)
          ? Math.round(marketKlineWorkbench.getBoundingClientRect().width)
          : 0,
      marketKlineWorkbenchHeight:
        marketKlineWorkbench && isVisible(marketKlineWorkbench)
          ? Math.round(marketKlineWorkbench.getBoundingClientRect().height)
          : 0,
      klineCanvasHeight:
        klineCanvas && isVisible(klineCanvas)
          ? Math.round(klineCanvas.getBoundingClientRect().height)
          : 0,
      strategyEditorWorkbenchHeight:
        strategyEditorWorkbench && isVisible(strategyEditorWorkbench)
          ? Math.round(strategyEditorWorkbench.getBoundingClientRect().height)
          : 0,
      strategyEditorShellHeight:
        strategyEditorShell && isVisible(strategyEditorShell)
          ? Math.round(strategyEditorShell.getBoundingClientRect().height)
          : 0,
      backtestReportWorkbenchHeight:
        backtestReportWorkbench && isVisible(backtestReportWorkbench)
          ? Math.round(backtestReportWorkbench.getBoundingClientRect().height)
          : 0,
      backtestReportEmptyWorkbenchHeight:
        backtestReportEmptyWorkbench && isVisible(backtestReportEmptyWorkbench)
          ? Math.round(backtestReportEmptyWorkbench.getBoundingClientRect().height)
          : 0,
      dashboardDetailTabsTop:
        dashboardDetailTabs && isVisible(dashboardDetailTabs)
          ? Math.round(dashboardDetailTabs.getBoundingClientRect().top)
          : 0,
      dashboardDetailTabsHeight:
        dashboardDetailTabs && isVisible(dashboardDetailTabs)
          ? Math.round(dashboardDetailTabs.getBoundingClientRect().height)
          : 0,
      dashboardTaskListHeight:
        dashboardTaskList && isVisible(dashboardTaskList)
          ? Math.round(dashboardTaskList.getBoundingClientRect().height)
          : 0,
      tableActionWidth: Number.parseFloat(style.getPropertyValue('--lqc-table-col-action')),
      tableMessageWidth: Number.parseFloat(style.getPropertyValue('--lqc-table-col-message')),
    };
  });
}

test.describe('设备密度截图基线', () => {
  test.skip(!shouldCapture, 'Set LQC_CAPTURE_DEVICE_DENSITY=1 to refresh device density screenshots.');
  test.describe.configure({ mode: 'serial' });

  test('生成五档设备视口的主页面与深层工作区截图和度量', async ({ page }) => {
    test.setTimeout(720_000);
    await mkdir(outputDir, { recursive: true });

    const metrics: Array<Record<string, string | number>> = [];
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      for (const route of routes) {
        await page.goto(route.url, { waitUntil: 'domcontentloaded' });
        await expect(page.getByRole('heading', { name: route.title }).first()).toBeVisible({ timeout: 15_000 });
        await expect(page.locator('.status-strip')).toBeVisible();
        await closeTransientOverlays(page);
        await page.waitForTimeout(250);
        await closeTransientOverlays(page);
        await page.screenshot({
          path: path.join(outputDir, `${viewport.name}_${route.slug}.png`),
          fullPage: false,
          animations: 'disabled',
          caret: 'hide',
        });
        const pageMetrics = await readPageMetrics(page);
        expect(pageMetrics.bodyOverflowX, `${viewport.name} ${route.title} 页面级横向溢出`).toBeLessThanOrEqual(2);
        expect(pageMetrics.moduleOverflowX, `${viewport.name} ${route.title} 模块级横向溢出`).toBeLessThanOrEqual(2);
        expect(pageMetrics.maxDirectModuleGap, `${viewport.name} ${route.title} 模块直接间距`).toBeLessThanOrEqual(
          isMacViewport(viewport.name) ? 8 : 10,
        );
        expect(pageMetrics.directModuleOverlapCount, `${viewport.name} ${route.title} 页面直接模块互相堆叠遮挡`).toBe(0);
        expect(pageMetrics.nestedModuleOverlapCount, `${viewport.name} ${route.title} 工作台内部兄弟模块互相堆叠遮挡`).toBe(0);
        const expectedContentCoverage = getExpectedContentCoverage(route.url, viewport.name);
        if (expectedContentCoverage !== null) {
          expect(
            pageMetrics.contentCoverage,
            `${viewport.name} ${route.title} ${route.url} 主工作区覆盖率；底部空白 ${pageMetrics.bottomBlankHeight}px`,
          ).toBeGreaterThanOrEqual(expectedContentCoverage);
        }
        expect(
          pageMetrics.bottomBlankHeight,
          `${viewport.name} ${route.title} ${route.url} 底部空白不能形成大屏空洞`,
        ).toBeLessThanOrEqual(getMaxBottomBlankHeight(viewport.name));
        expect(pageMetrics.actionZoneOverflowCount, `${viewport.name} ${route.title} 操作区溢出`).toBe(0);
        expect(pageMetrics.blockedActionCount, `${viewport.name} ${route.title} 可操作元素被其它模块遮挡`).toBe(0);
        expect(pageMetrics.pageHeaderRows, `${viewport.name} ${route.title} 顶部主操作区行数`).toBeLessThanOrEqual(1);
        expect(pageMetrics.commandActionRows, `${viewport.name} ${route.title} 命令操作区行数`).toBeLessThanOrEqual(1);
        expect(pageMetrics.maxButtonHeight, `${viewport.name} ${route.title} 按钮高度必须保持紧凑`).toBeLessThanOrEqual(30);
        expect(pageMetrics.maxInputHeight, `${viewport.name} ${route.title} 输入框高度必须保持紧凑`).toBeLessThanOrEqual(30);
        if (pageMetrics.strategyWorkflowRailWidth > 0) {
          expect(pageMetrics.strategyWorkflowRailWidth, `${viewport.name} ${route.title} 策略工作流检查栏宽度`).toBeLessThanOrEqual(
            isMacViewport(viewport.name) ? 340 : 360,
          );
          expect(pageMetrics.strategyWorkflowRailHeight, `${viewport.name} ${route.title} 策略工作流检查栏高度`).toBeLessThanOrEqual(340);
        }
        if (pageMetrics.backtestTaskFlowRailWidth > 0) {
          expect(pageMetrics.backtestTaskFlowRailWidth, `${viewport.name} ${route.title} 回测工作流检查栏宽度`).toBeLessThanOrEqual(
            isMacViewport(viewport.name) ? 348 : 368,
          );
          expect(pageMetrics.backtestTaskFlowRailHeight, `${viewport.name} ${route.title} 回测工作流检查栏高度`).toBeLessThanOrEqual(340);
        }
        if (pageMetrics.tradingSignalSafetyRailWidth > 0) {
          expect(pageMetrics.tradingSignalSafetyRailWidth, `${viewport.name} ${route.title} 交易安全检查栏宽度`).toBeLessThanOrEqual(
            isMacViewport(viewport.name) ? 356 : 376,
          );
          expect(pageMetrics.tradingSignalSafetyRailHeight, `${viewport.name} ${route.title} 交易安全检查栏高度`).toBeLessThanOrEqual(340);
        }
        if (pageMetrics.tradingManualWorkbenchHeight > 0) {
          expect(pageMetrics.tradingManualWorkbenchHeight, `${viewport.name} ${route.title} 交易面板工作台高度上限`).toBeLessThanOrEqual(
            isMacViewport(viewport.name) ? 760 : is4kViewport(viewport.name) ? 1240 : 940,
          );
          expect(pageMetrics.tradingManualWorkbenchHeight, `${viewport.name} ${route.title} 交易面板工作台高度下限`).toBeGreaterThanOrEqual(
            isMacViewport(viewport.name) ? 470 : is4kViewport(viewport.name) ? 900 : 600,
          );
        }
        if (pageMetrics.tradingRecordWorkbenchHeight > 0) {
          expect(pageMetrics.tradingRecordWorkbenchHeight, `${viewport.name} ${route.title} 交易记录工作台高度上限`).toBeLessThanOrEqual(
            isMacViewport(viewport.name) ? 980 : is4kViewport(viewport.name) ? 1560 : 1220,
          );
          expect(pageMetrics.tradingRecordWorkbenchHeight, `${viewport.name} ${route.title} 交易记录工作台高度下限`).toBeGreaterThanOrEqual(
            isMacViewport(viewport.name) ? 430 : is4kViewport(viewport.name) ? 820 : 560,
          );
        }
        if (pageMetrics.dataSyncWorkbenchHeight > 0) {
          expect(pageMetrics.dataSyncWorkbenchHeight, `${viewport.name} ${route.title} 数据同步工作台高度上限`).toBeLessThanOrEqual(
            isMacViewport(viewport.name) ? 920 : is4kViewport(viewport.name) ? 1340 : 1200,
          );
          expect(pageMetrics.dataSyncWorkbenchHeight, `${viewport.name} ${route.title} 数据同步工作台高度下限`).toBeGreaterThanOrEqual(
            isMacViewport(viewport.name) ? 640 : is4kViewport(viewport.name) ? 1040 : 820,
          );
        }
        if (pageMetrics.dataSourceWorkbenchHeight > 0) {
          expect(pageMetrics.dataSourceWorkbenchHeight, `${viewport.name} ${route.title} 数据来源工作台高度上限`).toBeLessThanOrEqual(
            isMacViewport(viewport.name) ? 760 : is4kViewport(viewport.name) ? 1280 : 1160,
          );
          expect(pageMetrics.dataSourceWorkbenchHeight, `${viewport.name} ${route.title} 数据来源工作台高度下限`).toBeGreaterThanOrEqual(
            isMacViewport(viewport.name) ? 560 : is4kViewport(viewport.name) ? 920 : 720,
          );
        }
        if (pageMetrics.dataDictionaryWorkbenchHeight > 0) {
          expect(pageMetrics.dataDictionaryWorkbenchHeight, `${viewport.name} ${route.title} 数据字典工作台高度上限`).toBeLessThanOrEqual(
            isMacViewport(viewport.name) ? 780 : is4kViewport(viewport.name) ? 1280 : 1180,
          );
          expect(pageMetrics.dataDictionaryWorkbenchHeight, `${viewport.name} ${route.title} 数据字典工作台高度下限`).toBeGreaterThanOrEqual(
            isMacViewport(viewport.name) ? 560 : is4kViewport(viewport.name) ? 920 : 720,
          );
        }
        if (pageMetrics.systemSettingsWorkbenchWidth > 0) {
          expect(pageMetrics.systemSettingsWorkbenchHeight, `${viewport.name} ${route.title} 系统基础设置工作台高度`).toBeLessThanOrEqual(
            isMacViewport(viewport.name) ? 430 : is4kViewport(viewport.name) ? 1060 : 820,
          );
          expect(pageMetrics.systemSettingsWorkbenchHeight, `${viewport.name} ${route.title} 系统基础设置工作台高度下限`).toBeGreaterThanOrEqual(
            isMacViewport(viewport.name) ? 300 : is4kViewport(viewport.name) ? 860 : 560,
          );
        }
        if (pageMetrics.systemAuditWorkbenchHeight > 0) {
          expect(pageMetrics.systemAuditWorkbenchHeight, `${viewport.name} ${route.title} 系统审计工作台高度上限`).toBeLessThanOrEqual(
            isMacViewport(viewport.name) ? 780 : is4kViewport(viewport.name) ? 1340 : 1180,
          );
          expect(pageMetrics.systemAuditWorkbenchHeight, `${viewport.name} ${route.title} 系统审计工作台高度下限`).toBeGreaterThanOrEqual(
            isMacViewport(viewport.name) ? 620 : is4kViewport(viewport.name) ? 980 : 740,
          );
        }
        if (pageMetrics.maxSystemPathInputWidth > 0) {
          expect(pageMetrics.maxSystemPathInputWidth, `${viewport.name} ${route.title} 系统路径输入框宽度`).toBeLessThanOrEqual(
            isMacViewport(viewport.name) ? 460 : is4kViewport(viewport.name) ? 560 : 520,
          );
        }
        if (pageMetrics.marketKlineWorkbenchWidth > 0) {
          expect(pageMetrics.marketKlineWorkbenchHeight, `${viewport.name} ${route.title} K线工作台高度`).toBeLessThanOrEqual(
            isMacViewport(viewport.name) ? 560 : 600,
          );
          expect(pageMetrics.klineCanvasHeight, `${viewport.name} ${route.title} K线画布高度`).toBeLessThanOrEqual(380);
        }
        if (pageMetrics.strategyEditorShellHeight > 0) {
          expect(pageMetrics.strategyEditorShellHeight, `${viewport.name} ${route.title} 策略编辑器高度`).toBeLessThanOrEqual(
            isMacViewport(viewport.name) ? 720 : is4kViewport(viewport.name) ? 1120 : 900,
          );
        }
        if (pageMetrics.strategyEditorWorkbenchHeight > 0) {
          expect(pageMetrics.strategyEditorWorkbenchHeight, `${viewport.name} ${route.title} 策略代码工作台高度`).toBeLessThanOrEqual(
            isMacViewport(viewport.name) ? 780 : is4kViewport(viewport.name) ? 1500 : 1180,
          );
          if (route.slug === 'strategy-dev-editor') {
            expect(pageMetrics.strategyEditorWorkbenchHeight, `${viewport.name} ${route.title} 策略代码工作台大屏利用率`).toBeGreaterThanOrEqual(
              isMacViewport(viewport.name) ? 620 : is4kViewport(viewport.name) ? 1380 : 1000,
            );
          }
        }
        if (pageMetrics.backtestReportWorkbenchHeight > 0) {
          expect(pageMetrics.backtestReportWorkbenchHeight, `${viewport.name} ${route.title} 回测报告工作台高度`).toBeLessThanOrEqual(760);
        }
        if (pageMetrics.backtestReportEmptyWorkbenchHeight > 0) {
          expect(pageMetrics.backtestReportEmptyWorkbenchHeight, `${viewport.name} ${route.title} 回测空报告工作台高度上限`).toBeLessThanOrEqual(
            isMacViewport(viewport.name) ? 670 : is4kViewport(viewport.name) ? 1320 : 1120,
          );
          expect(pageMetrics.backtestReportEmptyWorkbenchHeight, `${viewport.name} ${route.title} 回测空报告工作台高度下限`).toBeGreaterThanOrEqual(
            isShortMacViewport(viewport.name) ? 540 : isMacViewport(viewport.name) ? 600 : is4kViewport(viewport.name) ? 1080 : 980,
          );
        }
        if (pageMetrics.dashboardDetailTabsTop > 0) {
          expect(pageMetrics.dashboardDetailTabsTop, `${viewport.name} ${route.title} 首页明细区顶部`).toBeLessThanOrEqual(
            isMacViewport(viewport.name) ? 800 : 820,
          );
        }
        if (pageMetrics.dashboardTaskListHeight > 0) {
          expect(pageMetrics.dashboardTaskListHeight, `${viewport.name} ${route.title} 首页任务列表高度`).toBeLessThanOrEqual(430);
        }
        if (pageMetrics.maxEmptyGuideHeight > 0) {
          expect(pageMetrics.maxEmptyGuideHeight, `${viewport.name} ${route.title} 空状态高度`).toBeLessThanOrEqual(44);
        }
        if (pageMetrics.maxEmptyRowHeight > 0) {
          expect(pageMetrics.maxEmptyRowHeight, `${viewport.name} ${route.title} 空表格占位行高度`).toBeLessThanOrEqual(48);
        }
        if (pageMetrics.minInputHeight > 0) {
          expect(pageMetrics.minInputHeight, `${viewport.name} ${route.title} 输入框不能被压扁到文字贴线`).toBeGreaterThanOrEqual(26);
        }
        expect(pageMetrics.badControlTextAlignmentCount, `${viewport.name} ${route.title} 输入框/选择器文字不能贴边压线`).toBe(0);
        expect(pageMetrics.maxControlTextCenterDrift, `${viewport.name} ${route.title} 输入控件文字必须垂直居中`).toBeLessThanOrEqual(2.5);
        expect(pageMetrics.maxControlLineOverflow, `${viewport.name} ${route.title} 输入控件文字行高不能超过可用高度`).toBeLessThanOrEqual(1);
        expect(pageMetrics.maxControlTextOutside, `${viewport.name} ${route.title} 输入控件文字不能越出外框`).toBe(0);
        metrics.push({
          viewport: viewport.name,
          page: route.title,
          url: route.url,
          ...pageMetrics,
        });
      }
    }

    const metricNumber = (key: string) => metrics.map((item) => Number(item[key] || 0));
    const metricPositive = (key: string) => metricNumber(key).filter((value) => value > 0);
    const tradingRecordHeights = metricPositive('tradingRecordWorkbenchHeight');
    const metricSummary = {
      minCoverage: Math.min(...metricNumber('contentCoverage')).toFixed(3),
      maxBottomBlank: Math.max(...metricNumber('bottomBlankHeight')),
      maxEmptyGuideHeight: Math.max(...metricNumber('maxEmptyGuideHeight')),
      maxEmptyRowHeight: Math.max(...metricNumber('maxEmptyRowHeight')),
      maxButtonHeight: Math.max(...metricNumber('maxButtonHeight')),
      maxInputHeight: Math.max(...metricNumber('maxInputHeight')),
      maxControlTextCenterDrift: Math.max(...metricNumber('maxControlTextCenterDrift')),
      maxControlTextOutside: Math.max(...metricNumber('maxControlTextOutside')),
      maxBlockedActionCount: Math.max(...metricNumber('blockedActionCount')),
      maxModuleOverflowX: Math.max(...metricNumber('moduleOverflowX')),
      maxActionZoneOverflowCount: Math.max(...metricNumber('actionZoneOverflowCount')),
      minTradingRecordWorkbenchHeight: tradingRecordHeights.length ? Math.min(...tradingRecordHeights) : 0,
      maxTradingRecordWorkbenchHeight: tradingRecordHeights.length ? Math.max(...tradingRecordHeights) : 0,
    };

    await writeFile(path.join(outputDir, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`, 'utf-8');
    await writeFile(
      path.join(outputDir, 'README.md'),
      [
        '# 设备密度截图基线',
        '',
        '生成日期：2026-05-26（延续 2026-05-23 设备基线目录）',
        '',
        '覆盖视口：',
        '',
        '- `1512 x 982`：MacBook Pro 14 寸默认缩放有效工作区',
        '- `1512 x 820`：MacBook Pro 14 寸浏览器书签栏/工具栏占高后的安全工作区',
        '- `1512 x 702`：MacBook Pro 14 寸真实 Chrome 工具栏/书签栏占高后的强约束工作区',
        '- `2560 x 1440`：27 寸 Windows QHD',
        '- `3072 x 1728`：27 寸 Windows 4K 125% 近似有效工作区',
        '',
        `覆盖页面：六大主页面，以及数据中心数据来源/账户/行情/基础/同步/质量/字典、策略代码编辑/运行/信号/版本、回测任务/绩效/明细/日志、交易面板/持仓/委托/成交/日志、系统默认/环境/基础/交易/策略/日志/监控/备份/操作等 34 个入口和深层工作区，共 \`${metrics.length}\` 个页面/视口样本。`,
        '',
        '最新指标：',
        '',
        `- 最小主工作区覆盖率：\`${metricSummary.minCoverage}\``,
        `- 最大底部空白：\`${metricSummary.maxBottomBlank}px\``,
        `- 最大空状态引导高度：\`${metricSummary.maxEmptyGuideHeight}px\``,
        `- 最大空表格行高：\`${metricSummary.maxEmptyRowHeight}px\``,
        `- 最大按钮高度：\`${metricSummary.maxButtonHeight}px\``,
        `- 最大输入框高度：\`${metricSummary.maxInputHeight}px\``,
        `- 最大输入控件文字中心偏移：\`${metricSummary.maxControlTextCenterDrift}px\``,
        `- 最大输入控件文字越界：\`${metricSummary.maxControlTextOutside}px\``,
        `- 交易记录工作台高度范围：\`${metricSummary.minTradingRecordWorkbenchHeight}px - ${metricSummary.maxTradingRecordWorkbenchHeight}px\``,
        `- 横向溢出、模块溢出、操作区溢出、可操作元素遮挡：\`${Math.max(
          metricSummary.maxModuleOverflowX,
          metricSummary.maxActionZoneOverflowCount,
          metricSummary.maxBlockedActionCount,
        )}\``,
        '',
        '生成命令：',
        '',
        '```powershell',
        "$env:LQC_CAPTURE_DEVICE_DENSITY='1'; npx playwright test tests/e2e/device-density-capture.spec.ts --project=chromium",
        '```',
        '',
        '说明：该用例默认跳过，只有显式设置环境变量时才刷新截图，避免日常回归重写视觉证据。',
        '',
      ].join('\n'),
      'utf-8',
    );
  });
});
