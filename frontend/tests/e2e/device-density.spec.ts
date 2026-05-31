import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

test.describe.configure({ mode: 'parallel' });

const routes = [
  { url: '/dashboard', title: '总览看板' },
  { url: '/data-center', title: '数据中心' },
  { url: '/data-center?tab=数据来源', title: '数据中心' },
  { url: '/data-center?tab=账户数据', title: '数据中心' },
  { url: '/data-center?tab=行情数据', title: '数据中心' },
  { url: '/data-center?tab=基础资料', title: '数据中心' },
  { url: '/data-center?tab=数据同步', title: '数据中心' },
  { url: '/data-center?tab=数据质量', title: '数据中心' },
  { url: '/data-center?tab=数据字典', title: '数据中心' },
  { url: '/strategy-dev', title: '策略开发' },
  { url: '/strategy-dev?tab=代码编辑', title: '策略开发' },
  { url: '/strategy-dev?tab=运行调试', title: '策略开发' },
  { url: '/strategy-dev?tab=策略信号', title: '策略开发' },
  { url: '/strategy-dev?tab=版本记录', title: '策略开发' },
  { url: '/backtest', title: '回测研究' },
  { url: '/backtest?tab=回测任务', title: '回测研究' },
  { url: '/backtest?tab=绩效结果', title: '回测研究' },
  { url: '/backtest?tab=交易明细', title: '回测研究' },
  { url: '/backtest?tab=回测日志', title: '回测研究' },
  { url: '/trading', title: '交易执行' },
  { url: '/trading?tab=交易面板', title: '交易执行' },
  { url: '/trading?tab=当前持仓', title: '交易执行' },
  { url: '/trading?tab=委托记录', title: '交易执行' },
  { url: '/trading?tab=成交记录', title: '交易执行' },
  { url: '/trading?tab=执行日志', title: '交易执行' },
  { url: '/system', title: '系统管理' },
  { url: '/system?tab=基础设置', title: '系统管理' },
  { url: '/system?tab=环境检测', title: '系统管理' },
  { url: '/system?tab=交易设置', title: '系统管理' },
  { url: '/system?tab=策略设置', title: '系统管理' },
  { url: '/system?tab=日志中心', title: '系统管理' },
  { url: '/system?tab=运行监控', title: '系统管理' },
  { url: '/system?tab=备份恢复', title: '系统管理' },
  { url: '/system?tab=操作记录', title: '系统管理' },
];

const viewports = [
  {
    name: 'macbook-pro-14-effective',
    width: 1512,
    height: 982,
    expectedSidebarMax: 73,
    expectedStatusMax: 39,
    expectedPaddingMax: 8,
  },
  {
    name: 'macbook-pro-14-browser-safe',
    width: 1512,
    height: 820,
    expectedSidebarMax: 73,
    expectedStatusMax: 39,
    expectedPaddingMax: 8,
  },
  {
    name: 'macbook-pro-14-chrome-safe',
    width: 1512,
    height: 702,
    expectedSidebarMax: 73,
    expectedStatusMax: 33,
    expectedPaddingMax: 8,
  },
  {
    name: 'windows-27-qhd',
    width: 2560,
    height: 1440,
    expectedSidebarMax: 77,
    expectedStatusMax: 41,
    expectedPaddingMax: 10,
  },
  {
    name: 'windows-27-4k-125-effective',
    width: 3072,
    height: 1728,
    expectedSidebarMax: 77,
    expectedStatusMax: 41,
    expectedPaddingMax: 10,
  },
];

const remoteSafeViewports = [
  { name: 'remote-compact-1280x720', width: 1280, height: 720 },
  { name: 'remote-compact-1366x768', width: 1366, height: 768 },
];

async function gotoStable(page: Page, url: string, options: Parameters<Page['goto']>[1] = {}) {
  const nextOptions = { waitUntil: 'domcontentloaded' as const, ...options };
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(url, nextOptions);
      return;
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('ERR_NETWORK_CHANGED') && !message.includes('ERR_ABORTED')) {
        throw error;
      }
      await page.waitForTimeout(300 + attempt * 300);
    }
  }

  throw lastError;
}

async function resetAppScroll(page: Page) {
  await page.evaluate(() => {
    const appContent = document.querySelector<HTMLElement>('.app-content');
    if (appContent) {
      appContent.scrollTop = 0;
    }
    window.scrollTo(0, 0);
  });
}

async function closeTransientOverlays(page: Page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const visibleDialogCount = await page.locator('.ant-modal-root .ant-modal:visible, [role="dialog"]:visible').count();
    const notificationCloseButton = page.locator(
      [
        '.ant-notification-notice:visible .ant-notification-notice-close',
        '.ant-message-notice:visible .ant-message-notice-close',
      ].join(', '),
    ).first();

    if (await notificationCloseButton.isVisible().catch(() => false)) {
      await notificationCloseButton.click({ force: true }).catch(() => undefined);
      await page.waitForTimeout(80);
    }

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

async function openRouteForAudit(page: Page, route: { url: string; title: string }) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await gotoStable(page, route.url);
    await resetAppScroll(page);
    try {
      await expect(
        page.getByRole('heading', { name: route.title }).first(),
        `${route.url} 应显示 ${route.title} 页面标题`,
      ).toBeVisible({ timeout: 15_000 });
      await closeTransientOverlays(page);
      return;
    } catch (error) {
      lastError = error;
      if (attempt === 0) {
        await page.waitForTimeout(300);
      }
    }
  }
  throw lastError;
}

async function waitForUiIdle(page: Page, timeout = 2_000) {
  await page.waitForFunction(
    () => !Array.from(document.querySelectorAll<HTMLElement>('.ant-spin-spinning')).some((element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return (
        style.display !== 'none'
        && style.visibility !== 'hidden'
        && rect.width > 4
        && rect.height > 4
        && rect.bottom > 0
        && rect.right > 0
        && rect.top < window.innerHeight
        && rect.left < window.innerWidth
      );
    }),
    { timeout },
  ).catch(() => undefined);
  await page.waitForTimeout(80);
}

async function prepareForDensityMeasurement(page: Page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await waitForUiIdle(page, attempt === 0 ? 250 : 120);
    await closeTransientOverlays(page);
    await page.waitForTimeout(100);

    const visibleDialogCount = await page.locator('.ant-modal-root .ant-modal:visible, [role="dialog"]:visible').count();
    if (visibleDialogCount === 0) {
      return;
    }
  }

  await closeTransientOverlays(page);
}

test('AppShell 底栏样式不能回退为 fixed 覆盖或侧栏偏移', async () => {
  const css = readFileSync('src/theme/global.css', 'utf-8');
  const bottomStatusBlocks = Array.from(css.matchAll(/\.app-shell__bottom-status\s*\{[^}]*\}/g)).map((match) => match[0]);
  const appContentBlocks = Array.from(css.matchAll(/\.app-content\s*\{[^}]*\}/g)).map((match) => match[0]);
  const modulePageBlocks = Array.from(
    css.matchAll(/(?:\.workspace-canvas\s*>\s*\.module-page|\.app-shell\s+\.workspace-canvas\s*>\s*\.module-page\.module-page)[^{]*\{[^}]*\}/g),
  ).map((match) => match[0]);
  const ui34Index = css.indexOf('UI-34:');
  const finalGuardIndex = css.indexOf('UI-38: authoritative AppShell flow guard');
  const finalGuardMarkers = css.match(/UI-38: authoritative AppShell flow guard/g) ?? [];
  const retiredFlowMarkers = css.match(/UI-QA-20260524: keep chrome in the shell flow/g) ?? [];

  expect(finalGuardIndex, '必须保留最终 AppShell 流式布局护栏').toBeGreaterThanOrEqual(0);
  expect(finalGuardMarkers, '最终 AppShell 流式布局护栏只能保留一份，避免重复规则互相覆盖').toHaveLength(1);
  expect(retiredFlowMarkers, '早期 AppShell 流式规则已退役，不能再和最终护栏重复定义').toHaveLength(0);
  expect(ui34Index, '分页/横向滚动条合同仍应保留，但不能覆盖最终 AppShell 护栏').toBeGreaterThanOrEqual(0);
  expect(finalGuardIndex, '最终 AppShell 护栏必须位于 UI-34 分页合同之后').toBeGreaterThan(ui34Index);
  const finalGuardCss = css.slice(finalGuardIndex);
  expect(finalGuardCss, '最终底栏规则必须声明 relative 占位').toMatch(/\.app-shell__bottom-status\s*\{[\s\S]*position:\s*relative\s*!important/);
  expect(finalGuardCss, '最终底栏规则必须清除旧侧栏 left 偏移').toMatch(/\.app-shell__bottom-status\s*\{[\s\S]*left:\s*auto\s*!important/);
  expect(finalGuardCss, '最终模块页规则必须保持流式占位，不能被当作内部滚动容器裁剪').toMatch(
    /\.workspace-canvas\s*>\s*\.module-page,\s*\.app-shell\s+\.workspace-canvas\s*>\s*\.module-page\.module-page\s*\{[\s\S]*flex:\s*0 0 auto[\s\S]*overflow:\s*visible\s*!important/,
  );
  expect(finalGuardCss, 'Ant Spin 加载遮罩必须走主题变量，不能在深浅主题切换时固定成旧暗色或回退白色模块').toMatch(
    /\.ant-spin-container::after\s*\{[\s\S]*background:\s*rgba\(var\(--lqc-surface-muted-rgb\),\s*0\.76\)\s*!important/,
  );
  expect(finalGuardCss, 'Ant Spin 加载遮罩不能再写死旧版暗色 rgba，避免浅色主题出现脏色块').not.toMatch(
    /\.ant-spin-container::after\s*\{[\s\S]*background:\s*rgba\(8,\s*12,\s*18,\s*0\.76\)\s*!important/,
  );

  for (const block of bottomStatusBlocks) {
    expect(block, '底部状态栏不能再 fixed 覆盖正文').not.toMatch(/position:\s*fixed/i);
    expect(block, '底部状态栏不能再按侧栏宽度左偏').not.toMatch(/left:\s*var\(--lqc-sidebar-width\)/i);
  }
  for (const block of appContentBlocks) {
    expect(block, '内容区不能再通过额外底部 padding 假装避让固定底栏').not.toMatch(/(^|[;\s{])padding-bottom:\s*(?:40px|48px|calc\(var\(--lqc-shell-bottom-height)/i);
  }
  for (const block of modulePageBlocks) {
    expect(block, '模块页不能再通过底栏高度 padding 假装避让固定底栏').not.toMatch(/padding(?:-[^:]+)?:\s*[^;]*calc\(var\(--lqc-shell-bottom-height/i);
  }
});

test('总览右侧检查列不能回退为面板压缩裁剪', async () => {
  const css = readFileSync('src/pages/Dashboard/Dashboard.css', 'utf-8');
  expect(css, '总览右侧检查列必须由列本身滚动，避免成交记录和主链路入口被相邻模块压住').toMatch(
    /\.dashboard-page\s+\.dashboard-workspace-grid\s*>\s*\.dashboard-workspace-column:nth-child\(3\)\s*\{[\s\S]*overflow:\s*auto\s*;/,
  );
  expect(css, '右侧检查列内的 WorkspacePanel 不能参与 flex shrink，否则真实数据较多时会裁剪内部表格和按钮').toMatch(
    /\.dashboard-page\s+\.dashboard-workspace-grid\s*>\s*\.dashboard-workspace-column:nth-child\(3\)\s*>\s*\.workspace-panel\s*\{[\s\S]*flex:\s*0 0 auto\s*;/,
  );
  expect(css, '右侧检查列内的 InspectorPanel 也不能参与 flex shrink，否则任务队列 body 会被压到几像素后遮挡任务内容').toMatch(
    /\.dashboard-page\s+\.dashboard-workspace-grid\s*>\s*\.dashboard-workspace-column:nth-child\(3\)\s*>\s*\.inspector-panel\s*\{[\s\S]*flex:\s*0 0 auto\s*;/,
  );
});

test('总览右侧检查列运行时不裁剪内部功能区', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await gotoStable(page, '/dashboard');
  await resetAppScroll(page);
  await expect(page.getByRole('heading', { name: '总览看板' }).first()).toBeVisible({ timeout: 15_000 });
  await waitForUiIdle(page, 8_000);

  const metrics = await page.evaluate(() => {
    const column = document.querySelector<HTMLElement>('.dashboard-workspace-grid > .dashboard-workspace-column:nth-child(3)');
    const panels = Array.from(
      document.querySelectorAll<HTMLElement>('.dashboard-workspace-grid > .dashboard-workspace-column:nth-child(3) > .workspace-panel'),
    );
    const inspector = document.querySelector<HTMLElement>('.dashboard-workspace-grid > .dashboard-workspace-column:nth-child(3) > .inspector-panel');
    const inspectorBody = inspector?.querySelector<HTMLElement>('.inspector-panel__body') ?? null;
    const columnStyle = column ? window.getComputedStyle(column) : null;
    const panelShrinkValues = panels.map((panel) => Number(window.getComputedStyle(panel).flexShrink));
    const inspectorShrinkValue = inspector ? Number(window.getComputedStyle(inspector).flexShrink) : -1;
    const clippedPanelCount = panels.filter((panel) => panel.scrollHeight - panel.clientHeight > 2 && window.getComputedStyle(panel).overflowY === 'visible').length;

    return {
      columnExists: Boolean(column),
      panelCount: panels.length,
      inspectorExists: Boolean(inspector),
      columnOverflowY: columnStyle?.overflowY ?? '',
      panelShrinkValues,
      inspectorShrinkValue,
      inspectorBodyClientHeight: inspectorBody?.clientHeight ?? 0,
      inspectorBodyScrollHeight: inspectorBody?.scrollHeight ?? 0,
      clippedPanelCount,
    };
  });

  expect(metrics.columnExists, '总览右侧检查列必须存在').toBeTruthy();
  expect(metrics.panelCount, '右侧检查列需要承载多个工作台面板').toBeGreaterThanOrEqual(2);
  expect(metrics.inspectorExists, '右侧检查列必须包含任务队列检查器').toBeTruthy();
  expect(metrics.columnOverflowY, '右侧检查列必须由列本身滚动承载溢出内容').toMatch(/auto|scroll/);
  expect(
    metrics.panelShrinkValues.every((value) => value === 0),
    `右侧检查列面板不能被 flex 压缩，当前 shrink=${metrics.panelShrinkValues.join(',')}`,
  ).toBeTruthy();
  expect(metrics.inspectorShrinkValue, `任务队列检查器不能被 flex 压缩，当前 shrink=${metrics.inspectorShrinkValue}`).toBe(0);
  expect(
    metrics.inspectorBodyClientHeight,
    `任务队列 body 不能被压扁到遮挡任务内容，client=${metrics.inspectorBodyClientHeight}, scroll=${metrics.inspectorBodyScrollHeight}`,
  ).toBeGreaterThanOrEqual(56);
  expect(metrics.clippedPanelCount, '右侧检查列面板自身不能在 overflow: visible 下裁剪内部功能区').toBe(0);
});

test('数据中心已有数据表格不能用加载遮罩盖住行操作', async ({ page }) => {
  test.setTimeout(90_000);
  const cases = [
    { url: '/data-center?tab=行情数据', selector: '.data-table--daily-kline', title: '日 K 行情表' },
    { url: '/data-center?tab=数据字典', selector: '.data-table--dictionary', title: '数据字典表' },
  ];

  await page.setViewportSize({ width: 2560, height: 1440 });
  for (const item of cases) {
    await gotoStable(page, item.url);
    await resetAppScroll(page);
    await expect(page.getByRole('heading', { name: '数据中心' }).first()).toBeVisible({ timeout: 15_000 });
    await waitForUiIdle(page, 8_000);
    await page.waitForTimeout(8_000);
    const metrics = await page.evaluate((selector) => {
      const table = document.querySelector<HTMLElement>(selector);
      table?.scrollIntoView({ block: 'center', inline: 'nearest' });
      const visibleSpinners = Array.from(table?.querySelectorAll<HTMLElement>('.ant-spin-spinning') ?? []).filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return (
          style.display !== 'none'
          && style.visibility !== 'hidden'
          && rect.width > 4
          && rect.height > 4
          && rect.bottom > 0
          && rect.right > 0
          && rect.top < window.innerHeight
          && rect.left < window.innerWidth
        );
      });
      return {
        tableExists: Boolean(table),
        rowCount: table?.querySelectorAll('.ant-table-row').length ?? 0,
        visibleSpinnerCount: visibleSpinners.length,
      };
    }, item.selector);

    expect(metrics.tableExists, `${item.title} 必须存在`).toBeTruthy();
    if (metrics.rowCount > 0) {
      expect(metrics.visibleSpinnerCount, `${item.title} 已经有行数据时不能继续用 Spin 遮罩覆盖行操作`).toBe(0);
    }
  }
});

test('DataTable 已有数据刷新不能使用表格 Spin 遮罩盖住行操作', async () => {
  const source = readFileSync('src/components/DataTable/DataTable.tsx', 'utf-8');
  expect(source, 'DataTable 必须区分首屏空数据加载和已有数据刷新').toContain('const tableLoading = rows.length === 0 ? loading : false;');
  expect(source, 'AntD Table 只能使用受控后的 tableLoading，已有行数据刷新时不得把 Spin 盖到操作按钮上').toContain('loading={tableLoading}');
  expect(source, '首屏加载时不能同时渲染空状态操作按钮，否则按钮会出现在 Spin 遮罩下方').toContain('const emptyGuideAction = tableLoading || hasActiveQuickControls ? undefined : emptyAction;');
  expect(source, '空状态操作必须使用 emptyGuideAction 统一避让加载态和筛选态').toContain('action={emptyGuideAction}');
});

test('更新时间标签必须有内部省略层，不能撑破窄面板标题栏', async () => {
  const component = readFileSync('src/components/DataFreshnessTag/DataFreshnessTag.tsx', 'utf-8');
  const css = readFileSync('src/components/DataFreshnessTag/DataFreshnessTag.css', 'utf-8');
  expect(component, 'DataFreshnessTag 文本需要独立包裹，窄面板里才能可靠省略').toContain('data-freshness-tag__text');
  expect(css, 'DataFreshnessTag 外层必须允许在工具栏/面板标题栏中收缩').toMatch(/\.data-freshness-tag\s*\{[\s\S]*min-width:\s*0\s*;[\s\S]*overflow:\s*hidden\s*;/);
  expect(css, 'AntD Tag 会额外包一层 span，这层也必须可收缩，否则文字层仍会撑破标题栏').toMatch(/\.data-freshness-tag\s*>\s*span:not\(\.anticon\)\s*\{[\s\S]*min-width:\s*0\s*;[\s\S]*overflow:\s*hidden\s*;/);
  expect(css, 'DataFreshnessTag 文本层必须省略，不能把卡片 header 撑出边界').toMatch(/\.data-freshness-tag__text\s*\{[\s\S]*text-overflow:\s*ellipsis\s*;/);
});

const isMacViewport = (viewportName: string) => viewportName.startsWith('macbook-pro-14');
const isShortMacViewport = (viewportName: string) => (
  viewportName === 'macbook-pro-14-browser-safe' || viewportName === 'macbook-pro-14-chrome-safe'
);
const is4kViewport = (viewportName: string) => viewportName === 'windows-27-4k-125-effective';

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

async function readDensityMetrics(page: Page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const style = window.getComputedStyle(root);
    const shell = document.querySelector<HTMLElement>('.app-shell');
    const sider = document.querySelector<HTMLElement>('.app-shell__sider');
    const status = document.querySelector<HTMLElement>('.status-strip');
    const appContent = document.querySelector<HTMLElement>('.app-content');
    const bottomStatus = document.querySelector<HTMLElement>(
      '.app-shell__bottom-status, .bottom-status-bar, .app-bottom-status, .terminal-statusbar',
    );
    const modulePage = document.querySelector<HTMLElement>('.module-page');
    const commandItems = Array.from(document.querySelectorAll<HTMLElement>('.command-panel__item'));
    const metricCards = Array.from(document.querySelectorAll<HTMLElement>('.metric-strip .metric-card'));
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
    const maxCommandItemWidth = commandItems.length
      ? Math.max(...commandItems.map((item) => item.getBoundingClientRect().width))
      : 0;
    const maxMetricCardWidth = metricCards.length
      ? Math.max(...metricCards.map((item) => item.getBoundingClientRect().width))
      : 0;
    const maxButtonHeight = buttons.length ? Math.max(...buttons.map((item) => item.getBoundingClientRect().height)) : 0;
    const maxInputHeight = inputs.length ? Math.max(...inputs.map((item) => item.getBoundingClientRect().height)) : 0;
    const minInputHeight = inputs.length ? Math.min(...inputs.map((item) => item.getBoundingClientRect().height)) : 0;
    const maxSystemPathInputWidth = systemPathInputs.length
      ? Math.max(...systemPathInputs.map((item) => item.getBoundingClientRect().width))
      : 0;
    const maxEmptyGuideHeight = emptyGuides.length ? Math.max(...emptyGuides.map((item) => item.getBoundingClientRect().height)) : 0;
    const maxEmptyRowHeight = emptyRows.length ? Math.max(...emptyRows.map((item) => item.getBoundingClientRect().height)) : 0;
    const maxDirectModuleGap = directModuleGaps.length ? Math.max(...directModuleGaps) : 0;
    const actionZoneOverflowCount = actionZones.filter((zone) => {
      const rect = zone.getBoundingClientRect();
      return zone.scrollWidth > zone.clientWidth + 2 || zone.scrollHeight > Math.max(rect.height + 2, 64);
    }).length;
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
    const strategyWorkflowRailRect = strategyWorkflowRail && isVisible(strategyWorkflowRail)
      ? strategyWorkflowRail.getBoundingClientRect()
      : null;
    const backtestTaskFlowRailRect = backtestTaskFlowRail && isVisible(backtestTaskFlowRail)
      ? backtestTaskFlowRail.getBoundingClientRect()
      : null;
    const tradingSignalSafetyRailRect = tradingSignalSafetyRail && isVisible(tradingSignalSafetyRail)
      ? tradingSignalSafetyRail.getBoundingClientRect()
      : null;
    const tradingManualWorkbenchRect = tradingManualWorkbench && isVisible(tradingManualWorkbench)
      ? tradingManualWorkbench.getBoundingClientRect()
      : null;
    const tradingRecordWorkbenchRect = tradingRecordWorkbench && isVisible(tradingRecordWorkbench)
      ? tradingRecordWorkbench.getBoundingClientRect()
      : null;
    const dataSyncWorkbenchRect = dataSyncWorkbench && isVisible(dataSyncWorkbench)
      ? dataSyncWorkbench.getBoundingClientRect()
      : null;
    const dataSourceWorkbenchRect = dataSourceWorkbench && isVisible(dataSourceWorkbench)
      ? dataSourceWorkbench.getBoundingClientRect()
      : null;
    const dataDictionaryWorkbenchRect = dataDictionaryWorkbench && isVisible(dataDictionaryWorkbench)
      ? dataDictionaryWorkbench.getBoundingClientRect()
      : null;
    const systemAuditWorkbenchRect = systemAuditWorkbench && isVisible(systemAuditWorkbench)
      ? systemAuditWorkbench.getBoundingClientRect()
      : null;
    const systemSettingsWorkbenchRect = systemSettingsWorkbench && isVisible(systemSettingsWorkbench)
      ? systemSettingsWorkbench.getBoundingClientRect()
      : null;
    const marketKlineWorkbenchRect = marketKlineWorkbench && isVisible(marketKlineWorkbench)
      ? marketKlineWorkbench.getBoundingClientRect()
      : null;
    const klineCanvasRect = klineCanvas && isVisible(klineCanvas)
      ? klineCanvas.getBoundingClientRect()
      : null;
    const strategyEditorWorkbenchRect = strategyEditorWorkbench && isVisible(strategyEditorWorkbench)
      ? strategyEditorWorkbench.getBoundingClientRect()
      : null;
    const strategyEditorShellRect = strategyEditorShell && isVisible(strategyEditorShell)
      ? strategyEditorShell.getBoundingClientRect()
      : null;
    const backtestReportWorkbenchRect = backtestReportWorkbench && isVisible(backtestReportWorkbench)
      ? backtestReportWorkbench.getBoundingClientRect()
      : null;
    const backtestReportEmptyWorkbenchRect = backtestReportEmptyWorkbench && isVisible(backtestReportEmptyWorkbench)
      ? backtestReportEmptyWorkbench.getBoundingClientRect()
      : null;
    const dashboardDetailTabsRect = dashboardDetailTabs && isVisible(dashboardDetailTabs)
      ? dashboardDetailTabs.getBoundingClientRect()
      : null;
    const dashboardTaskListRect = dashboardTaskList && isVisible(dashboardTaskList)
      ? dashboardTaskList.getBoundingClientRect()
      : null;

    return {
      density: root.dataset.density ?? '',
      sidebarWidth: Math.round(sider?.getBoundingClientRect().width ?? 0),
      statusHeight: Math.round(status?.getBoundingClientRect().height ?? 0),
      contentPaddingX: Number.parseFloat(style.getPropertyValue('--lqc-content-padding-x')),
      tableActionWidth: Number.parseFloat(style.getPropertyValue('--lqc-table-col-action')),
      tableMessageWidth: Number.parseFloat(style.getPropertyValue('--lqc-table-col-message')),
      bodyScrollWidth: root.scrollWidth,
      bodyScrollOverflowY: Math.max(0, root.scrollHeight - root.clientHeight),
      viewportWidth: window.innerWidth,
      moduleScrollWidth: modulePage?.scrollWidth ?? 0,
      moduleClientWidth: modulePage?.clientWidth ?? 0,
      moduleOverflowY: modulePage ? window.getComputedStyle(modulePage).overflowY : '',
      workspaceCanvasOverflowY: document.querySelector<HTMLElement>('.workspace-canvas')
        ? window.getComputedStyle(document.querySelector<HTMLElement>('.workspace-canvas')!).overflowY
        : '',
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
      shellTransform: shell ? window.getComputedStyle(shell).transform : 'none',
      bodyZoom: document.body.style.zoom || root.style.zoom || '',
      maxCommandItemWidth: Math.round(maxCommandItemWidth),
      maxMetricCardWidth: Math.round(maxMetricCardWidth),
      maxButtonHeight: Math.round(maxButtonHeight),
      maxInputHeight: Math.round(maxInputHeight),
      minInputHeight: Math.round(minInputHeight),
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
      maxSystemPathInputWidth: Math.round(maxSystemPathInputWidth),
      maxEmptyGuideHeight: Math.round(maxEmptyGuideHeight),
      maxEmptyRowHeight: Math.round(maxEmptyRowHeight),
      maxDirectModuleGap,
      directModuleOverlapCount,
      nestedModuleOverlapCount,
      contentCoverage,
      bottomBlankHeight,
      actionZoneOverflowCount,
      blockedActionCount,
      pageHeaderRows,
      commandActionRows,
      strategyWorkflowRailWidth: Math.round(strategyWorkflowRailRect?.width ?? 0),
      strategyWorkflowRailHeight: Math.round(strategyWorkflowRailRect?.height ?? 0),
      backtestTaskFlowRailWidth: Math.round(backtestTaskFlowRailRect?.width ?? 0),
      backtestTaskFlowRailHeight: Math.round(backtestTaskFlowRailRect?.height ?? 0),
      tradingSignalSafetyRailWidth: Math.round(tradingSignalSafetyRailRect?.width ?? 0),
      tradingSignalSafetyRailHeight: Math.round(tradingSignalSafetyRailRect?.height ?? 0),
      tradingManualWorkbenchHeight: Math.round(tradingManualWorkbenchRect?.height ?? 0),
      tradingRecordWorkbenchHeight: Math.round(tradingRecordWorkbenchRect?.height ?? 0),
      dataSyncWorkbenchHeight: Math.round(dataSyncWorkbenchRect?.height ?? 0),
      dataSourceWorkbenchHeight: Math.round(dataSourceWorkbenchRect?.height ?? 0),
      dataDictionaryWorkbenchHeight: Math.round(dataDictionaryWorkbenchRect?.height ?? 0),
      systemAuditWorkbenchHeight: Math.round(systemAuditWorkbenchRect?.height ?? 0),
      systemSettingsWorkbenchWidth: Math.round(systemSettingsWorkbenchRect?.width ?? 0),
      systemSettingsWorkbenchHeight: Math.round(systemSettingsWorkbenchRect?.height ?? 0),
      marketKlineWorkbenchWidth: Math.round(marketKlineWorkbenchRect?.width ?? 0),
      marketKlineWorkbenchHeight: Math.round(marketKlineWorkbenchRect?.height ?? 0),
      klineCanvasHeight: Math.round(klineCanvasRect?.height ?? 0),
      strategyEditorWorkbenchHeight: Math.round(strategyEditorWorkbenchRect?.height ?? 0),
      strategyEditorShellHeight: Math.round(strategyEditorShellRect?.height ?? 0),
      backtestReportWorkbenchHeight: Math.round(backtestReportWorkbenchRect?.height ?? 0),
      backtestReportEmptyWorkbenchHeight: Math.round(backtestReportEmptyWorkbenchRect?.height ?? 0),
      dashboardDetailTabsTop: Math.round(dashboardDetailTabsRect?.top ?? 0),
      dashboardDetailTabsHeight: Math.round(dashboardDetailTabsRect?.height ?? 0),
      dashboardTaskListHeight: Math.round(dashboardTaskListRect?.height ?? 0),
      visibleButtonCount: buttons.length,
      visibleInputCount: inputs.length,
    };
  });
}

async function readScrollObstructionMetrics(page: Page) {
  return page.evaluate(() => {
    const appContent = document.querySelector<HTMLElement>('.app-content');
    const bottomStatus = document.querySelector<HTMLElement>('.app-shell__bottom-status');
    const isVisible = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect();
      const elementStyle = window.getComputedStyle(element);
      return (
        rect.width > 8 &&
        rect.height > 8 &&
        elementStyle.display !== 'none' &&
        elementStyle.visibility !== 'hidden' &&
        elementStyle.opacity !== '0' &&
        rect.bottom >= 0 &&
        rect.right >= 0 &&
        rect.top <= window.innerHeight &&
        rect.left <= window.innerWidth
      );
    };
    const isAllowedActionBlocker = (target: HTMLElement, top: Element | null) => {
      if (!top) return true;
      if (target === top || target.contains(top) || top.contains(target)) return true;
      if (top.closest('.ant-tooltip,.ant-dropdown,.ant-select-dropdown,.ant-picker-dropdown,.ant-popover,.ant-message,.ant-notification,.ant-spin')) return true;
      if (target.classList.contains('ant-select-selection-search-input') && top.closest('.ant-select-selection-item')) return true;
      if (target.closest('.ant-table-filter-trigger') && top.closest('.ant-table-cell')) return true;
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
    ).filter((element) => isVisible(element) && !(element.closest('.monaco-editor') && ['INPUT', 'TEXTAREA'].includes(element.tagName)));
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
    const bottomStatusRect = bottomStatus && isVisible(bottomStatus) ? bottomStatus.getBoundingClientRect() : null;
    const appContentRect = appContent && isVisible(appContent) ? appContent.getBoundingClientRect() : null;
    const bottomStatusOverlapCount = bottomStatusRect
      ? actionableElements.filter((target) => {
        const rect = target.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const probeY = Math.min(rect.bottom - 1, bottomStatusRect.top + 2);
        return (
          probeY >= bottomStatusRect.top &&
          probeY <= bottomStatusRect.bottom &&
          isPointInsideVisibleClip(target, centerX, probeY) &&
          bottomStatus.contains(document.elementFromPoint(centerX, probeY))
        );
      }).length
      : 0;

    return {
      appContentScrollTop: Math.round(appContent?.scrollTop ?? window.scrollY),
      appContentBottomGap: appContentRect && bottomStatusRect
        ? Math.round(bottomStatusRect.top - appContentRect.bottom)
        : 0,
      bottomStatusLeftDelta: appContentRect && bottomStatusRect
        ? Math.round(bottomStatusRect.left - appContentRect.left)
        : 0,
      bottomStatusRightDelta: appContentRect && bottomStatusRect
        ? Math.round(bottomStatusRect.right - appContentRect.right)
        : 0,
      blockedActionCount,
      bottomStatusOverlapCount,
    };
  });
}

for (const viewport of viewports) {
  test(`设备密度基线 ${viewport.name}`, async ({ page }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });

    for (const route of routes) {
      await openRouteForAudit(page, route);
      await waitForUiIdle(page, 1_500);
      await prepareForDensityMeasurement(page);
      const metrics = await readDensityMetrics(page);

      expect(metrics.density).toBe('compact');
      expect(metrics.sidebarWidth).toBeLessThanOrEqual(viewport.expectedSidebarMax);
      expect(metrics.statusHeight).toBeLessThanOrEqual(viewport.expectedStatusMax);
      expect(metrics.contentPaddingX).toBeLessThanOrEqual(viewport.expectedPaddingMax);
      expect(metrics.tableActionWidth).toBeLessThanOrEqual(isMacViewport(viewport.name) ? 104 : 112);
      expect(metrics.tableMessageWidth).toBeLessThanOrEqual(isMacViewport(viewport.name) ? 260 : 300);
      expect(metrics.bodyScrollWidth).toBeLessThanOrEqual(metrics.viewportWidth + 2);
      expect(metrics.bodyScrollOverflowY, `${viewport.name} ${route.title} 页面不能再用整页滚动让底部状态栏覆盖内容`).toBeLessThanOrEqual(1);
      expect(metrics.moduleScrollWidth).toBeLessThanOrEqual(metrics.moduleClientWidth + 2);
      expect(metrics.moduleOverflowY, `${viewport.name} ${route.title} 模块页不能变成第二个主滚动容器裁剪功能区`).toBe('visible');
      expect(metrics.workspaceCanvasOverflowY, `${viewport.name} ${route.title} 工作区画布不能裁剪模块页`).toBe('visible');
      expect(metrics.bottomStatusPosition, `${viewport.name} ${route.title} 底部状态栏必须占位在 AppShell 内，不能 fixed 覆盖模块`).not.toBe('fixed');
      expect(metrics.appContentBottomGap, `${viewport.name} ${route.title} 内容区底部必须贴合底部状态栏上沿`).toBeGreaterThanOrEqual(-1);
      expect(metrics.appContentBottomGap, `${viewport.name} ${route.title} 内容区和底栏之间不能出现异常空洞`).toBeLessThanOrEqual(1);
      expect(Math.abs(metrics.bottomStatusLeftDelta), `${viewport.name} ${route.title} 底部状态栏左边界必须和内容区对齐`).toBeLessThanOrEqual(1);
      expect(Math.abs(metrics.bottomStatusRightDelta), `${viewport.name} ${route.title} 底部状态栏右边界必须和内容区对齐`).toBeLessThanOrEqual(1);
      expect(metrics.shellTransform).toBe('none');
      expect(metrics.bodyZoom).toBe('');
      expect(metrics.maxButtonHeight, `${viewport.name} ${route.title} 按钮高度不能依赖浏览器缩放`).toBeLessThanOrEqual(30);
      expect(metrics.maxInputHeight, `${viewport.name} ${route.title} 输入框高度必须紧凑且不漂线`).toBeLessThanOrEqual(30);
      if (metrics.minInputHeight > 0) {
        expect(metrics.minInputHeight, `${viewport.name} ${route.title} 输入框不能被压扁到文字贴线`).toBeGreaterThanOrEqual(26);
      }
      expect(metrics.badControlTextAlignmentCount, `${viewport.name} ${route.title} 输入框/选择器文字不能贴边压线`).toBe(0);
      expect(metrics.maxControlTextCenterDrift, `${viewport.name} ${route.title} 输入控件文字必须垂直居中`).toBeLessThanOrEqual(2.5);
      expect(metrics.maxControlLineOverflow, `${viewport.name} ${route.title} 输入控件文字行高不能超过可用高度`).toBeLessThanOrEqual(1);
      expect(metrics.maxControlTextOutside, `${viewport.name} ${route.title} 输入控件文字不能越出外框`).toBe(0);
      if (metrics.maxEmptyGuideHeight > 0) {
        expect(metrics.maxEmptyGuideHeight, `${viewport.name} ${route.title} 空状态不能撑成大块空白`).toBeLessThanOrEqual(44);
      }
      if (metrics.maxEmptyRowHeight > 0) {
        expect(metrics.maxEmptyRowHeight, `${viewport.name} ${route.title} 空表格占位行必须紧凑`).toBeLessThanOrEqual(48);
      }
      expect(metrics.maxDirectModuleGap, `${viewport.name} ${route.title} 模块直接间距不能形成大块空白`).toBeLessThanOrEqual(
        isMacViewport(viewport.name) ? 8 : 10,
      );
      expect(metrics.directModuleOverlapCount, `${viewport.name} ${route.title} 页面直接模块不能互相堆叠遮挡`).toBe(0);
      expect(metrics.nestedModuleOverlapCount, `${viewport.name} ${route.title} 工作台内部兄弟模块不能互相堆叠遮挡`).toBe(0);
      const expectedContentCoverage = getExpectedContentCoverage(route.url, viewport.name);
      if (expectedContentCoverage !== null) {
        expect(
          metrics.contentCoverage,
          `${viewport.name} ${route.title} ${route.url} 主工作区覆盖率不能退回半屏空白，当前底部空白 ${metrics.bottomBlankHeight}px`,
        ).toBeGreaterThanOrEqual(expectedContentCoverage);
      }
      expect(
        metrics.bottomBlankHeight,
        `${viewport.name} ${route.title} ${route.url} 底部空白不能形成大屏空洞`,
      ).toBeLessThanOrEqual(getMaxBottomBlankHeight(viewport.name));
      expect(metrics.actionZoneOverflowCount, `${viewport.name} ${route.title} 操作按钮区不能挤爆或无序换行`).toBe(0);
      expect(metrics.blockedActionCount, `${viewport.name} ${route.title} 不能有按钮、输入框、链接被其它模块遮挡`).toBe(0);
      expect(metrics.pageHeaderRows, `${viewport.name} ${route.title} 顶部主操作区必须保持单行秩序`).toBeLessThanOrEqual(1);
      expect(metrics.commandActionRows, `${viewport.name} ${route.title} 命令面板操作区必须保持单行秩序`).toBeLessThanOrEqual(1);
      if (metrics.strategyWorkflowRailWidth > 0) {
        expect(metrics.strategyWorkflowRailWidth, `${viewport.name} ${route.title} 策略工作流检查栏不能无节制放大`).toBeLessThanOrEqual(
          isMacViewport(viewport.name) ? 340 : 360,
        );
        expect(metrics.strategyWorkflowRailHeight, `${viewport.name} ${route.title} 策略工作流检查栏必须紧凑`).toBeLessThanOrEqual(340);
      }
      if (metrics.backtestTaskFlowRailWidth > 0) {
        expect(metrics.backtestTaskFlowRailWidth, `${viewport.name} ${route.title} 回测工作流检查栏不能无节制放大`).toBeLessThanOrEqual(
          isMacViewport(viewport.name) ? 348 : 368,
        );
        expect(metrics.backtestTaskFlowRailHeight, `${viewport.name} ${route.title} 回测工作流检查栏必须紧凑`).toBeLessThanOrEqual(340);
      }
      if (metrics.tradingSignalSafetyRailWidth > 0) {
        expect(metrics.tradingSignalSafetyRailWidth, `${viewport.name} ${route.title} 交易安全检查栏不能无节制放大`).toBeLessThanOrEqual(
          isMacViewport(viewport.name) ? 356 : 376,
        );
        expect(metrics.tradingSignalSafetyRailHeight, `${viewport.name} ${route.title} 交易安全检查栏必须紧凑`).toBeLessThanOrEqual(340);
      }
      if (metrics.tradingManualWorkbenchHeight > 0) {
        expect(metrics.tradingManualWorkbenchHeight, `${viewport.name} ${route.title} 交易面板工作台高度必须受控`).toBeLessThanOrEqual(
          isMacViewport(viewport.name) ? 760 : is4kViewport(viewport.name) ? 1240 : 940,
        );
        expect(metrics.tradingManualWorkbenchHeight, `${viewport.name} ${route.title} 交易面板不能只停留在半屏表单`).toBeGreaterThanOrEqual(
          isMacViewport(viewport.name) ? 470 : is4kViewport(viewport.name) ? 900 : 600,
        );
      }
      if (metrics.tradingRecordWorkbenchHeight > 0) {
        expect(metrics.tradingRecordWorkbenchHeight, `${viewport.name} ${route.title} 交易记录工作台高度必须受控`).toBeLessThanOrEqual(
          isMacViewport(viewport.name) ? 980 : is4kViewport(viewport.name) ? 1560 : 1220,
        );
        expect(metrics.tradingRecordWorkbenchHeight, `${viewport.name} ${route.title} 交易记录表格不能只停留在半屏短卡片`).toBeGreaterThanOrEqual(
          isMacViewport(viewport.name) ? 430 : is4kViewport(viewport.name) ? 820 : 560,
        );
      }
      if (metrics.dataSyncWorkbenchHeight > 0) {
        expect(metrics.dataSyncWorkbenchHeight, `${viewport.name} ${route.title} 数据同步工作台高度必须受控`).toBeLessThanOrEqual(
          isMacViewport(viewport.name) ? 920 : is4kViewport(viewport.name) ? 1340 : 1200,
        );
        expect(metrics.dataSyncWorkbenchHeight, `${viewport.name} ${route.title} 数据同步不能只显示短任务列表`).toBeGreaterThanOrEqual(
          isMacViewport(viewport.name) ? 640 : is4kViewport(viewport.name) ? 1040 : 820,
        );
      }
      if (metrics.dataSourceWorkbenchHeight > 0) {
        expect(metrics.dataSourceWorkbenchHeight, `${viewport.name} ${route.title} 数据来源工作台高度必须受控`).toBeLessThanOrEqual(
          isMacViewport(viewport.name) ? 760 : is4kViewport(viewport.name) ? 1280 : 1160,
        );
        expect(metrics.dataSourceWorkbenchHeight, `${viewport.name} ${route.title} 数据来源不能只停留在短连接卡片`).toBeGreaterThanOrEqual(
          isMacViewport(viewport.name) ? 560 : is4kViewport(viewport.name) ? 920 : 720,
        );
      }
      if (metrics.dataDictionaryWorkbenchHeight > 0) {
        expect(metrics.dataDictionaryWorkbenchHeight, `${viewport.name} ${route.title} 数据字典工作台高度必须受控`).toBeLessThanOrEqual(
          isMacViewport(viewport.name) ? 780 : is4kViewport(viewport.name) ? 1280 : 1180,
        );
        expect(metrics.dataDictionaryWorkbenchHeight, `${viewport.name} ${route.title} 数据字典不能只显示短索引和短表格`).toBeGreaterThanOrEqual(
          isMacViewport(viewport.name) ? 560 : is4kViewport(viewport.name) ? 920 : 720,
        );
      }
      if (metrics.systemSettingsWorkbenchWidth > 0) {
        expect(metrics.systemSettingsWorkbenchHeight, `${viewport.name} ${route.title} 系统基础设置工作台高度必须受控`).toBeLessThanOrEqual(
          isMacViewport(viewport.name) ? 430 : is4kViewport(viewport.name) ? 1060 : 820,
        );
        expect(metrics.systemSettingsWorkbenchHeight, `${viewport.name} ${route.title} 系统基础设置工作台需要承载路径、账户和长期使用边界`).toBeGreaterThanOrEqual(
          isMacViewport(viewport.name) ? 300 : is4kViewport(viewport.name) ? 860 : 560,
        );
      }
      if (metrics.systemAuditWorkbenchHeight > 0) {
        expect(metrics.systemAuditWorkbenchHeight, `${viewport.name} ${route.title} 系统审计工作台高度必须受控`).toBeLessThanOrEqual(
          isMacViewport(viewport.name) ? 780 : is4kViewport(viewport.name) ? 1340 : 1180,
        );
        expect(metrics.systemAuditWorkbenchHeight, `${viewport.name} ${route.title} 系统审计工作台不能只显示短表格`).toBeGreaterThanOrEqual(
          isMacViewport(viewport.name) ? 620 : is4kViewport(viewport.name) ? 980 : 740,
        );
      }
      if (metrics.maxSystemPathInputWidth > 0) {
        expect(metrics.maxSystemPathInputWidth, `${viewport.name} ${route.title} 系统路径输入框不能在大屏横向无节制放大`).toBeLessThanOrEqual(
          isMacViewport(viewport.name) ? 460 : is4kViewport(viewport.name) ? 560 : 520,
        );
      }
      if (metrics.marketKlineWorkbenchWidth > 0) {
        expect(metrics.marketKlineWorkbenchHeight, `${viewport.name} ${route.title} K线工作台不能吃掉整屏`).toBeLessThanOrEqual(
          isMacViewport(viewport.name) ? 560 : 600,
        );
        expect(metrics.klineCanvasHeight, `${viewport.name} ${route.title} K线画布高度必须稳定受控`).toBeLessThanOrEqual(380);
      }
      if (metrics.strategyEditorShellHeight > 0) {
        expect(metrics.strategyEditorShellHeight, `${viewport.name} ${route.title} 策略编辑器不能在首屏无节制拉高`).toBeLessThanOrEqual(
          isMacViewport(viewport.name) ? 720 : is4kViewport(viewport.name) ? 1120 : 900,
        );
      }
      if (metrics.strategyEditorWorkbenchHeight > 0) {
        expect(metrics.strategyEditorWorkbenchHeight, `${viewport.name} ${route.title} 策略代码工作台高度必须受控`).toBeLessThanOrEqual(
          isMacViewport(viewport.name) ? 780 : is4kViewport(viewport.name) ? 1500 : 1180,
        );
        if (route.url.includes('tab=%E4%BB%A3%E7%A0%81%E7%BC%96%E8%BE%91') || route.url.includes('tab=代码编辑')) {
          expect(metrics.strategyEditorWorkbenchHeight, `${viewport.name} ${route.title} 策略代码工作台不能只铺半屏`).toBeGreaterThanOrEqual(
            isMacViewport(viewport.name) ? 620 : is4kViewport(viewport.name) ? 1380 : 1000,
          );
        }
      }
      if (metrics.backtestReportWorkbenchHeight > 0) {
        expect(metrics.backtestReportWorkbenchHeight, `${viewport.name} ${route.title} 回测报告工作台高度必须受控`).toBeLessThanOrEqual(760);
      }
      if (metrics.backtestReportEmptyWorkbenchHeight > 0) {
        expect(metrics.backtestReportEmptyWorkbenchHeight, `${viewport.name} ${route.title} 回测空报告工作台高度必须受控`).toBeLessThanOrEqual(
          isMacViewport(viewport.name) ? 670 : is4kViewport(viewport.name) ? 1320 : 1120,
        );
        expect(metrics.backtestReportEmptyWorkbenchHeight, `${viewport.name} ${route.title} 回测空报告工作台需要足够信息密度`).toBeGreaterThanOrEqual(
          isShortMacViewport(viewport.name) ? 540 : isMacViewport(viewport.name) ? 600 : is4kViewport(viewport.name) ? 1080 : 980,
        );
      }
      if (metrics.dashboardDetailTabsTop > 0) {
        expect(metrics.dashboardDetailTabsTop, `${viewport.name} ${route.title} 首页明细区不能被右侧任务队列挤到首屏外`).toBeLessThanOrEqual(
          is4kViewport(viewport.name) ? 720 : 660,
        );
        if (viewport.height >= 1200) {
          expect(metrics.dashboardDetailTabsHeight, `${viewport.name} ${route.title} 大屏首页明细区要吃满更多工作区，不能只铺半屏`).toBeGreaterThanOrEqual(
            is4kViewport(viewport.name) ? 850 : 760,
          );
        }
      }
      if (metrics.dashboardTaskListHeight > 0) {
        expect(metrics.dashboardTaskListHeight, `${viewport.name} ${route.title} 首页任务列表不能无限拉高`).toBeLessThanOrEqual(430);
      }

      if (metrics.maxCommandItemWidth > 0) {
        expect(metrics.maxCommandItemWidth).toBeLessThanOrEqual(192);
      }
      if (metrics.maxMetricCardWidth > 0) {
        expect(metrics.maxMetricCardWidth).toBeLessThanOrEqual(270);
      }
    }
  });
}

for (const viewport of viewports.filter((item) => (
  item.name === 'macbook-pro-14-browser-safe'
  || item.name === 'macbook-pro-14-chrome-safe'
  || item.name === 'windows-27-qhd'
))) {
  test(`滚动状态遮挡护栏 ${viewport.name}`, async ({ page }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });

    for (const route of routes) {
      await openRouteForAudit(page, route);
      await waitForUiIdle(page, 600);
      await prepareForDensityMeasurement(page);
      const scrollPositions = await page.evaluate(() => {
        const appContent = document.querySelector<HTMLElement>('.app-content');
        const maxScroll = Math.max(0, (appContent?.scrollHeight ?? document.documentElement.scrollHeight) - (appContent?.clientHeight ?? window.innerHeight));
        return Array.from(new Set([0, Math.round(maxScroll / 2), maxScroll]));
      });

      for (const scrollTop of scrollPositions) {
        await closeTransientOverlays(page);
        await page.evaluate((nextScrollTop) => {
          const appContent = document.querySelector<HTMLElement>('.app-content');
          if (appContent) {
            appContent.scrollTop = nextScrollTop;
          } else {
            window.scrollTo(0, nextScrollTop);
          }
        }, scrollTop);
        await page.waitForTimeout(80);
        await prepareForDensityMeasurement(page);
        const metrics = await readScrollObstructionMetrics(page);
        expect(metrics.appContentBottomGap, `${viewport.name} ${route.url} 内容区滚动位置 ${scrollTop} 不能被底部状态栏压住`).toBeGreaterThanOrEqual(-1);
        expect(metrics.appContentBottomGap, `${viewport.name} ${route.url} 内容区和底部状态栏不能脱节`).toBeLessThanOrEqual(1);
        expect(Math.abs(metrics.bottomStatusLeftDelta), `${viewport.name} ${route.url} 滚动位置 ${scrollTop} 底部状态栏左边界必须和内容区对齐`).toBeLessThanOrEqual(1);
        expect(Math.abs(metrics.bottomStatusRightDelta), `${viewport.name} ${route.url} 滚动位置 ${scrollTop} 底部状态栏右边界必须和内容区对齐`).toBeLessThanOrEqual(1);
        expect(metrics.blockedActionCount, `${viewport.name} ${route.url} 滚动位置 ${scrollTop} 存在可操作元素被模块遮挡`).toBe(0);
        expect(metrics.bottomStatusOverlapCount, `${viewport.name} ${route.url} 滚动位置 ${scrollTop} 存在按钮/输入框进入底部状态栏区域`).toBe(0);
      }
    }
  });
}

for (const viewport of remoteSafeViewports) {
  test(`远程小视口遮挡护栏 ${viewport.name}`, async ({ page }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });

    for (const route of routes) {
      await openRouteForAudit(page, route);
      await waitForUiIdle(page, 600);
      await prepareForDensityMeasurement(page);
      const scrollPositions = await page.evaluate(() => {
        const appContent = document.querySelector<HTMLElement>('.app-content');
        const maxScroll = Math.max(0, (appContent?.scrollHeight ?? document.documentElement.scrollHeight) - (appContent?.clientHeight ?? window.innerHeight));
        return Array.from(new Set([0, Math.round(maxScroll / 2), maxScroll]));
      });

      for (const scrollTop of scrollPositions) {
        await closeTransientOverlays(page);
        await page.evaluate((nextScrollTop) => {
          const appContent = document.querySelector<HTMLElement>('.app-content');
          if (appContent) {
            appContent.scrollTop = nextScrollTop;
          } else {
            window.scrollTo(0, nextScrollTop);
          }
        }, scrollTop);
        await page.waitForTimeout(80);
        await prepareForDensityMeasurement(page);
        const metrics = await readScrollObstructionMetrics(page);
        expect(metrics.appContentBottomGap, `${viewport.name} ${route.url} 内容区底部不能被状态栏压住`).toBeGreaterThanOrEqual(-1);
        expect(metrics.appContentBottomGap, `${viewport.name} ${route.url} 内容区和状态栏不能脱节`).toBeLessThanOrEqual(1);
        expect(Math.abs(metrics.bottomStatusLeftDelta), `${viewport.name} ${route.url} 底部状态栏左边界必须和内容区对齐`).toBeLessThanOrEqual(1);
        expect(Math.abs(metrics.bottomStatusRightDelta), `${viewport.name} ${route.url} 底部状态栏右边界必须和内容区对齐`).toBeLessThanOrEqual(1);
        expect(metrics.blockedActionCount, `${viewport.name} ${route.url} 滚动位置 ${scrollTop} 有按钮/输入框/链接被遮挡`).toBe(0);
        expect(metrics.bottomStatusOverlapCount, `${viewport.name} ${route.url} 滚动位置 ${scrollTop} 有操作元素进入底部状态栏区域`).toBe(0);
      }
    }
  });
}

test('页面工具栏不能因单行挤压产生遮挡或裁剪', async ({ page }) => {
  test.setTimeout(120_000);
  const toolbarRoutes = routes.filter((route) => [
    '/dashboard',
    '/data-center',
    '/strategy-dev',
    '/backtest',
    '/trading',
    '/system',
  ].includes(route.url));

  await page.setViewportSize({ width: 1280, height: 720 });
  for (const route of toolbarRoutes) {
    await openRouteForAudit(page, route);
    await waitForUiIdle(page, 600);
    await prepareForDensityMeasurement(page);
    const issues = await page.evaluate(() => {
      const appRect = document.querySelector<HTMLElement>('.app-content')?.getBoundingClientRect();
      const isVisible = (element: HTMLElement) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return (
          rect.width > 8 &&
          rect.height > 8 &&
          rect.bottom > 0 &&
          rect.right > 0 &&
          rect.top < window.innerHeight &&
          rect.left < window.innerWidth &&
          style.display !== 'none' &&
          style.visibility !== 'hidden'
        );
      };
      const selectors = [
        '.page-header-actions',
        '.section-card .ant-card-extra',
        '.workspace-panel__tools',
        '.data-table__header',
        '.data-sync-current-task__head',
        '.task-progress-inline__head',
      ];
      return Array.from(document.querySelectorAll<HTMLElement>(selectors.join(',')))
        .filter(isVisible)
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          const hiddenOverflow = /(hidden|clip)/.test(`${style.overflow} ${style.overflowX} ${style.overflowY}`);
          return {
            className: String(element.className || '').slice(0, 120),
            text: (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120),
            clipped: hiddenOverflow && (element.scrollWidth > element.clientWidth + 2 || element.scrollHeight > element.clientHeight + 2),
            outsideLeft: appRect ? rect.left < appRect.left - 1 : false,
            outsideRight: appRect ? rect.right > appRect.right + 1 : false,
          };
        })
        .filter((item) => item.clipped || item.outsideLeft || item.outsideRight);
    });

    expect(issues, `${route.url} 工具栏/操作区不能被裁剪、越界或遮挡`).toEqual([]);
  }
});
