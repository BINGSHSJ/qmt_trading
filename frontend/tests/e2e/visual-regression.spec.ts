import { expect, test, type Page } from '@playwright/test';

const routes = [
  { url: '/dashboard', title: '总览看板' },
  { url: '/data-center', title: '数据中心' },
  { url: '/strategy-dev', title: '策略开发' },
  { url: '/backtest', title: '回测研究' },
  { url: '/trading', title: '交易执行' },
  { url: '/system', title: '系统管理' },
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

async function scanVisibleLightLeaks(page: Page, selector: string) {
  return page.evaluate((currentSelector) => {
    const root = document.querySelector(currentSelector);
    if (!root) {
      return [{ className: 'missing-root', background: 'none', text: currentSelector }];
    }
    const isVisible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 12
        && rect.height > 6
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.bottom >= 0
        && rect.right >= 0
        && rect.top <= window.innerHeight
        && rect.left <= window.innerWidth;
    };
    const isLightBackground = (background: string) => {
      const match = background.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (!match) return false;
      const [, red, green, blue, alpha = '1'] = match;
      return Number(alpha) > 0.35 && Number(red) > 235 && Number(green) > 235 && Number(blue) > 235;
    };
    return [root, ...Array.from(root.querySelectorAll('*'))]
      .filter(isVisible)
      .map((element) => ({
        className: String((element as HTMLElement).className || '').slice(0, 140),
        background: window.getComputedStyle(element).backgroundColor,
        text: (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100),
      }))
      .filter((entry) => isLightBackground(entry.background))
      .slice(0, 12);
  }, selector);
}

async function scanModalMetrics(page: Page, selector: string) {
  return page.evaluate((currentSelector) => {
    const isVisible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 12
        && rect.height > 6
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.bottom >= 0
        && rect.right >= 0
        && rect.top <= window.innerHeight
        && rect.left <= window.innerWidth;
    };
    const seen = new Set<HTMLElement>();
    const modalCandidates = Array.from(document.querySelectorAll<HTMLElement>(currentSelector))
      .map((element) => element.closest<HTMLElement>('[role="dialog"]') ?? element.closest<HTMLElement>('.ant-modal') ?? element)
      .filter((element) => {
        if (seen.has(element)) return false;
        seen.add(element);
        return true;
      });
    const modal = modalCandidates
      .filter(isVisible)
      .sort((left, right) => {
        const leftRect = left.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();
        return (rightRect.width * rightRect.height) - (leftRect.width * leftRect.height);
      })[0] ?? null;
    if (!modal) {
      return {
        exists: false,
        width: 0,
        bodyHeight: 0,
        maxSectionHeight: 0,
        minSectionHeight: 0,
        sectionHeightSpread: 0,
        labelWidths: [] as number[],
        contentMinWidth: 0,
        contentMaxWidth: 0,
        buttonHeights: [] as number[],
        leaks: [{ className: 'missing-modal', background: 'none', text: currentSelector }],
      };
    }
    const isLightBackground = (background: string) => {
      const match = background.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (!match) return false;
      const [, red, green, blue, alpha = '1'] = match;
      return Number(alpha) > 0.35 && Number(red) > 235 && Number(green) > 235 && Number(blue) > 235;
    };
    const sections = Array.from(modal.querySelectorAll<HTMLElement>(
      '.risk-confirm-content__object, .risk-confirm-content__block, .risk-confirm-content__details-wrap, .risk-confirm-content__next, .risk-confirm-content__extra, .order-confirm-descriptions',
    ));
    const sectionHeights = sections.map((section) => Math.round(section.getBoundingClientRect().height));
    const labels = Array.from(modal.querySelectorAll<HTMLElement>('.ant-descriptions-item-label'));
    const contents = Array.from(modal.querySelectorAll<HTMLElement>('.ant-descriptions-item-content'));
    const buttons = Array.from(modal.querySelectorAll<HTMLElement>('.ant-btn'));
    const body = modal.querySelector<HTMLElement>('.ant-modal-body, .ant-modal-confirm-content');
    return {
      exists: true,
      width: Math.round(modal.getBoundingClientRect().width),
      bodyHeight: Math.round(body?.getBoundingClientRect().height ?? 0),
      maxSectionHeight: sectionHeights.length ? Math.max(...sectionHeights) : 0,
      minSectionHeight: sectionHeights.length ? Math.min(...sectionHeights) : 0,
      sectionHeightSpread: sectionHeights.length ? Math.max(...sectionHeights) - Math.min(...sectionHeights) : 0,
      labelWidths: labels.map((label) => Math.round(label.getBoundingClientRect().width)),
      contentMinWidth: contents.length
        ? contents.reduce((min, content) => Math.min(min, Math.round(content.getBoundingClientRect().width)), Number.POSITIVE_INFINITY)
        : 0,
      contentMaxWidth: contents.reduce((max, content) => Math.max(max, Math.round(content.getBoundingClientRect().width)), 0),
      buttonHeights: buttons.map((button) => Math.round(button.getBoundingClientRect().height)),
      leaks: Array.from(modal.querySelectorAll<HTMLElement>('*'))
        .filter(isVisible)
        .map((element) => ({
          className: String(element.className || '').slice(0, 140),
          background: window.getComputedStyle(element).backgroundColor,
          text: (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100),
        }))
        .filter((entry) => isLightBackground(entry.background))
        .slice(0, 12),
    };
  }, selector);
}

async function scanActionableBlockers(page: Page, selector: string) {
  return page.evaluate((currentSelector) => {
    const root = document.querySelector<HTMLElement>(currentSelector);
    if (!root) {
      return [{ text: currentSelector, targetClass: 'missing-root', topTag: '', topClass: '', x: 0, y: 0 }];
    }
    const isVisible = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 8
        && rect.height > 8
        && style.display !== 'none'
        && style.visibility !== 'hidden'
        && style.opacity !== '0'
        && rect.bottom >= 0
        && rect.right >= 0
        && rect.top <= window.innerHeight
        && rect.left <= window.innerWidth;
    };
    const isAllowedBlocker = (target: HTMLElement, top: Element | null) => {
      if (!top) return true;
      if (target === top || target.contains(top) || top.contains(target)) return true;
      if (top.closest('.ant-tooltip,.ant-dropdown,.ant-select-dropdown,.ant-picker-dropdown,.ant-popover,.ant-message,.ant-notification')) return true;
      if (top.closest('.ant-spin')) return true;
      if (target.closest('.ant-table-filter-trigger') && top.closest('.ant-table-cell')) return true;
      return false;
    };
    const isPointInsideVisibleClip = (target: HTMLElement, x: number, y: number) => {
      let current = target.parentElement;
      while (current && current !== document.body && current !== root.parentElement) {
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
    const actionable = Array.from(root.querySelectorAll<HTMLElement>(
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
    )).filter((element) => isVisible(element) && !(element.closest('.monaco-editor') && ['INPUT', 'TEXTAREA'].includes(element.tagName)));

    return actionable.flatMap((target) => {
      const rect = target.getBoundingClientRect();
      const insetX = Math.min(8, Math.max(2, rect.width / 3));
      const points = [
        [rect.left + rect.width / 2, rect.top + rect.height / 2],
        [rect.left + insetX, rect.top + rect.height / 2],
        [rect.right - insetX, rect.top + rect.height / 2],
      ].filter(([x, y]) => x >= 0 && y >= 0 && x <= window.innerWidth && y <= window.innerHeight)
        .filter(([x, y]) => isPointInsideVisibleClip(target, x, y));
      if (points.length === 0) return [];
      const blocked = points.every(([x, y]) => !isAllowedBlocker(target, document.elementFromPoint(x, y)));
      if (!blocked) return [];
      const [x, y] = points[0];
      const top = document.elementFromPoint(x, y);
      return [{
        text: (target.textContent || target.getAttribute('aria-label') || target.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ').slice(0, 80),
        targetClass: String(target.className || '').slice(0, 120),
        topTag: top?.tagName ?? '',
        topClass: String((top as HTMLElement | null)?.className || '').slice(0, 120),
        x: Math.round(x),
        y: Math.round(y),
      }];
    }).slice(0, 12);
  }, selector);
}

async function scanTableColumnContract(page: Page, testId: string) {
  return page.evaluate((currentTestId) => {
    const root = document.querySelector<HTMLElement>(`[data-testid="${currentTestId}"]`);
    if (!root) {
      return [{ text: currentTestId, width: 0, reason: 'missing-table' }];
    }

    const isVisible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 12
        && rect.height > 6
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.bottom >= 0
        && rect.right >= 0
        && rect.top <= window.innerHeight
        && rect.left <= window.innerWidth;
    };
    const headers = Array.from(root.querySelectorAll<HTMLElement>('.ant-table-thead th'))
      .filter(isVisible)
      .map((header) => {
        const text = (header.innerText || '').trim().replace(/\s+/g, ' ');
        return {
          text,
          width: Math.round(header.getBoundingClientRect().width),
          className: String(header.className || '').slice(0, 160),
        };
      })
      .filter((header) => header.text && !header.text.includes('筛选'));

    const narrativeHeaders = ['原因', '触发原因', '信号原因', '跳过原因', '消息', '技术详情', '说明', '代码摘要', '备注'];
    const identityHeaders = ['股票', '策略', '策略名称', '文件名', '文件/版本', '策略快照'];
    const compactHeaders = ['方向', '动作', '状态', '级别', '来源', '频率', '版本', '版本号', '数量', '已成', '信号ID', '今日信号', '信号数'];
    const moneyHeaders = ['金额', '费用', '盈亏', '建议金额', '信号金额'];

    return headers.flatMap((header) => {
      const issues: Array<{ text: string; width: number; reason: string }> = [];
      const matches = (names: string[]) => names.some((name) => header.text === name || header.text.includes(name));
      if (matches(narrativeHeaders) && header.width < 260) {
        issues.push({ text: header.text, width: header.width, reason: 'long-text-too-narrow' });
      }
      if (identityHeaders.includes(header.text) && header.width < 150) {
        issues.push({ text: header.text, width: header.width, reason: 'identity-too-narrow' });
      }
      if (compactHeaders.includes(header.text) && header.width > 140) {
        issues.push({ text: header.text, width: header.width, reason: 'compact-too-wide' });
      }
      if (matches(moneyHeaders) && (header.width < 118 || header.width > 160)) {
        issues.push({ text: header.text, width: header.width, reason: 'money-width-out-of-range' });
      }
      if (header.text === '操作') {
        if (!header.className.includes('data-table-col--action')) {
          issues.push({ text: header.text, width: header.width, reason: 'action-missing-class' });
        }
        if (header.width > 190) {
          issues.push({ text: header.text, width: header.width, reason: 'action-too-wide' });
        }
      }
      return issues;
    });
  }, testId);
}

async function scanTableColumnFamilyContract(page: Page, testId: string) {
  return page.evaluate((currentTestId) => {
    const root = document.querySelector<HTMLElement>(`[data-testid="${currentTestId}"]`);
    if (!root) {
      return {
        exists: false,
        familyCount: 0,
        families: [] as string[],
        missingFamily: [{ text: currentTestId, className: 'missing-table' }],
        unknownFamily: [] as Array<{ text: string; family: string; className: string }>,
        numericMisalign: [] as Array<{ text: string; align: string }>,
        lightLeaks: [] as Array<{ text: string; background: string; className: string }>,
      };
    }
    const isVisible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 12
        && rect.height > 6
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.bottom >= 0
        && rect.right >= 0
        && rect.top <= window.innerHeight
        && rect.left <= window.innerWidth;
    };
    const isLightBackground = (background: string) => {
      const match = background.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (!match) return false;
      const [, red, green, blue, alpha = '1'] = match;
      return Number(alpha) > 0.35 && Number(red) > 235 && Number(green) > 235 && Number(blue) > 235;
    };
    const supportedFamilies = new Set(['identity', 'state', 'numeric', 'narrative', 'action', 'neutral']);
    const headers = Array.from(root.querySelectorAll<HTMLElement>('.ant-table-thead th'))
      .filter(isVisible)
      .map((header) => ({
        element: header,
        text: (header.innerText || '').trim().replace(/\s+/g, ' '),
        kind: header.getAttribute('data-column-kind') || '',
        family: header.getAttribute('data-column-family') || '',
        className: String(header.className || '').slice(0, 160),
        colSpan: Number(header.getAttribute('colspan') || '1'),
      }))
      .filter((header) => header.text && header.colSpan <= 1 && !header.text.includes('筛选'));
    const families = Array.from(new Set(headers.map((header) => header.family).filter(Boolean)));
    return {
      exists: true,
      familyCount: families.length,
      families,
      missingFamily: headers
        .filter((header) => !header.kind || !header.family)
        .map((header) => ({ text: header.text, className: header.className })),
      unknownFamily: headers
        .filter((header) => header.family && !supportedFamilies.has(header.family))
        .map((header) => ({ text: header.text, family: header.family, className: header.className })),
      numericMisalign: headers
        .filter((header) => header.family === 'numeric')
        .map((header) => ({ text: header.text, align: window.getComputedStyle(header.element).textAlign }))
        .filter((header) => header.align !== 'right' && header.align !== 'end'),
      lightLeaks: headers
        .map((header) => ({
          text: header.text,
          background: window.getComputedStyle(header.element).backgroundColor,
          className: header.className,
        }))
        .filter((header) => isLightBackground(header.background))
        .slice(0, 12),
    };
  }, testId);
}

test('六大页面视觉基线无横向溢出和循环引用警告', async ({ page }) => {
  test.setTimeout(60_000);
  const warnings: string[] = [];
  page.on('console', (message) => {
    const text = message.text();
    if (message.type() === 'warning' || message.type() === 'error') {
      warnings.push(text);
    }
  });

  for (const route of routes) {
    await gotoStable(page, route.url, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: route.title })).toBeVisible();
    await expect(page.locator('.status-strip')).toBeVisible();

    const metrics = await page.evaluate(() => {
      const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
      const rows = Array.from(document.querySelectorAll<HTMLElement>('.ant-table-row'));
      const maxRowHeight = rows.reduce((max, row) => Math.max(max, row.getBoundingClientRect().height), 0);
      return { overflow, maxRowHeight };
    });

    expect(metrics.overflow, `${route.title} 存在横向溢出`).toBeLessThanOrEqual(1);
    expect(metrics.maxRowHeight, `${route.title} 表格行高异常`).toBeLessThanOrEqual(96);
  }

  expect(warnings.filter((text) => text.includes('There may be circular references'))).toEqual([]);
});

test('总览看板摘要表在窄面板内保持紧凑列宽', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await gotoStable(page, '/dashboard');
  await expect(page.getByRole('heading', { name: '总览看板' })).toBeVisible();

  const metrics = await page.evaluate(() => {
    return Array.from(document.querySelectorAll<HTMLElement>('.data-table--dashboard-summary')).map((wrapper) => {
      const panel = wrapper.closest<HTMLElement>('.workspace-panel__body') ?? wrapper.parentElement ?? wrapper;
      const table = wrapper.querySelector<HTMLElement>('table');
      const search = wrapper.querySelector<HTMLElement>('.ant-input-search');
      const wrapperRect = wrapper.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const tableRect = table?.getBoundingClientRect();
      const searchRect = search?.getBoundingClientRect();
      return {
        wrapperRightOverflow: Math.max(0, Math.round(wrapperRect.right - panelRect.right)),
        tableRightOverflow: tableRect ? Math.max(0, Math.round(tableRect.right - panelRect.right)) : 0,
        searchRightOverflow: searchRect ? Math.max(0, Math.round(searchRect.right - panelRect.right)) : 0,
        searchHeight: searchRect ? Math.round(searchRect.height) : 0,
      };
    });
  });

  expect(metrics.length, '首页摘要表数量异常').toBeGreaterThanOrEqual(3);
  for (const [index, item] of metrics.entries()) {
    expect(item.wrapperRightOverflow, `首页第 ${index + 1} 个摘要表容器越出面板`).toBeLessThanOrEqual(1);
    expect(item.tableRightOverflow, `首页第 ${index + 1} 个摘要表列宽越出面板`).toBeLessThanOrEqual(1);
    expect(item.searchRightOverflow, `首页第 ${index + 1} 个摘要表搜索框越出面板`).toBeLessThanOrEqual(1);
    expect(item.searchHeight, `首页第 ${index + 1} 个摘要表搜索框高度异常`).toBeGreaterThanOrEqual(26);
    expect(item.searchHeight, `首页第 ${index + 1} 个摘要表搜索框高度异常`).toBeLessThanOrEqual(32);
  }
});

test('六大页面暗色工作台不泄漏默认浅色交互背景', async ({ page }) => {
  test.setTimeout(60000);

  for (const route of routes) {
    await gotoStable(page, route.url, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: route.title })).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.status-strip')).toBeVisible({ timeout: 15000 });

    const leaks = await page.evaluate(() => {
      const root = document.querySelector('.module-page');
      if (!root) {
        return [{ tag: 'missing-root', className: '.module-page', text: '', background: 'none' }];
      }

      const isVisible = (element: Element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 12
          && rect.height > 12
          && style.visibility !== 'hidden'
          && style.display !== 'none'
          && rect.bottom >= 0
          && rect.right >= 0
          && rect.top <= window.innerHeight
          && rect.left <= window.innerWidth;
      };

      const isLightBackground = (background: string) => {
        const match = background.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
        if (!match) {
          return false;
        }
        const [, red, green, blue, alpha = '1'] = match;
        return Number(alpha) > 0.35 && Number(red) > 235 && Number(green) > 235 && Number(blue) > 235;
      };

      return Array.from(root.querySelectorAll('*'))
        .filter(isVisible)
        .map((element) => {
          const style = window.getComputedStyle(element);
          return {
            tag: element.tagName.toLowerCase(),
            className: String((element as HTMLElement).className || '').slice(0, 140),
            text: (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100),
            background: style.backgroundColor,
          };
        })
        .filter((item) => isLightBackground(item.background))
        .slice(0, 12);
    });

    expect(leaks, `${route.title} 存在疑似 Ant Design 默认浅色背景泄漏`).toEqual([]);
  }
});

test('六大页面浅色主题不残留终端暗色块', async ({ page }) => {
  test.setTimeout(75_000);
  const viewports = [
    { name: 'macbook-pro-14-effective', width: 1512, height: 982 },
    { name: 'windows-27-qhd', width: 2560, height: 1440 },
  ];

  await page.addInitScript(() => {
    localStorage.setItem('lqc_theme_mode', 'light');
  });

  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });

    for (const route of routes) {
      await gotoStable(page, route.url, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: route.title })).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('.status-strip')).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(120);

      const audit = await page.evaluate(() => {
        const parseColor = (value: string) => {
          const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
          if (!match) return null;
          return {
            red: Number(match[1]),
            green: Number(match[2]),
            blue: Number(match[3]),
            alpha: Number(match[4] ?? '1'),
          };
        };
        const isVisible = (element: Element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return rect.width > 16
            && rect.height > 10
            && style.visibility !== 'hidden'
            && style.display !== 'none'
            && style.opacity !== '0'
            && rect.bottom >= 0
            && rect.right >= 0
            && rect.top <= window.innerHeight
            && rect.left <= window.innerWidth;
        };
        const isAllowedDarkSurface = (element: Element) => Boolean(element.closest([
          '.monaco-editor',
          '.monaco-editor-background',
          'canvas',
          '.ant-progress-bg',
          '.ant-progress-inner',
          '.status-chip__dot',
          '.page-loading-dot',
          '.ant-skeleton',
          '.ant-skeleton-content',
          '.ant-skeleton-title',
          '.ant-skeleton-paragraph',
          '.ant-switch-handle',
          '.ant-switch-inner',
          '.backtest-chart-main-plot',
          '.backtest-chart-drawdown-plot',
        ].join(',')));
        const isTerminalDark = (background: string) => {
          const color = parseColor(background);
          return Boolean(color && color.alpha >= 0.45 && color.red < 42 && color.green < 48 && color.blue < 58);
        };
        const root = document.querySelector('.app-shell');
        const leaks = root
          ? [root, ...Array.from(root.querySelectorAll('*'))]
            .filter((element) => isVisible(element) && !isAllowedDarkSurface(element))
            .map((element) => ({
              tag: element.tagName.toLowerCase(),
              className: String((element as HTMLElement).className || '').slice(0, 160),
              text: (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 90),
              background: window.getComputedStyle(element).backgroundColor,
            }))
            .filter((entry) => isTerminalDark(entry.background))
            .slice(0, 12)
          : [{ tag: 'missing', className: 'app-shell', text: '', background: 'none' }];

        return {
          theme: document.documentElement.dataset.theme,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          leaks,
        };
      });

      expect(audit.theme, `${viewport.name} ${route.title} 未进入浅色主题`).toBe('light');
      expect(audit.overflow, `${viewport.name} ${route.title} 浅色主题存在横向溢出`).toBeLessThanOrEqual(1);
      expect(audit.leaks, `${viewport.name} ${route.title} 浅色主题存在终端暗色残留`).toEqual([]);
    }
  }
});

test('六大页面浅色主题外壳表格和输入框色彩一致', async ({ page }) => {
  test.setTimeout(75_000);
  await page.addInitScript(() => {
    localStorage.setItem('lqc_theme_mode', 'light');
  });

  await page.setViewportSize({ width: 1512, height: 982 });

  for (const route of routes) {
    await gotoStable(page, route.url, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: route.title })).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.status-strip')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(120);

    const audit = await page.evaluate(() => {
      const parseColor = (value: string) => {
        const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
        if (!match) return null;
        return {
          red: Number(match[1]),
          green: Number(match[2]),
          blue: Number(match[3]),
          alpha: Number(match[4] ?? '1'),
        };
      };
      const luminance = (value: string) => {
        const color = parseColor(value);
        if (!color || color.alpha < 0.35) return null;
        return Math.round(0.2126 * color.red + 0.7152 * color.green + 0.0722 * color.blue);
      };
      const effectiveBackground = (element: Element | null) => {
        let current: Element | null = element;
        while (current) {
          const background = window.getComputedStyle(current).backgroundColor;
          const color = parseColor(background);
          if (color && color.alpha >= 0.35) return background;
          current = current.parentElement;
        }
        return window.getComputedStyle(document.body).backgroundColor;
      };
      const pickSurface = (selector: string, min: number, max = 255, optional = false) => {
        const element = document.querySelector(selector);
        if (!element) return { selector, exists: false, optional, lum: -1, background: 'missing' };
        const background = effectiveBackground(element);
        return {
          selector,
          exists: true,
          optional,
          lum: luminance(background) ?? -1,
          background,
          min,
          max,
        };
      };

      const requiredSurfaces = [
        pickSurface('.app-shell__sider', 238),
        pickSurface('.app-shell__nav', 238),
        pickSurface('.app-shell__top-chrome', 246),
        pickSurface('.status-strip', 246),
        pickSurface('.app-shell__bottom-status', 246),
        pickSurface('.workspace-canvas', 232),
        pickSurface('.data-table__table .ant-table', 246, 255, true),
        pickSurface('.data-table__table .ant-table-thead th', 236, 252, true),
      ];

      const noisyColumnBars = Array.from(document.querySelectorAll<HTMLElement>('.data-table__table .ant-table-thead th[data-column-family]'))
        .map((element) => ({
          text: (element.innerText || '').trim().replace(/\s+/g, ' '),
          shadow: window.getComputedStyle(element).boxShadow,
        }))
        .filter((item) => item.shadow !== 'none' && item.shadow.includes('inset 0px 2px'));

      const badInputs = Array.from(document.querySelectorAll<HTMLElement>('.ant-input-search .ant-input, .ant-select-selector, .ant-picker'))
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          const backgroundLum = luminance(effectiveBackground(element)) ?? 0;
          return rect.width > 20
            && rect.height > 10
            && style.visibility !== 'hidden'
            && style.display !== 'none'
            && (rect.height < 26 || rect.height > 34 || backgroundLum < 240);
        })
        .map((element) => ({
          className: String(element.className || '').slice(0, 120),
          height: Math.round(element.getBoundingClientRect().height),
          background: effectiveBackground(element),
        }))
        .slice(0, 12);

      return {
        theme: document.documentElement.dataset.theme,
        badSurfaces: requiredSurfaces.filter((surface) => (!surface.exists && !surface.optional) || (surface.exists && (surface.lum < surface.min || surface.lum > surface.max))),
        noisyColumnBars: noisyColumnBars.slice(0, 12),
        badInputs,
      };
    });

    expect(audit.theme, `${route.title} 未进入浅色主题`).toBe('light');
    expect(audit.badSurfaces, `${route.title} 浅色外壳/表格背景亮度不统一`).toEqual([]);
    expect(audit.noisyColumnBars, `${route.title} 浅色表格仍残留彩色列组顶线`).toEqual([]);
    expect(audit.badInputs, `${route.title} 浅色输入控件高度或背景异常`).toEqual([]);
  }
});

test('六大页面深浅主题关键文字对比度达标', async ({ page }) => {
  test.setTimeout(90_000);
  const themes = ['dark', 'light'] as const;
  await page.setViewportSize({ width: 1512, height: 982 });

  for (const theme of themes) {
    await page.addInitScript((mode) => {
      localStorage.setItem('lqc_theme_mode', mode);
    }, theme);

    for (const route of routes) {
      await gotoStable(page, route.url, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: route.title })).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('.status-strip')).toBeVisible({ timeout: 15_000 });
      await page.waitForTimeout(120);

      const audit = await page.evaluate(() => {
        type Rgba = { red: number; green: number; blue: number; alpha: number };
        const parseColor = (value: string): Rgba | null => {
          const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
          if (!match) return null;
          return {
            red: Number(match[1]),
            green: Number(match[2]),
            blue: Number(match[3]),
            alpha: Number(match[4] ?? '1'),
          };
        };
        const channel = (value: number) => {
          const normalized = value / 255;
          return normalized <= 0.03928
            ? normalized / 12.92
            : ((normalized + 0.055) / 1.055) ** 2.4;
        };
        const luminance = (color: Rgba) => (
          0.2126 * channel(color.red)
          + 0.7152 * channel(color.green)
          + 0.0722 * channel(color.blue)
        );
        const contrastRatio = (foreground: Rgba, background: Rgba) => {
          const fg = luminance(foreground);
          const bg = luminance(background);
          const lighter = Math.max(fg, bg);
          const darker = Math.min(fg, bg);
          return (lighter + 0.05) / (darker + 0.05);
        };
        const isVisible = (element: HTMLElement) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return rect.width > 8
            && rect.height > 8
            && rect.bottom >= 0
            && rect.right >= 0
            && rect.top <= window.innerHeight
            && rect.left <= window.innerWidth
            && style.visibility !== 'hidden'
            && style.display !== 'none'
            && style.opacity !== '0';
        };
        const directText = (element: HTMLElement) => Array.from(element.childNodes)
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent ?? '')
          .join('')
          .replace(/\s+/g, ' ')
          .trim();
        const isIgnored = (element: HTMLElement) => Boolean(element.closest([
          '.app-shell__brand-mark',
          '.monaco-editor',
          '.monaco-editor-background',
          '.ant-progress',
          '.ant-skeleton',
          '.ant-switch-handle',
          '.ant-slider',
          '.ant-tooltip',
          '.echarts-for-react',
          'canvas',
          'svg',
        ].join(',')));
        const effectiveBackground = (element: HTMLElement) => {
          let current: HTMLElement | null = element;
          while (current) {
            const style = window.getComputedStyle(current);
            const background = parseColor(style.backgroundColor);
            if (background && background.alpha >= 0.35) return background;
            current = current.parentElement;
          }
          return parseColor(window.getComputedStyle(document.body).backgroundColor) ?? {
            red: 255,
            green: 255,
            blue: 255,
            alpha: 1,
          };
        };
        const hasMeaningfulText = (element: HTMLElement) => {
          const text = directText(element) || (element.children.length === 0 ? element.innerText : '');
          return text.replace(/[｜|/\\()[\]{}:：,，.。·\-\s]/g, '').length >= 1;
        };
        const shouldScan = (element: HTMLElement) => {
          if (!isVisible(element) || isIgnored(element) || !hasMeaningfulText(element)) return false;
          if (element.closest('[aria-hidden="true"]')) return false;
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          const text = (directText(element) || element.innerText || '').trim();
          if (!text) return false;
          if (rect.height > 90 && element.children.length > 0) return false;
          if (Number.parseFloat(style.fontSize) < 10) return false;
          return true;
        };
        const selector = [
          'a',
          'button',
          'span',
          'strong',
          'label',
          'p',
          'small',
          'td',
          'th',
          '.ant-typography',
          '.ant-tag',
          '.ant-alert-message',
          '.ant-alert-description',
          '.ant-select-selection-item',
          '.ant-select-selection-placeholder',
          '.financial-number',
          '.status-chip__label',
          '.status-chip__value',
          '.app-shell__bottom-status-item',
        ].join(',');
        const root = document.querySelector<HTMLElement>('.app-shell');
        const failures = root
          ? Array.from(root.querySelectorAll<HTMLElement>(selector))
            .filter(shouldScan)
            .map((element) => {
              const style = window.getComputedStyle(element);
              const foreground = parseColor(style.color);
              const background = effectiveBackground(element);
              const ratio = foreground ? contrastRatio(foreground, background) : 0;
              const fontSize = Number.parseFloat(style.fontSize);
              const fontWeight = Number.parseInt(style.fontWeight, 10) || 400;
              const threshold = fontSize >= 18 || (fontSize >= 14 && fontWeight >= 700) ? 3 : 4.3;
              return {
                text: (directText(element) || element.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 80),
                tag: element.tagName.toLowerCase(),
                className: String(element.className || '').slice(0, 140),
                color: style.color,
                background: window.getComputedStyle(element).backgroundColor,
                inheritedBackground: `rgb(${background.red}, ${background.green}, ${background.blue})`,
                fontSize,
                fontWeight,
                ratio: Number(ratio.toFixed(2)),
                threshold,
              };
            })
            .filter((item) => item.ratio < item.threshold)
            .slice(0, 16)
          : [{ text: 'missing app-shell', tag: 'root', className: '', color: '', background: '', inheritedBackground: '', fontSize: 0, fontWeight: 0, ratio: 0, threshold: 4.3 }];

        return {
          theme: document.documentElement.dataset.theme,
          failures,
        };
      });

      expect(audit.theme, `${route.title} 未进入 ${theme} 主题`).toBe(theme);
      expect(audit.failures, `${theme} ${route.title} 存在文字/背景对比度不足`).toEqual([]);
    }
  }
});

test('六大模块排布节奏统一且关键业务块不回退浅色', async ({ page }) => {
  await page.setViewportSize({ width: 1512, height: 982 });

  for (const route of routes) {
    await gotoStable(page, route.url);
    await expect(page.getByRole('heading', { name: route.title })).toBeVisible();

    const metrics = await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>('.module-page');
      if (!root) {
        return {
          exists: false,
          rootDisplay: '',
          rootGap: 0,
          maxDirectGap: 999,
          minDirectGap: -999,
          visibleModuleBlocks: 0,
          lightKeyBlocks: [{ className: 'missing-root', background: 'none' }],
        };
      }

      const isVisible = (element: Element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 12
          && rect.height > 10
          && style.visibility !== 'hidden'
          && style.display !== 'none'
          && rect.bottom >= 0
          && rect.right >= 0
          && rect.top <= window.innerHeight
          && rect.left <= window.innerWidth;
      };
      const isLightBackground = (background: string) => {
        const match = background.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
        if (!match) return false;
        const [, red, green, blue, alpha = '1'] = match;
        return Number(alpha) > 0.35 && Number(red) > 235 && Number(green) > 235 && Number(blue) > 235;
      };
      const directChildren = Array.from(root.children).filter(isVisible);
      const sortedChildren = directChildren.sort((left, right) => left.getBoundingClientRect().top - right.getBoundingClientRect().top);
      const directGaps = sortedChildren.slice(1).map((child, index) => {
        const previous = sortedChildren[index].getBoundingClientRect();
        const current = child.getBoundingClientRect();
        return Math.round(current.top - previous.bottom);
      });
      const keyBlocks = Array.from(root.querySelectorAll<HTMLElement>([
        '.page-header-panel',
        '.command-panel',
        '.workbench-nav',
        '.section-card',
        '.workspace-panel',
        '.metric-card',
        '.data-table',
        '.data-source-cell',
        '.data-2026-plan-panel',
        '.data-flow-strip__card',
        '.data-sync-card',
        '.backtest-form-block',
        '.backtest-precheck-item',
        '.trading-guard-rail__item',
        '.order-ticket',
        '.system-ops-panel',
        '.system-workflow__step',
      ].join(','))).filter(isVisible);

      return {
        exists: true,
        rootDisplay: window.getComputedStyle(root).display,
        rootGap: Number.parseFloat(window.getComputedStyle(root).rowGap || '0'),
        maxDirectGap: directGaps.length ? Math.max(...directGaps) : 0,
        minDirectGap: directGaps.length ? Math.min(...directGaps) : 0,
        visibleModuleBlocks: keyBlocks.length,
        lightKeyBlocks: keyBlocks
          .map((element) => ({
            className: String(element.className || '').slice(0, 120),
            background: window.getComputedStyle(element).backgroundColor,
          }))
          .filter((entry) => isLightBackground(entry.background))
          .slice(0, 8),
      };
    });

    expect(metrics.exists, `${route.title} 缺少模块根节点`).toBeTruthy();
    expect(metrics.rootDisplay, `${route.title} 模块根节点不是纵向排布`).toBe('flex');
    expect(metrics.rootGap, `${route.title} 模块间距过大`).toBeLessThanOrEqual(12);
    expect(metrics.maxDirectGap, `${route.title} 直接模块之间出现过大空白`).toBeLessThanOrEqual(28);
    expect(metrics.minDirectGap, `${route.title} 直接模块发生明显重叠`).toBeGreaterThanOrEqual(-2);
    expect(metrics.visibleModuleBlocks, `${route.title} 可识别模块块数量异常`).toBeGreaterThanOrEqual(3);
    expect(metrics.lightKeyBlocks, `${route.title} 关键业务块仍有默认浅色背景`).toEqual([]);
  }
});

test('高信息密度页面遵守标题控制任务指标导航顺序', async ({ page }) => {
  await page.setViewportSize({ width: 1512, height: 982 });

  const priorityRoutes = [
    {
      url: '/data-center',
      title: '数据中心',
      order: [
        ['.page-header-panel', '页面标题'],
        ['.command-panel', '数据控制面板'],
        ['.data-center-overview .metric-card', '关键指标'],
        ['.data-provenance-alert', '数据新鲜度提示'],
        ['.workbench-nav', '流程导航'],
      ],
    },
    {
      url: '/backtest',
      title: '回测研究',
      order: [
        ['.page-header-panel', '页面标题'],
        ['.command-panel', '回测控制面板'],
        ['.workbench-nav', '流程导航'],
        ['.backtest-tabs', '回测内容'],
      ],
    },
    {
      url: '/trading',
      title: '交易执行',
      order: [
        ['.page-header-panel', '页面标题'],
        ['.command-panel', '交易控制面板'],
        ['.trading-guard-rail', '交易护栏'],
        ['.trading-overview .metric-card', '交易指标'],
        ['.workbench-nav', '流程导航'],
      ],
    },
  ] as const;

  for (const route of priorityRoutes) {
    await gotoStable(page, route.url);
    await expect(page.getByRole('heading', { name: route.title })).toBeVisible();

    const positions = await page.evaluate((items) => {
      return items.map(([selector, label]) => {
        const element = document.querySelector<HTMLElement>(selector);
        const rect = element?.getBoundingClientRect();
        return {
          selector,
          label,
          exists: Boolean(element),
          top: rect ? Math.round(rect.top) : -1,
          height: rect ? Math.round(rect.height) : 0,
        };
      });
    }, route.order);

    expect(positions.filter((item) => !item.exists), `${route.title} 缺少关键模块`).toEqual([]);
    for (let index = 1; index < positions.length; index += 1) {
      const previous = positions[index - 1];
      const current = positions[index];
      expect(
        current.top,
        `${route.title} 信息顺序错误：${current.label} 应位于 ${previous.label} 之后`,
      ).toBeGreaterThanOrEqual(previous.top + Math.min(previous.height, 12) - 1);
    }
  }
});

test('表格横向滚动条、分页栏和底部状态栏保持终端合同', async ({ page }) => {
  for (const route of routes) {
    await gotoStable(page, route.url);
    await expect(page.getByRole('heading', { name: route.title })).toBeVisible();

    const metrics = await page.evaluate(() => {
      const isVisible = (element: Element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 12
          && rect.height > 6
          && style.visibility !== 'hidden'
          && style.display !== 'none'
          && rect.bottom >= 0
          && rect.right >= 0
          && rect.top <= window.innerHeight
          && rect.left <= window.innerWidth;
      };

      const isLightBackground = (background: string) => {
        const match = background.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
        if (!match) return false;
        const [, red, green, blue, alpha = '1'] = match;
        return Number(alpha) > 0.35 && Number(red) > 235 && Number(green) > 235 && Number(blue) > 235;
      };
      const collectLightLeaks = (elements: Element[]) => elements
        .filter(isVisible)
        .map((element) => ({
          tag: element.tagName.toLowerCase(),
          className: String((element as HTMLElement).className || '').slice(0, 140),
          background: window.getComputedStyle(element).backgroundColor,
          text: (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80),
        }))
        .filter((item) => isLightBackground(item.background));
      const bottomStatus = document.querySelector<HTMLElement>('.app-shell__bottom-status');
      const bottomRect = bottomStatus?.getBoundingClientRect();
      const pagers = Array.from(document.querySelectorAll<HTMLElement>('.data-table__table .ant-pagination')).filter(isVisible);
      const pagerControls = pagers.flatMap((pager) => Array.from(pager.querySelectorAll<HTMLElement>(
        '.ant-pagination-item, .ant-pagination-prev, .ant-pagination-next, .ant-select-selector, .ant-pagination-options-quick-jumper input',
      )).filter(isVisible));
      const stickyTracks = Array.from(document.querySelectorAll<HTMLElement>('.data-table__table .ant-table-sticky-scroll, .ant-table-sticky-scroll')).filter(isVisible);
      const stickyBars = Array.from(document.querySelectorAll<HTMLElement>('.data-table__table .ant-table-sticky-scroll-bar, .ant-table-sticky-scroll-bar')).filter(isVisible);
      const bottomTop = bottomRect ? Math.round(bottomRect.top) : window.innerHeight;
      const pagerOverlap = pagers
        .map((pager) => ({
          className: String(pager.className || '').slice(0, 120),
          bottom: Math.round(pager.getBoundingClientRect().bottom),
        }))
        .filter((item) => item.bottom > bottomTop - 2);
      const allBottomChrome = [
        ...stickyTracks,
        ...stickyBars,
        ...pagers,
        ...pagerControls,
        ...(bottomStatus ? [bottomStatus] : []),
      ];

      return {
        pageOverflowX: Math.max(0, Math.round(document.documentElement.scrollWidth - document.documentElement.clientWidth)),
        leaks: collectLightLeaks(allBottomChrome).slice(0, 12),
        bottomStatus: {
          exists: Boolean(bottomStatus),
          height: Math.round(bottomRect?.height ?? 0),
          bottomGap: bottomRect ? Math.round(window.innerHeight - bottomRect.bottom) : 999,
          left: Math.round(bottomRect?.left ?? -1),
          width: Math.round(bottomRect?.width ?? 0),
          background: bottomStatus ? window.getComputedStyle(bottomStatus).backgroundColor : 'none',
        },
        pagerCount: pagers.length,
        pagerMaxHeight: pagers.reduce((max, pager) => Math.max(max, Math.round(pager.getBoundingClientRect().height)), 0),
        pagerMaxControlHeight: pagerControls.reduce((max, control) => Math.max(max, Math.round(control.getBoundingClientRect().height)), 0),
        pagerOverlap,
        stickyTrackCount: stickyTracks.length,
        stickyTrackMaxHeight: stickyTracks.reduce((max, track) => Math.max(max, Math.round(track.getBoundingClientRect().height)), 0),
        stickyBarCount: stickyBars.length,
        stickyBarMaxHeight: stickyBars.reduce((max, bar) => Math.max(max, Math.round(bar.getBoundingClientRect().height)), 0),
      };
    });

    expect(metrics.leaks, `${route.title} 表格横向滚动条、分页栏或底部状态栏出现浅色回退`).toEqual([]);
    expect(metrics.pageOverflowX, `${route.title} 页面级出现横向溢出`).toBeLessThanOrEqual(2);
    expect(metrics.bottomStatus.exists, `${route.title} 缺少底部状态栏`).toBeTruthy();
    expect(metrics.bottomStatus.height, `${route.title} 底部状态栏高度不统一`).toBeGreaterThanOrEqual(22);
    expect(metrics.bottomStatus.height, `${route.title} 底部状态栏高度过高`).toBeLessThanOrEqual(28);
    expect(metrics.bottomStatus.bottomGap, `${route.title} 底部状态栏没有贴住视口底部`).toBeLessThanOrEqual(1);
    expect(metrics.bottomStatus.left, `${route.title} 底部状态栏没有避开左侧导航`).toBeGreaterThanOrEqual(70);
    if (metrics.pagerCount > 0) {
      expect(metrics.pagerMaxHeight, `${route.title} 分页栏高度不符合紧凑终端规范`).toBeLessThanOrEqual(38);
      expect(metrics.pagerMaxControlHeight, `${route.title} 分页控件高度过大或回退为默认样式`).toBeLessThanOrEqual(30);
      expect(metrics.pagerOverlap, `${route.title} 分页栏被底部状态栏遮挡`).toEqual([]);
    }
    if (metrics.stickyTrackCount > 0) {
      expect(metrics.stickyTrackMaxHeight, `${route.title} 表格横向滚动轨道高度异常`).toBeGreaterThanOrEqual(8);
      expect(metrics.stickyTrackMaxHeight, `${route.title} 表格横向滚动轨道过高`).toBeLessThanOrEqual(12);
    }
    if (metrics.stickyBarCount > 0) {
      expect(metrics.stickyBarMaxHeight, `${route.title} 表格横向滚动滑块过高`).toBeLessThanOrEqual(10);
    }
  }
});

test('表格列语义区分买卖方向和右侧操作', async ({ page }) => {
  await page.setViewportSize({ width: 1512, height: 982 });

  for (const route of [
    { url: '/dashboard', title: '总览看板' },
    { url: '/trading', title: '交易执行' },
  ]) {
    await gotoStable(page, route.url);
    await expect(page.getByRole('heading', { name: route.title })).toBeVisible();

    const metrics = await page.evaluate(() => {
      const isVisible = (element: Element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 8
          && rect.height > 8
          && style.visibility !== 'hidden'
          && style.display !== 'none'
          && rect.bottom >= 0
          && rect.right >= 0
          && rect.top <= window.innerHeight
          && rect.left <= window.innerWidth;
      };
      const headers = Array.from(document.querySelectorAll<HTMLElement>('.data-table__table th')).filter(isVisible);
      const headerItems = headers.map((header) => ({
        text: (header.textContent || '').trim().replace(/\s+/g, ''),
        className: String(header.className || ''),
        width: Math.round(header.getBoundingClientRect().width),
      }));
      const sideHeaders = headerItems.filter((item) => item.text === '方向' || item.text === '动作');
      const actionHeaders = headerItems.filter((item) => item.text === '操作' || item.text === '详情' || item.text === '诊断');
      const rowHeights = Array.from(document.querySelectorAll<HTMLElement>('.data-table__table .ant-table-row'))
        .filter(isVisible)
        .map((row) => Math.round(row.getBoundingClientRect().height));
      return {
        sideHeaders,
        badSideHeaders: sideHeaders.filter((item) => !item.className.includes('data-table-col--side') || item.className.includes('data-table-col--action') || item.className.includes('ant-table-cell-fix-right')),
        actionHeaders,
        badActionHeaders: actionHeaders.filter((item) => !item.className.includes('data-table-col--action')),
        maxRowHeight: rowHeights.length ? Math.max(...rowHeights) : 0,
      };
    });

    expect(metrics.sideHeaders.length, `${route.title} 缺少买卖方向列，无法校验方向列语义`).toBeGreaterThan(0);
    expect(metrics.badSideHeaders, `${route.title} 买卖方向列被误判为右侧操作列`).toEqual([]);
    expect(metrics.badActionHeaders, `${route.title} 右侧操作/详情/诊断列未使用操作列语义`).toEqual([]);
    expect(metrics.maxRowHeight, `${route.title} 表格行高超出专业密度`).toBeLessThanOrEqual(36);
  }
});

test('表格列组和右侧检查器保持一体化工作台标准', async ({ page }) => {
  test.setTimeout(90000);

  const tableChecks = [
    { url: '/dashboard', title: '总览看板', testId: 'table-dashboard-signals-summary', minFamilies: 3 },
    { url: '/data-center', title: '数据中心', testId: 'table-data-freshness', minFamilies: 3 },
    { url: '/strategy-dev', title: '策略开发', testId: 'table-strategy-files', minFamilies: 3 },
    { url: '/backtest', title: '回测研究', testId: 'table-backtest-tasks', minFamilies: 3 },
    { url: '/trading', title: '交易执行', testId: 'table-trading-signals', minFamilies: 3 },
  ];

  for (const item of tableChecks) {
    await gotoStable(page, item.url, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: item.title })).toBeVisible({ timeout: 15000 });
    await expect(page.getByTestId(item.testId)).toBeVisible({ timeout: 15000 });
    await page.getByTestId(item.testId).scrollIntoViewIfNeeded();
    const metrics = await scanTableColumnFamilyContract(page, item.testId);
    expect(metrics.exists, `${item.title} 缺少表格 ${item.testId}`).toBeTruthy();
    expect(metrics.missingFamily, `${item.title} 表格列没有完整写入 data-column-kind / data-column-family`).toEqual([]);
    expect(metrics.unknownFamily, `${item.title} 表格列出现未知列组`).toEqual([]);
    expect(metrics.lightLeaks, `${item.title} 表格列组表头出现默认浅色背景`).toEqual([]);
    expect(metrics.numericMisalign, `${item.title} 数字列没有右对齐`).toEqual([]);
    expect(metrics.familyCount, `${item.title} 表格列组过少，信息结构不清晰`).toBeGreaterThanOrEqual(item.minFamilies);
  }

  await gotoStable(page, '/system', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: '系统管理' })).toBeVisible({ timeout: 15000 });
  await page.getByRole('tab', { name: '日志中心' }).click();
  await expect(page.getByTestId('table-system-logs')).toBeVisible({ timeout: 15000 });
  await page.getByTestId('table-system-logs').scrollIntoViewIfNeeded();
  const systemMetrics = await scanTableColumnFamilyContract(page, 'table-system-logs');
  expect(systemMetrics.missingFamily, '系统管理日志表列组缺失').toEqual([]);
  expect(systemMetrics.unknownFamily, '系统管理日志表列组未知').toEqual([]);
  expect(systemMetrics.lightLeaks, '系统管理日志表列组表头出现浅色泄漏').toEqual([]);

  await gotoStable(page, '/dashboard', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: '总览看板' })).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('dashboard-task-inspector')).toBeVisible({ timeout: 15000 });
  const inspectorMetrics = await page.evaluate(() => {
    const inspector = document.querySelector<HTMLElement>('[data-testid="dashboard-task-inspector"]');
    if (!inspector) {
      return {
        exists: false,
        width: 0,
        headerHeight: 0,
        fieldCount: 0,
        wideFieldCount: 0,
        actionHeight: 0,
        role: '',
        lightLeaks: [{ className: 'missing-inspector', background: 'none', text: '' }],
      };
    }
    const isVisible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 12
        && rect.height > 6
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.bottom >= 0
        && rect.right >= 0
        && rect.top <= window.innerHeight
        && rect.left <= window.innerWidth;
    };
    const isLightBackground = (background: string) => {
      const match = background.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (!match) return false;
      const [, red, green, blue, alpha = '1'] = match;
      return Number(alpha) > 0.35 && Number(red) > 235 && Number(green) > 235 && Number(blue) > 235;
    };
    const rect = inspector.getBoundingClientRect();
    const header = inspector.querySelector<HTMLElement>('.inspector-panel__header');
    const actions = inspector.querySelector<HTMLElement>('.inspector-panel__actions');
    const fields = Array.from(inspector.querySelectorAll<HTMLElement>('.inspector-panel__field'));
    const lightLeaks = [inspector, ...Array.from(inspector.querySelectorAll<HTMLElement>('*'))]
      .filter(isVisible)
      .map((element) => ({
        className: String(element.className || '').slice(0, 140),
        background: window.getComputedStyle(element).backgroundColor,
        text: (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80),
      }))
      .filter((entry) => isLightBackground(entry.background))
      .slice(0, 12);
    return {
      exists: true,
      width: Math.round(rect.width),
      headerHeight: Math.round(header?.getBoundingClientRect().height ?? 0),
      fieldCount: fields.length,
      wideFieldCount: fields.filter((field) => field.classList.contains('inspector-panel__field--wide')).length,
      actionHeight: Math.round(actions?.getBoundingClientRect().height ?? 0),
      role: inspector.getAttribute('data-workbench-role') || '',
      lightLeaks,
    };
  });
  expect(inspectorMetrics.exists, '首页任务队列检查器未渲染').toBeTruthy();
  expect(inspectorMetrics.role, '右侧检查器缺少工作台角色标记').toBe('inspector');
  expect(inspectorMetrics.width, '右侧检查器宽度过窄').toBeGreaterThanOrEqual(260);
  expect(inspectorMetrics.width, '右侧检查器宽度过宽').toBeLessThanOrEqual(460);
  expect(inspectorMetrics.headerHeight, '右侧检查器标题栏高度失控').toBeLessThanOrEqual(56);
  expect(inspectorMetrics.fieldCount, '右侧检查器缺少关键字段矩阵').toBeGreaterThanOrEqual(3);
  expect(inspectorMetrics.wideFieldCount, '右侧检查器缺少跨列关键字段').toBeGreaterThanOrEqual(1);
  expect(inspectorMetrics.actionHeight, '右侧检查器操作栏高度异常').toBeLessThanOrEqual(44);
  expect(inspectorMetrics.lightLeaks, '右侧检查器出现默认浅色背景泄漏').toEqual([]);
});

test('系统管理路径搜索框状态类不泄漏浅色边界', async ({ page }) => {
  await gotoStable(page, '/system');
  await expect(page.getByRole('heading', { name: '系统管理' })).toBeVisible();

  const metrics = await page.evaluate(() => {
    const parseColor = (value: string) => {
      const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (!match) return null;
      const [, red, green, blue, alpha = '1'] = match;
      return {
        red: Number(red),
        green: Number(green),
        blue: Number(blue),
        alpha: Number(alpha),
      };
    };
    const isLight = (value: string) => {
      const color = parseColor(value);
      return Boolean(color && color.alpha > 0.35 && color.red > 235 && color.green > 235 && color.blue > 235);
    };
    const search = Array.from(document.querySelectorAll<HTMLElement>('.system-page .ant-input-search'));
    const internals = search.flatMap((root) => Array.from(root.querySelectorAll<HTMLElement>('.ant-input-affix-wrapper, input.ant-input')));
    const internalLeak = internals
      .map((element) => {
        const style = window.getComputedStyle(element);
        const hasVisibleBorder = ['Top', 'Right', 'Bottom', 'Left'].some((side) => {
          const width = Number.parseFloat(style[`border${side}Width` as keyof CSSStyleDeclaration] as string);
          const borderStyle = style[`border${side}Style` as keyof CSSStyleDeclaration] as string;
          return width > 0 && borderStyle !== 'none';
        });
        return {
          className: String(element.className || ''),
          borderColor: style.borderColor,
          borderWidth: style.borderWidth,
          borderStyle: style.borderStyle,
          background: style.backgroundColor,
          hasVisibleBorder,
        };
      })
      .filter((item) => (item.hasVisibleBorder && isLight(item.borderColor)) || isLight(item.background));
    const visibleControlLeak = Array.from(document.querySelectorAll<HTMLElement>('.system-page input, .system-page .ant-input-affix-wrapper, .system-page .ant-input-search, .system-page .ant-select-selector, .system-page .ant-picker'))
      .map((element) => {
        const style = window.getComputedStyle(element);
        const hasVisibleBorder = ['Top', 'Right', 'Bottom', 'Left'].some((side) => {
          const width = Number.parseFloat(style[`border${side}Width` as keyof CSSStyleDeclaration] as string);
          const borderStyle = style[`border${side}Style` as keyof CSSStyleDeclaration] as string;
          return width > 0 && borderStyle !== 'none';
        });
        return {
          className: String(element.className || ''),
          borderColor: style.borderColor,
          background: style.backgroundColor,
          hasVisibleBorder,
        };
      })
      .filter((item) => isLight(item.background) || (item.hasVisibleBorder && isLight(item.borderColor)));
    return {
      searchCount: search.length,
      internalLeak,
      visibleControlLeak,
    };
  });

  expect(metrics.searchCount, '系统管理基础设置路径搜索框不存在').toBeGreaterThanOrEqual(4);
  expect(metrics.internalLeak, 'Input.Search 内部无边框层出现浅色状态色').toEqual([]);
  expect(metrics.visibleControlLeak, '系统管理可见输入控件出现浅色背景或浅色可见边框').toEqual([]);
});

test('错误详情弹窗长文本和操作按钮保持标准终端尺寸', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    const inject = () => {
      const style = document.createElement('style');
      style.setAttribute('data-testid', 'disable-motion-for-modal-metrics');
      style.textContent = `
        *, *::before, *::after {
          transition-duration: 0s !important;
          animation-duration: 0s !important;
          animation-delay: 0s !important;
        }
      `;
      document.head.appendChild(style);
    };
    if (document.head) {
      inject();
    } else {
      document.addEventListener('DOMContentLoaded', inject, { once: true });
    }
  });

  const longDetail = [
    'RequestError: 数据中心同步失败，真实 QMT 返回异常。',
    'trace=visual-error-modal-20260519',
    'path=C:/LocalQuantConsole/data/local_quant_console.db',
    ...Array.from({ length: 80 }, (_, index) => `technical_line_${index + 1}=xtquant timeout / sqlite cursor / task retry evidence / ${'payload'.repeat(8)}`),
  ].join('\n');

  await page.route('**/api/dashboard/bundle', async (route) => {
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({
        success: false,
        message: '加载总览看板失败：真实 QMT 只读数据暂不可用，请查看技术详情。',
        data: null,
        error: {
          code: 'VISUAL_ERROR_MODAL',
          detail: longDetail,
          suggestion: '请先确认后端服务、SQLite 路径和真实 QMT 只读连接状态，再点击刷新重试。',
        },
        trace_id: 'visual-error-modal-20260519',
      }),
    });
  });

  await gotoStable(page, '/dashboard');
  await expect(page.getByRole('heading', { name: '总览看板' })).toBeVisible();
  await page.waitForFunction(() => {
    const content = Array.from(document.querySelectorAll<HTMLElement>('.ant-modal-content'))
      .find((element) => element.textContent?.includes('technical_line_80'));
    return Boolean(content && content.getBoundingClientRect().width >= 680);
  });
  const errorDialog = page.locator('.ant-modal-content').filter({ hasText: 'technical_line_80' }).first();
  await expect(errorDialog).toBeVisible();
  await expect(errorDialog.getByText('错误详情')).toBeVisible();
  await expect(errorDialog.locator('.error-panel__technical')).toContainText('technical_line_80');

  const modalMetrics = await page.evaluate(() => {
    const isVisible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 12
        && rect.height > 6
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.bottom >= 0
        && rect.right >= 0
        && rect.top <= window.innerHeight
        && rect.left <= window.innerWidth;
    };
    const modalContentCandidates = Array.from(document.querySelectorAll<HTMLElement>('.ant-modal-content'))
      .filter((element) => isVisible(element) && element.textContent?.includes('technical_line_80'))
      .sort((left, right) => {
        const leftRect = left.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();
        return rightRect.width - leftRect.width;
      });
    const modalContent = modalContentCandidates[0] ?? null;
    const modal = modalContent?.closest<HTMLElement>('.ant-modal') ?? null;
    if (!modal || !isVisible(modal)) {
      return {
        modalWidth: 0,
        bodyHeight: 0,
        technicalHeight: 0,
        technicalScrollHeight: 0,
        buttonHeights: [],
        buttonWidths: [],
        leaks: [{ className: 'missing-visible-modal', text: '' }],
      };
    }
    const body = modalContent?.querySelector<HTMLElement>('.ant-modal-body') ?? null;
    const technical = modal?.querySelector<HTMLElement>('.error-panel__technical') ?? null;
    const buttons = modal ? Array.from(modal.querySelectorAll<HTMLElement>('.error-panel__actions .ant-btn')) : [];
    const leakRoot = modalContent ?? modal;
    const leakTargets = leakRoot ? [leakRoot, ...Array.from(leakRoot.querySelectorAll<HTMLElement>('*'))] : [];
    const leaks = leakTargets
      .filter((element) => {
        const style = window.getComputedStyle(element);
        if (!isVisible(element)) return false;
        const match = style.backgroundColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
        if (!match) return false;
        const [, red, green, blue, alpha = '1'] = match;
        return Number(alpha) > 0.35 && Number(red) > 235 && Number(green) > 235 && Number(blue) > 235;
      })
      .map((element) => ({
        className: String(element.className || '').slice(0, 120),
        text: (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80),
      }));
    const widthCandidates = [modal, modalContent]
      .filter(Boolean)
      .map((node) => Math.round(node!.getBoundingClientRect().width));
    return {
      modalWidth: Math.max(0, ...widthCandidates),
      viewportWidth: window.innerWidth,
      visualViewportWidth: Math.round(window.visualViewport?.width ?? 0),
      modalLargeWidth: window.getComputedStyle(document.documentElement).getPropertyValue('--lqc-modal-large-width').trim(),
      bodyHeight: Math.round(body?.getBoundingClientRect().height ?? 0),
      technicalHeight: Math.round(technical?.getBoundingClientRect().height ?? 0),
      technicalScrollHeight: technical?.scrollHeight ?? 0,
      buttonHeights: buttons.map((button) => Math.round(button.getBoundingClientRect().height)),
      buttonWidths: buttons.map((button) => Math.round(button.getBoundingClientRect().width)),
      debugWidths: modalContentCandidates.slice(0, 5).map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          className: String(element.className || '').slice(0, 80),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          text: (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40),
        };
      }),
      leaks,
    };
  });

  expect(
    modalMetrics.modalWidth,
    JSON.stringify({
      widths: modalMetrics.debugWidths,
      viewportWidth: modalMetrics.viewportWidth,
      visualViewportWidth: modalMetrics.visualViewportWidth,
      modalLargeWidth: modalMetrics.modalLargeWidth,
    }),
  ).toBeGreaterThanOrEqual(680);
  expect(modalMetrics.modalWidth).toBeLessThanOrEqual(740);
  expect(modalMetrics.bodyHeight).toBeLessThanOrEqual(580);
  expect(modalMetrics.technicalHeight).toBeLessThanOrEqual(260);
  expect(modalMetrics.technicalScrollHeight).toBeGreaterThan(modalMetrics.technicalHeight);
  expect(modalMetrics.buttonHeights.every((height) => height >= 26 && height <= 30)).toBeTruthy();
  expect(modalMetrics.buttonWidths.every((width) => width >= 92)).toBeTruthy();
  expect(modalMetrics.leaks, '错误详情弹窗存在默认浅色背景泄漏').toEqual([]);
  expect(await scanActionableBlockers(page, '.ant-modal:has(.error-panel__technical)'), '错误详情弹窗存在可操作元素遮挡').toEqual([]);
});

test('系统管理低频表格分页和任务进度保持终端暗色密度', async ({ page }) => {
  test.setTimeout(60_000);

  await gotoStable(page, '/system');
  await expect(page.getByRole('heading', { name: '系统管理' })).toBeVisible();

  const tableTabs = [
    { tab: '环境检测', testId: 'table-env-results' },
    { tab: '日志中心', testId: 'table-system-logs' },
    { tab: '运行监控', testId: 'table-startup-check' },
    { tab: '备份恢复', testId: 'table-backups' },
    { tab: '操作记录', testId: 'table-operations' },
  ];

  for (const item of tableTabs) {
    await page.getByRole('tab', { name: item.tab }).click();
    await expect(page.getByTestId(item.testId)).toBeVisible();

    const leaks = await page.evaluate((testId) => {
      const root = document.querySelector(`[data-testid="${testId}"]`);
      if (!root) {
        return [{ className: 'missing-table', background: 'none', text: testId }];
      }
      const isVisible = (element: Element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 12
          && rect.height > 6
          && style.visibility !== 'hidden'
          && style.display !== 'none'
          && rect.bottom >= 0
          && rect.right >= 0
          && rect.top <= window.innerHeight
          && rect.left <= window.innerWidth;
      };
      const isLightBackground = (background: string) => {
        const match = background.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
        if (!match) return false;
        const [, red, green, blue, alpha = '1'] = match;
        return Number(alpha) > 0.35 && Number(red) > 235 && Number(green) > 235 && Number(blue) > 235;
      };
      return Array.from(root.querySelectorAll('*'))
        .filter(isVisible)
        .map((element) => ({
          className: String((element as HTMLElement).className || '').slice(0, 140),
          background: window.getComputedStyle(element).backgroundColor,
          text: (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100),
        }))
        .filter((entry) => isLightBackground(entry.background))
        .slice(0, 12);
    }, item.testId);
    const columnContractIssues = await page.evaluate((testId) => {
      const root = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
      if (!root) {
        return [{ text: testId, width: 0, className: 'missing-table', reason: '表格未渲染，无法检查列宽契约' }];
      }
      const isVisible = (element: Element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 12
          && rect.height > 6
          && style.visibility !== 'hidden'
          && style.display !== 'none'
          && rect.bottom >= 0
          && rect.right >= 0
          && rect.top <= window.innerHeight
          && rect.left <= window.innerWidth;
      };
      const longTextHeaders = new Set(['说明', '建议', '修复建议', '中文信息', '备份路径']);
      const compactHeaders = new Set(['状态', '结果', '等级', '类型']);
      return Array.from(root.querySelectorAll<HTMLElement>('th'))
        .filter(isVisible)
        .flatMap((header) => {
          const text = (header.textContent || '').trim().replace(/\s+/g, '');
          const className = String(header.className || '');
          const width = Math.round(header.getBoundingClientRect().width);
          const isRightFixed = className.includes('ant-table-cell-fix-right');
          const issues: Array<{ text: string; width: number; className: string; reason: string }> = [];
          if (longTextHeaders.has(text) && width < 260) {
            issues.push({ text, width, className, reason: '长文本列宽不足，容易截断中文说明或排障建议' });
          }
          if (compactHeaders.has(text) && width > 140) {
            issues.push({ text, width, className, reason: '短状态列过宽，挤占系统审计信息区' });
          }
          if ((text === '详情' || text === '诊断' || (text === '操作' && isRightFixed)) && !className.includes('data-table-col--action')) {
            issues.push({ text, width, className, reason: '右侧按钮列缺少统一操作列语义' });
          }
          if (text === '操作' && !isRightFixed && width > 130) {
            issues.push({ text, width, className, reason: '业务操作字段不应占用右侧按钮列宽' });
          }
          return issues;
        });
    }, item.testId);

    expect(leaks, `${item.tab} 表格/分页出现默认浅色背景泄漏`).toEqual([]);
    expect(columnContractIssues, `${item.tab} 表格列宽或操作列语义未收口`).toEqual([]);
  }

  await gotoStable(page, '/system?tab=操作记录');
  await expect(page.getByRole('heading', { name: '系统管理' })).toBeVisible();
  const operationDetailButtons = page.getByRole('button', { name: '查看操作记录详情' });
  const operationDetailButtonCount = await operationDetailButtons.count();
  if (operationDetailButtonCount > 0) {
    await operationDetailButtons.first().click();
    await expect(page.getByTestId('detail-drawer')).toBeVisible();

    const drawerLeaks = await page.evaluate(() => {
      const drawer = document.querySelector('.detail-drawer');
      if (!drawer) {
        return [{ className: 'missing-drawer', background: 'none', text: '' }];
      }
      const isVisible = (element: Element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 12
          && rect.height > 6
          && style.visibility !== 'hidden'
          && style.display !== 'none'
          && rect.bottom >= 0
          && rect.right >= 0
          && rect.top <= window.innerHeight
          && rect.left <= window.innerWidth;
      };
      const isLightBackground = (background: string) => {
        const match = background.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
        if (!match) return false;
        const [, red, green, blue, alpha = '1'] = match;
        return Number(alpha) > 0.35 && Number(red) > 235 && Number(green) > 235 && Number(blue) > 235;
      };
      return Array.from(drawer.querySelectorAll('*'))
        .filter(isVisible)
        .map((element) => ({
          className: String((element as HTMLElement).className || '').slice(0, 140),
          background: window.getComputedStyle(element).backgroundColor,
          text: (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100),
        }))
        .filter((entry) => isLightBackground(entry.background))
        .slice(0, 12);
    });

    expect(drawerLeaks, '系统管理操作记录详情抽屉出现默认浅色背景泄漏').toEqual([]);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('detail-drawer')).toBeHidden();
  }

  const operationResultSelect = page.getByRole('combobox', { name: '操作结果' });
  const operationResultSelectCount = await operationResultSelect.count();
  if (operationResultSelectCount === 1) {
    await operationResultSelect.click();
    await expect(page.locator('.ant-select-dropdown')).toBeVisible();

    const selectLeaks = await page.evaluate(() => {
      const dropdown = document.querySelector('.ant-select-dropdown');
      if (!dropdown) {
        return [{ className: 'missing-select-dropdown', background: 'none', text: '' }];
      }
      const isVisible = (element: Element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 12
          && rect.height > 6
          && style.visibility !== 'hidden'
          && style.display !== 'none'
          && rect.bottom >= 0
          && rect.right >= 0
          && rect.top <= window.innerHeight
          && rect.left <= window.innerWidth;
      };
      const isLightBackground = (background: string) => {
        const match = background.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
        if (!match) return false;
        const [, red, green, blue, alpha = '1'] = match;
        return Number(alpha) > 0.35 && Number(red) > 235 && Number(green) > 235 && Number(blue) > 235;
      };
      return Array.from(dropdown.querySelectorAll('*'))
        .filter(isVisible)
        .map((element) => ({
          className: String((element as HTMLElement).className || '').slice(0, 140),
          background: window.getComputedStyle(element).backgroundColor,
          text: (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100),
        }))
        .filter((entry) => isLightBackground(entry.background))
        .slice(0, 12);
    });

    expect(selectLeaks, '系统管理筛选下拉层出现默认浅色背景泄漏').toEqual([]);
    await page.keyboard.press('Escape');
  }

  await page.route('**/api/data/sources/qmt/status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取 QMT 状态成功',
        data: {
          mode: 'real',
          connected: true,
          account_id: 'demo_account',
          status_text: '真实 QMT 只读',
          simulation_mode: false,
          last_check_time: '2026-05-19 15:00:00',
        },
        error: null,
        trace_id: 'visual-data-qmt',
      }),
    });
  });
  await page.route('**/api/data/account/latest', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取账户资金成功',
        data: {
          id: 1,
          account_id: 'demo_account',
          total_asset: 5381.5,
          available_cash: 0,
          frozen_cash: 0,
          market_value: 5381.5,
          today_pnl: 0,
          snapshot_time: '2026-05-19 15:00:00',
        },
        error: null,
        trace_id: 'visual-data-account',
      }),
    });
  });
  await page.route('**/api/data/freshness/summary', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取新鲜度摘要成功',
        data: {
          target_trade_date: '2026-05-19',
          generated_at: '2026-05-19 10:00:00',
          overall_status: 'ok',
          stale_count: 0,
          warning_count: 0,
          next_actions: ['视觉回归测试使用隔离数据。'],
          items: [],
        },
        error: null,
        trace_id: 'visual-freshness-summary',
      }),
    });
  });
  await page.route('**/api/data/catalog/official', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取官方目录成功',
        data: {
          items: [
            { data_type: 'account_snapshot', name: '账户资产', category: '账户数据', official_api: 'query_stock_asset(account)', local_table: 'account_snapshot', status: 'available', requires_backtest: false, priority: 'P0', sync_frequency: '盘前、盘中、盘后', boundary_note: '普通股票账户可用' },
            { data_type: 'daily_kline', name: '日 K 数据', category: '行情数据', official_api: 'download_history_data2', local_table: 'daily_kline', status: 'available', requires_backtest: true, priority: 'P0', sync_frequency: '盘后', boundary_note: 'Level1 行情' },
          ],
          summary: { total: 2, available: 2, backtest_required: 1, unsupported: 0 },
          unsupported_items: [],
        },
        error: null,
        trace_id: 'visual-official-catalog',
      }),
    });
  });
  await page.route('**/api/data/sync/coverage-2026**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取覆盖率成功',
        data: pageResult([{
          id: 1,
          data_type: 'daily_kline',
          frequency: '1d',
          start_date: '2026-01-01',
          end_date: '2026-05-19',
          total_symbols: 5000,
          complete_symbols: 5000,
          coverage_ratio: 100,
          status: 'complete',
          checked_at: '2026-05-19 10:00:00',
        }]),
        error: null,
        trace_id: 'visual-coverage-2026',
      }),
    });
  });
  await page.route('**/api/data/quality/summary', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取质量摘要成功',
        data: {
          success_count: 8,
          warning_count: 0,
          failed_count: 0,
          latest_check_time: '2026-05-19 15:00:00',
          is_stale: false,
          stale_reason: null,
        },
        error: null,
        trace_id: 'visual-data-quality',
      }),
    });
  });
  await page.route('**/api/data/freshness/summary', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取数据新鲜度成功',
        data: {
          target_trade_date: '2026-05-19',
          generated_at: '2026-05-19 15:00:00',
          overall_status: 'ok',
          stale_count: 0,
          warning_count: 0,
          next_actions: ['关键数据已到目标日。'],
          items: [],
        },
        error: null,
        trace_id: 'visual-data-freshness',
      }),
    });
  });
  await page.route('**/api/data/catalog/official', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取官方数据目录成功',
        data: {
          source: 'qmt',
          account_type: 'normal_stock',
          account_type_label: '普通股票账户',
          has_l2: false,
          has_credit: false,
          limitation_note: '视觉回归夹具：普通股票账户只读数据边界。',
          unsupported_items: [],
          items: [],
        },
        error: null,
        trace_id: 'visual-data-catalog',
      }),
    });
  });
  await page.route('**/api/data/sync/coverage-2026**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取覆盖率成功',
        data: { items: [], page: 1, page_size: 50, total: 0, has_more: false },
        error: null,
        trace_id: 'visual-data-coverage',
      }),
    });
  });
  await page.route('**/api/data/sync/tasks**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取同步任务成功',
        data: {
          items: [{
            task_id: 'visual_running_task',
            sync_type: 'sync_latest_data',
            status: 'running',
            total_count: 5000,
            success_count: 1200,
            failed_count: 0,
            progress: 24,
            message: '视觉回归任务进度样例',
            technical_detail: JSON.stringify({ stage: '同步落库', processed: 1200, total: 5000, current_symbol: '600000.SH' }),
            task_type: 'sync_latest_data',
            created_at: '2026-05-19 15:00:00',
            started_at: '2026-05-19 15:00:00',
            updated_at: '2026-05-19 15:01:00',
            finished_at: null,
          }],
          page: 1,
          page_size: 5,
          total: 1,
          has_more: false,
        },
        error: null,
        trace_id: 'visual-running-task',
      }),
    });
  });
  await page.route('**/api/tasks/**', async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.endsWith('/visual_running_task')) {
      await route.fallback();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取任务成功',
        data: {
          task_id: 'visual_running_task',
          task_type: 'sync_latest_data',
          status: 'running',
          progress: 24,
          message: '视觉回归任务进度样例',
          technical_detail: JSON.stringify({ stage: '同步落库', processed: 1200, total: 5000, current_symbol: '600000.SH' }),
          created_at: '2026-05-19 15:00:00',
          started_at: '2026-05-19 15:00:00',
          finished_at: null,
        },
        error: null,
        trace_id: 'visual-running-task-detail',
      }),
    });
  });
  const syncTasksResponse = page.waitForResponse((response) =>
    response.url().includes('/api/data/sync/tasks') && response.status() === 200,
  );
  await gotoStable(page, '/data-center?tab=数据同步', { waitUntil: 'domcontentloaded' });
  await syncTasksResponse;
  await expect(page.getByRole('heading', { name: '数据中心' })).toBeVisible();
  await expect(page.getByRole('tab', { name: '数据同步' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.data-sync-current-task')).toBeVisible();
  await expect(page.locator('.data-sync-current-task')).toContainText('visual_running_task', { timeout: 15_000 });

  const taskLeaks = await page.evaluate(() => {
    const root = document.querySelector('.data-sync-current-task');
    if (!root) {
      return [{ className: 'missing-task-progress', background: 'none', text: '' }];
    }
    const isVisible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 12
        && rect.height > 6
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.bottom >= 0
        && rect.right >= 0
        && rect.top <= window.innerHeight
        && rect.left <= window.innerWidth;
    };
    const isLightBackground = (background: string) => {
      const match = background.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (!match) return false;
      const [, red, green, blue, alpha = '1'] = match;
      return Number(alpha) > 0.35 && Number(red) > 235 && Number(green) > 235 && Number(blue) > 235;
    };
    return Array.from(root.querySelectorAll('*'))
      .filter(isVisible)
      .map((element) => ({
        className: String((element as HTMLElement).className || '').slice(0, 140),
        background: window.getComputedStyle(element).backgroundColor,
        text: (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100),
      }))
      .filter((entry) => isLightBackground(entry.background))
      .slice(0, 12);
  });

  expect(taskLeaks, '任务进度卡出现默认浅色背景泄漏').toEqual([]);
});

test('系统管理备份恢复弹窗、详情抽屉和危险菜单保持终端标准', async ({ page }) => {
  const pageResult = <T,>(items: T[]) => ({
    items,
    page: 1,
    page_size: 20,
    total: items.length,
    has_more: false,
  });
  const backupRecord = {
    id: 1001,
    backup_name: 'visual_backup_20260519_201500.zip',
    backup_path: 'C:/LocalQuantConsole/backups/visual_backup_20260519_201500.zip',
    backup_size: 128 * 1024 * 1024,
    status: 'success',
    created_at: '2026-05-19 20:15:00',
  };

  await page.route('**/api/system/**', async (route) => {
    const url = new URL(route.request().url());
    let data: unknown = null;

    if (url.pathname === '/api/system/config') {
      data = {
        qmt_path: 'D:/MiniQMT/demo',
        account_id: 'demo_account',
        database_path: 'C:/LocalQuantConsole/data/local_quant_console.db',
        strategy_dir: 'C:/LocalQuantConsole/strategies/user',
        backup_dir: 'C:/LocalQuantConsole/backups',
        auto_connect: true,
        auto_sync: true,
        default_order_amount: 10000,
        max_order_amount: 100000,
        order_confirm_required: true,
        default_order_type: 'LIMIT',
        price_offset: 0,
        simulation_mode: false,
        strategy_timeout_seconds: 120,
        strategy_run_interval_seconds: 60,
        intraday_auto_run: false,
        strategy_log_level: 'INFO',
        strategy_max_log_mb: 50,
        log_retention_days: 30,
        task_retention_days: 30,
      };
    } else if (url.pathname === '/api/system/env/results') {
      data = [{
        id: 1,
        task_id: 'task_visual_env',
        check_item: 'xtquant_import',
        status: 'success',
        message: 'xtquant 可导入。',
        suggestion: null,
        technical_detail: 'visual env detail',
        created_at: '2026-05-19 20:10:00',
      }];
    } else if (url.pathname === '/api/system/logs') {
      data = pageResult([{
        id: 1,
        module: 'system',
        level: 'info',
        message: '视觉回归系统日志。',
        technical_detail: 'visual system log detail',
        related_id: 'visual_backup_20260519',
        created_at: '2026-05-19 20:11:00',
      }]);
    } else if (url.pathname === '/api/system/monitor') {
      data = {
        running_task_count: 0,
        failed_task_count: 0,
        historical_failed_task_count: 0,
        database_size_bytes: 1024 * 1024 * 512,
        log_size_bytes: 1024 * 1024 * 8,
        backup_count: 1,
        recent_errors: [],
        slow_tasks: [],
      };
    } else if (url.pathname === '/api/system/startup-check') {
      data = {
        app_name: 'Local Quant Console',
        version: 'visual-regression',
        checked_at: '2026-05-19 20:12:00',
        overall_status: 'success',
        items: [
          { check_item: 'database', status: 'success', message: 'SQLite 可访问。', suggestion: null, technical_detail: 'wal enabled' },
          { check_item: 'directories', status: 'success', message: '目录权限正常。', suggestion: null, technical_detail: 'strategy_dir protected' },
        ],
      };
    } else if (url.pathname === '/api/system/backups') {
      data = pageResult([backupRecord]);
    } else if (url.pathname === '/api/system/operations') {
      data = pageResult([{
        id: 1,
        module: 'system',
        action: 'backup_restore_audit',
        target_type: 'backup',
        target_id: String(backupRecord.id),
        result: '成功',
        message: '备份恢复护栏验证记录。',
        technical_detail: 'restore_requires_snapshot_before_restore=true',
        created_at: '2026-05-19 20:13:00',
      }]);
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, message: '系统管理视觉回归数据', data, error: null, trace_id: 'visual-system-backup' }),
    });
  });

  await gotoStable(page, '/system?tab=备份恢复');
  await expect(page.getByRole('heading', { name: '系统管理' })).toBeVisible();
  await expect(page.getByTestId('table-backups')).toBeVisible();
  await expect(page.getByTestId('table-backups').getByText(backupRecord.backup_name, { exact: true })).toBeVisible();

  const backupDrawerButton = page.getByRole('button', { name: '查看备份详情' });
  expect(await backupDrawerButton.count()).toBeGreaterThan(0);
  await backupDrawerButton.first().click();
  await expect(page.getByTestId('detail-drawer')).toBeVisible();
  expect(await scanVisibleLightLeaks(page, '.detail-drawer')).toEqual([]);
  expect(await scanActionableBlockers(page, '[data-testid="detail-drawer"]'), '备份详情抽屉存在可操作元素遮挡').toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('detail-drawer')).toBeHidden();

  const moreButtons = page.getByRole('button', { name: '更多' });
  expect(await moreButtons.count()).toBeGreaterThan(0);
  await moreButtons.first().click();
  await expect(page.locator('.ant-dropdown')).toBeVisible();
  expect(await scanVisibleLightLeaks(page, '.ant-dropdown')).toEqual([]);

  await page.getByText('恢复备份', { exact: true }).click();
  await expect(page.locator('.system-confirm-modal')).toBeVisible();
  await expect(page.getByTestId('risk-confirm-content')).toBeVisible();
  await expect(page.locator('.system-confirm-modal')).toContainText('不会覆盖 strategies/user');
  await page.waitForTimeout(300);
  const restoreModalMetrics = await scanModalMetrics(page, '.system-confirm-modal');
  expect(restoreModalMetrics.exists).toBeTruthy();
  expect(restoreModalMetrics.width, '备份恢复弹窗宽度未标准化').toBeGreaterThanOrEqual(640);
  expect(restoreModalMetrics.width, '备份恢复弹窗宽度过大').toBeLessThanOrEqual(760);
  expect(restoreModalMetrics.bodyHeight, '备份恢复弹窗内容高度异常').toBeLessThanOrEqual(620);
  expect(restoreModalMetrics.maxSectionHeight, '备份恢复弹窗信息块留白异常').toBeLessThanOrEqual(260);
  expect(restoreModalMetrics.sectionHeightSpread, '备份恢复弹窗信息块高度差异过大').toBeLessThanOrEqual(180);
  expect(restoreModalMetrics.labelWidths.every((width) => width >= 104 && width <= 124), '备份恢复弹窗关键参数标签宽度不统一').toBeTruthy();
  expect(restoreModalMetrics.contentMinWidth, '备份恢复弹窗关键参数内容列过窄').toBeGreaterThanOrEqual(420);
  expect(restoreModalMetrics.buttonHeights.every((height) => height >= 26 && height <= 30)).toBeTruthy();
  expect(restoreModalMetrics.leaks, '备份恢复弹窗存在默认浅色背景泄漏').toEqual([]);
  expect(await scanActionableBlockers(page, '.system-confirm-modal'), '备份恢复弹窗存在可操作元素遮挡').toEqual([]);
  await page.screenshot({ path: '../docs/reports/screenshots/qa_system_restore_confirm_modal_fixture_20260519.png', fullPage: false });
  await page.locator('.system-confirm-modal').getByRole('button', { name: /取\s*消|取消/ }).click();
  await expect(page.locator('.system-confirm-modal')).toBeHidden();

  await moreButtons.first().click();
  await expect(page.locator('.ant-dropdown')).toBeVisible();
  await page.getByText('删除备份', { exact: true }).click();
  await expect(page.locator('.system-confirm-modal')).toBeVisible();
  await page.waitForTimeout(300);
  const deleteModalMetrics = await scanModalMetrics(page, '.system-confirm-modal');
  expect(deleteModalMetrics.exists).toBeTruthy();
  expect(deleteModalMetrics.width, '删除备份弹窗宽度未标准化').toBeGreaterThanOrEqual(640);
  expect(deleteModalMetrics.width, '删除备份弹窗宽度过大').toBeLessThanOrEqual(760);
  expect(deleteModalMetrics.leaks, '删除备份弹窗存在默认浅色背景泄漏').toEqual([]);
  expect(await scanActionableBlockers(page, '.system-confirm-modal'), '删除备份弹窗存在可操作元素遮挡').toEqual([]);
  await page.locator('.system-confirm-modal').getByRole('button', { name: /取\s*消|取消/ }).click();
  await expect(page.locator('.system-confirm-modal')).toBeHidden();
});

test('回测报告工作台图表、底部明细和表格分页保持终端标准', async ({ page }) => {
  await page.setViewportSize({ width: 1512, height: 982 });

  const task = {
    id: 9001,
    task_id: 'visual_backtest_task',
    strategy_id: 1,
    strategy_name: '视觉回归分钟策略',
    backtest_name: '视觉回归分钟回测',
    start_date: '2026-05-04',
    end_date: '2026-05-08',
    initial_cash: 1000000,
    single_order_amount: 10000,
    data_frequency: '分钟K',
    fill_mode: '正式分钟回放',
    fee_rate: 0.0003,
    stamp_tax_rate: 0.001,
    slippage: 0,
    status: 'success',
    created_at: '2026-05-19 15:30:00',
  };
  const result = {
    id: 1,
    backtest_id: 9001,
    total_return: 8.24,
    annual_return: 22.18,
    max_drawdown: -3.46,
    win_rate: 62.5,
    trade_count: 4,
    buy_count: 2,
    sell_count: 2,
    profit_loss_ratio: 1.82,
    average_holding_days: 2.5,
    ending_cash: 1048200,
    open_position_count: 0,
    open_market_value: 0,
    total_fee: 82.2,
    realized_pnl: 48200,
    final_cash: 1048200,
    created_at: '2026-05-19 15:34:00',
  };
  const manifest = {
    id: 1,
    backtest_id: 9001,
    strategy_file_name: 'visual_minute_strategy.py',
    strategy_code_hash: 'abcdef1234567890abcdef1234567890',
    strategy_name: '视觉回归分钟策略',
    strategy_version: '1.0.0',
    data_frequency: '分钟K',
    fill_mode: '正式分钟回放',
    qmt_mode: 'real_qmt_data',
    qmt_path: 'D:/QMT',
    account_id: 'demo_account',
    data_coverage_snapshot: JSON.stringify([
      { data_type: 'daily_kline', status: 'complete', coverage_rate: 100, start_date: '2026-05-04', end_date: '2026-05-08', matched_by: 'covering_range' },
      { data_type: 'minute_kline', status: 'complete', coverage_rate: 100, start_date: '2026-05-04', end_date: '2026-05-08', matched_by: 'covering_range' },
    ]),
    universe_summary: JSON.stringify({
      symbols_total: 320,
      daily_bar_count: 12000,
      minute_bar_count: 980000,
      minute_scanned_trade_days: 5,
      minute_symbols_scanned: 320,
      minute_symbols_with_rows: 318,
      minute_trigger_count: 18,
      minute_return_limit: 6000,
      minute_possible_truncation: false,
      signal_count: 4,
      matched_signal_count: 4,
      skipped_signal_count: 0,
      trade_count: 4,
    }),
    rule_snapshot: JSON.stringify({
      t_plus_1: true,
      lot_size: 100,
      strategy_max_signals: 6000,
      minute_market_cap_basis: 'previous_visible_daily_bar',
    }),
    engine_version: 'visual-regression',
    trust_level: 'trusted',
    trust_message: '视觉回归报告使用隔离数据验证展示，不改变回测业务逻辑。',
    created_at: '2026-05-19 15:34:00',
  };
  const strategySnapshotCheck = {
    status: 'matched',
    message: '已找到与本次回测策略代码哈希一致的策略运行记录。',
    manifest_hash: manifest.strategy_code_hash,
    latest_code_hash: manifest.strategy_code_hash,
    matched_run_id: 'run_visual_minute_strategy',
    matched_task_id: 'task_visual_minute_strategy',
    matched_run_status: 'success',
    matched_started_at: '2026-05-19 15:28:00',
    matched_finished_at: '2026-05-19 15:28:08',
    latest_run_id: 'run_visual_minute_strategy',
    latest_task_id: 'task_visual_minute_strategy',
    latest_run_status: 'success',
    latest_started_at: '2026-05-19 15:28:00',
    latest_finished_at: '2026-05-19 15:28:08',
    latest_strategy_file_name: manifest.strategy_file_name,
    latest_strategy_version: manifest.strategy_version,
    technical_detail: '{"strategy_id":1}',
  };
  const equity = [
    { id: 1, backtest_id: 9001, trade_date: '2026-05-04', equity: 1000000, cash: 1000000, market_value: 0, drawdown: 0 },
    { id: 2, backtest_id: 9001, trade_date: '2026-05-05', equity: 1018800, cash: 908800, market_value: 110000, drawdown: 0 },
    { id: 3, backtest_id: 9001, trade_date: '2026-05-06', equity: 1006200, cash: 906200, market_value: 100000, drawdown: -1.24 },
    { id: 4, backtest_id: 9001, trade_date: '2026-05-07', equity: 1048200, cash: 1048200, market_value: 0, drawdown: 0 },
  ];
  const trades = [
    { id: 1, backtest_id: 9001, symbol: '600000.SH', name: '浦发银行', side: 'BUY', price: 10.2, quantity: 1000, amount: 10200, fee: 3.06, trade_time: '2026-05-04 10:12:00', reason: '分钟放量触发买入', pnl: 0 },
    { id: 2, backtest_id: 9001, symbol: '600000.SH', name: '浦发银行', side: 'SELL', price: 10.88, quantity: 1000, amount: 10880, fee: 14.33, trade_time: '2026-05-05 14:50:00', reason: '止盈卖出', pnl: 662.61 },
    { id: 3, backtest_id: 9001, symbol: '000001.SZ', name: '平安银行', side: 'BUY', price: 11.3, quantity: 1000, amount: 11300, fee: 3.39, trade_time: '2026-05-06 10:20:00', reason: '分钟放量触发买入', pnl: 0 },
    { id: 4, backtest_id: 9001, symbol: '000001.SZ', name: '平安银行', side: 'SELL', price: 12.2, quantity: 1000, amount: 12200, fee: 15.86, trade_time: '2026-05-07 14:50:00', reason: '第五个交易日退出', pnl: 880.75 },
  ];
  const signals = trades.map((trade, index) => ({
    id: index + 1,
    backtest_id: 9001,
    signal_time: trade.trade_time,
    symbol: trade.symbol,
    name: trade.name,
    action: trade.side,
    price: trade.price,
    amount: trade.amount,
    reason: trade.reason,
    status: '已成交',
    execution_time: trade.trade_time,
    execution_price: trade.price,
    quantity: trade.quantity,
    skip_reason: null,
    is_auto_exit: trade.side === 'SELL' ? 1 : 0,
    created_at: trade.trade_time,
  }));
  const logs = [
    { id: 1, backtest_id: 9001, level: 'info', message: '官方路径：按交易日逐分钟推进', technical_detail: 'visual official path', created_at: '2026-05-19 15:31:00' },
    { id: 2, backtest_id: 9001, level: 'info', message: '资金曲线、交易明细和信号审计已生成', technical_detail: 'visual report completed', created_at: '2026-05-19 15:34:00' },
  ];
  const pageBacktestRows = <T,>(items: T[], url: URL) => {
    const pageNumber = Number(url.searchParams.get('page') ?? '1');
    const pageSize = Number(url.searchParams.get('page_size') ?? '20');
    const offset = (pageNumber - 1) * pageSize;
    return {
      items: items.slice(offset, offset + pageSize),
      page: pageNumber,
      page_size: pageSize,
      total: items.length,
      has_more: offset + pageSize < items.length,
    };
  };
  const filterTradesForRequest = (url: URL) => {
    const keyword = url.searchParams.get('keyword')?.trim();
    const status = url.searchParams.get('status')?.trim();
    const startDate = url.searchParams.get('start_date')?.trim();
    const endDate = url.searchParams.get('end_date')?.trim();
    return trades.filter((trade) => {
      const tradeDate = trade.trade_time.slice(0, 10);
      const keywordMatched = !keyword || [trade.symbol, trade.name, trade.side, trade.reason].some((value) => value.includes(keyword));
      const statusMatched = !status || trade.side === status;
      const startMatched = !startDate || tradeDate >= startDate;
      const endMatched = !endDate || tradeDate <= endDate;
      return keywordMatched && statusMatched && startMatched && endMatched;
    });
  };
  const filterSignalsForRequest = (url: URL) => {
    const keyword = url.searchParams.get('keyword')?.trim();
    const status = url.searchParams.get('status')?.trim();
    const startDate = url.searchParams.get('start_date')?.trim();
    const endDate = url.searchParams.get('end_date')?.trim();
    return signals.filter((signal) => {
      const signalDate = signal.signal_time.slice(0, 10);
      const keywordMatched = !keyword || [signal.symbol, signal.name, signal.action, signal.status, signal.reason, signal.skip_reason ?? ''].some((value) => value.includes(keyword));
      const statusMatched = !status || signal.status === status;
      const startMatched = !startDate || signalDate >= startDate;
      const endMatched = !endDate || signalDate <= endDate;
      return keywordMatched && statusMatched && startMatched && endMatched;
    });
  };
  const filterLogsForRequest = (url: URL) => {
    const keyword = url.searchParams.get('keyword')?.trim();
    const status = url.searchParams.get('status')?.trim();
    const startDate = url.searchParams.get('start_date')?.trim();
    const endDate = url.searchParams.get('end_date')?.trim();
    return logs.filter((log) => {
      const logDate = log.created_at.slice(0, 10);
      const keywordMatched = !keyword || [log.message, log.technical_detail ?? '', log.level].some((value) => value.includes(keyword));
      const statusMatched = !status || log.level === status;
      const startMatched = !startDate || logDate >= startDate;
      const endMatched = !endDate || logDate <= endDate;
      return keywordMatched && statusMatched && startMatched && endMatched;
    });
  };

  await page.route('**/api/strategies/files**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取策略成功',
        data: { items: [{ id: 1, file_name: 'visual_minute_strategy.py', strategy_name: '视觉回归分钟策略', version: '1.0.0', description: '视觉回归策略', status: 'enabled', updated_at: '2026-05-19 15:00:00' }], page: 1, page_size: 20, total: 1, has_more: false },
        error: null,
        trace_id: 'visual-strategies',
      }),
    });
  });
  await page.route('**/api/backtests**', async (route) => {
    const url = new URL(route.request().url());
    let data: unknown;
    if (url.pathname === '/api/backtests') {
      data = { items: [task], page: 1, page_size: 20, total: 1, has_more: false };
    } else if (url.pathname.endsWith('/report')) {
      data = { task, result, manifest, strategy_snapshot_check: strategySnapshotCheck, trades, signals, equity, logs };
    } else if (url.pathname.endsWith('/result')) {
      data = result;
    } else if (url.pathname.endsWith('/equity')) {
      data = equity;
    } else if (url.pathname.endsWith('/trades')) {
      data = pageBacktestRows(filterTradesForRequest(url), url);
    } else if (url.pathname.endsWith('/signals')) {
      data = pageBacktestRows(filterSignalsForRequest(url), url);
    } else if (url.pathname.endsWith('/logs')) {
      data = pageBacktestRows(filterLogsForRequest(url), url);
    } else {
      data = null;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, message: '视觉回归数据', data, error: null, trace_id: 'visual-backtest' }),
    });
  });

  await gotoStable(page, '/backtest?tab=新建回测');
  await expect(page.getByRole('heading', { name: '回测研究' })).toBeVisible();
  const backtestStrategySelect = page.locator('.backtest-page .ant-select:has(#strategy_id)');
  await expect(backtestStrategySelect).toBeVisible();
  await backtestStrategySelect.click();
  await expect(page.locator('.ant-select-dropdown')).toBeVisible();
  expect(await scanVisibleLightLeaks(page, '.ant-select-dropdown')).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.locator('.ant-select-dropdown')).toBeHidden();

  await gotoStable(page, '/backtest?tab=回测任务');
  await expect(page.getByTestId('table-backtest-tasks')).toBeVisible();
  expect(await scanTableColumnContract(page, 'table-backtest-tasks'), '回测任务表格列宽语义未收口').toEqual([]);
  const backtestMoreButtons = page.getByRole('button', { name: '更多' });
  expect(await backtestMoreButtons.count()).toBeGreaterThan(0);
  await backtestMoreButtons.first().click();
  await expect(page.locator('.ant-dropdown')).toBeVisible();
  expect(await scanVisibleLightLeaks(page, '.ant-dropdown')).toEqual([]);
  await page.getByText('导出完整Excel', { exact: true }).click();
  await expect(page.locator('.backtest-confirm-modal')).toBeVisible();
  expect(await scanVisibleLightLeaks(page, '.backtest-confirm-modal')).toEqual([]);
  expect(await scanActionableBlockers(page, '.backtest-confirm-modal'), '回测导出确认弹窗存在可操作元素遮挡').toEqual([]);
  await page.locator('.backtest-confirm-modal').getByRole('button', { name: /取\s*消|取消/ }).click();
  await expect(page.locator('.backtest-confirm-modal')).toBeHidden();

  await gotoStable(page, '/backtest?tab=绩效结果');
  await expect(page.getByRole('heading', { name: '回测研究' })).toBeVisible();
  await expect(page.getByTestId('backtest-result-workbench')).toBeVisible();
  await expect(page.getByTestId('backtest-chart-floating-metrics')).toBeVisible();
  await expect(page.getByTestId('backtest-chart-floating-keypoint-highest-equity')).toBeVisible();
  await expect(page.getByTestId('backtest-chart-floating-keypoint-lowest-equity')).toBeVisible();
  await expect(page.getByTestId('backtest-chart-floating-keypoint-max-drawdown')).toBeVisible();
  await expect(page.getByTestId('backtest-chart-keypoint-highest-equity')).toBeVisible();
  await expect(page.getByTestId('backtest-chart-keypoint-lowest-equity')).toBeVisible();
  await expect(page.getByTestId('backtest-chart-keypoint-max-drawdown')).toBeVisible();
  await expect(page.getByTestId('backtest-chart-drawdown-range')).toBeVisible();
  await expect(page.locator('.backtest-report-bottom-grid')).toBeVisible();
  await expect(page.getByTestId('backtest-evidence-board')).toBeVisible();
  await expect(page.getByTestId('backtest-evidence-manifest')).toContainText('Manifest 快照');
  await expect(page.getByTestId('backtest-evidence-coverage')).toContainText('分钟K覆盖');
  await expect(page.getByTestId('backtest-evidence-universe')).toContainText('股票池');
  await expect(page.getByTestId('backtest-evidence-rules')).toContainText('T+1');
  await expect(page.getByTestId('backtest-task-evidence')).toContainText('任务ID');
  await expect(page.getByTestId('backtest-task-evidence')).toContainText('Manifest');

  const reportMetrics = await page.evaluate(() => {
    const isVisible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 12
        && rect.height > 6
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.bottom >= 0
        && rect.right >= 0
        && rect.top <= window.innerHeight
        && rect.left <= window.innerWidth;
    };
    const isLightBackground = (background: string) => {
      const match = background.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (!match) return false;
      const [, red, green, blue, alpha = '1'] = match;
      return Number(alpha) > 0.35 && Number(red) > 235 && Number(green) > 235 && Number(blue) > 235;
    };
    const scan = (selector: string) => {
      const root = document.querySelector(selector);
      if (!root) {
        return { missing: selector, leaks: [{ className: 'missing-root', background: 'none', text: selector }] };
      }
      const rect = root.getBoundingClientRect();
      const leaks = Array.from(root.querySelectorAll('*'))
        .filter(isVisible)
        .map((element) => ({
          className: String((element as HTMLElement).className || '').slice(0, 140),
          background: window.getComputedStyle(element).backgroundColor,
          text: (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100),
        }))
        .filter((entry) => isLightBackground(entry.background))
        .slice(0, 12);
      return { width: Math.round(rect.width), height: Math.round(rect.height), leaks };
    };
    const workbench = document.querySelector<HTMLElement>('.backtest-report-workbench');
    const chartZone = document.querySelector<HTMLElement>('[data-workbench-zone="chart"]');
    const inspectorZone = document.querySelector<HTMLElement>('[data-workbench-zone="inspector"]');
    const topbar = document.querySelector<HTMLElement>('[data-testid="backtest-report-workbench-topbar"]');
    const bottomGrid = document.querySelector<HTMLElement>('[data-testid="backtest-report-bottom-grid"]');
    const evidenceSections = Array.from(document.querySelectorAll<HTMLElement>('.backtest-evidence-section'));
    const evidenceCellHeights = Array.from(document.querySelectorAll<HTMLElement>('.backtest-evidence-cell'))
      .map((element) => Math.round(element.getBoundingClientRect().height));
    const taskEvidenceCells = Array.from(document.querySelectorAll<HTMLElement>('.backtest-task-evidence-strip__cell'))
      .map((element) => Math.round(element.getBoundingClientRect().height));
    const chartRect = chartZone?.getBoundingClientRect();
    const inspectorRect = inspectorZone?.getBoundingClientRect();
    const topbarRect = topbar?.getBoundingClientRect();
    const dockHeights = Array.from(document.querySelectorAll<HTMLElement>('.backtest-report-bottom-grid .backtest-report-dock-card'))
      .map((element) => Math.round(element.getBoundingClientRect().height));
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      workbenchRole: workbench?.dataset.workbenchRole ?? '',
      layout: workbench?.dataset.layout ?? '',
      dockRole: bottomGrid?.dataset.workbenchRole ?? '',
      chartWidth: chartRect ? Math.round(chartRect.width) : 0,
      inspectorWidth: inspectorRect ? Math.round(inspectorRect.width) : 0,
      chartLeft: chartRect ? Math.round(chartRect.left) : 0,
      inspectorLeft: inspectorRect ? Math.round(inspectorRect.left) : 0,
      topbarHeight: topbarRect ? Math.round(topbarRect.height) : 0,
      dockCount: dockHeights.length,
      dockHeights,
      evidenceSectionCount: evidenceSections.length,
      evidenceMaxCellHeight: evidenceCellHeights.length ? Math.max(...evidenceCellHeights) : 0,
      evidenceMinCellHeight: evidenceCellHeights.length ? Math.min(...evidenceCellHeights) : 0,
      taskEvidenceMaxCellHeight: taskEvidenceCells.length ? Math.max(...taskEvidenceCells) : 0,
      workbench: scan('.backtest-report-workbench'),
      chart: scan('.backtest-chart-card'),
      bottom: scan('[data-testid="backtest-report-bottom-grid"]'),
      evidence: scan('[data-testid="backtest-evidence-board"]'),
      taskEvidence: scan('[data-testid="backtest-task-evidence"]'),
    };
  });

  expect(reportMetrics.overflow, '回测报告存在页面级横向溢出').toBeLessThanOrEqual(1);
  expect(reportMetrics.workbenchRole, '回测报告工作台缺少固定工作台语义').toBe('backtest-report-workstation');
  expect(reportMetrics.layout, '回测报告没有保持左图右指标布局语义').toBe('chart-left-inspector-right');
  expect(reportMetrics.dockRole, '回测报告底部明细区缺少固定停靠区语义').toBe('backtest-report-dock');
  expect(reportMetrics.chartWidth, '回测报告左侧图表区域宽度不足').toBeGreaterThan(reportMetrics.inspectorWidth);
  expect(reportMetrics.inspectorWidth, '回测报告右侧指标面板宽度不足').toBeGreaterThanOrEqual(300);
  expect(reportMetrics.chartLeft, '回测报告图表必须位于指标面板左侧').toBeLessThan(reportMetrics.inspectorLeft);
  expect(reportMetrics.topbarHeight, '回测报告顶部工作台栏高度不足').toBeGreaterThanOrEqual(28);
  expect(reportMetrics.topbarHeight, '回测报告顶部工作台栏过高').toBeLessThanOrEqual(44);
  expect(reportMetrics.dockCount, '回测报告底部应固定为交易摘要、任务信息、日志摘要三块').toBe(3);
  expect(Math.max(...reportMetrics.dockHeights) - Math.min(...reportMetrics.dockHeights), '回测报告底部三块高度不一致').toBeLessThanOrEqual(4);
  expect(reportMetrics.evidenceSectionCount, '回测 Manifest 证据链必须分为 Manifest、覆盖率、股票池、规则四块').toBe(4);
  expect(reportMetrics.evidenceMaxCellHeight, '回测证据链单元格过高，密度不符合终端复盘').toBeLessThanOrEqual(72);
  expect(reportMetrics.evidenceMaxCellHeight - reportMetrics.evidenceMinCellHeight, '回测证据链单元格高度不统一').toBeLessThanOrEqual(22);
  expect(reportMetrics.taskEvidenceMaxCellHeight, '回测任务摘要单元格过高').toBeLessThanOrEqual(64);
  expect(reportMetrics.workbench.leaks, '回测报告工作台出现浅色泄漏').toEqual([]);
  expect(reportMetrics.chart.leaks, '回测图表区域出现浅色泄漏').toEqual([]);
  expect(reportMetrics.bottom.leaks, '回测底部明细区出现浅色泄漏').toEqual([]);
  expect(reportMetrics.evidence.leaks, '回测 Manifest 证据链出现浅色泄漏').toEqual([]);
  expect(reportMetrics.taskEvidence.leaks, '回测任务摘要出现浅色泄漏').toEqual([]);
  expect(reportMetrics.workbench.height).toBeGreaterThan(480);

  await page.getByTestId('backtest-chart-floating-keypoint-highest-equity').click();
  await expect(page.getByTestId('backtest-chart-floating-keypoint-highest-equity')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('backtest-chart-keypoint-highest-equity')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('backtest-chart-equity-preview')).toContainText('2026-05-07');
  await page.getByTestId('backtest-chart-floating-keypoint-lowest-equity').click();
  await expect(page.getByTestId('backtest-chart-floating-keypoint-lowest-equity')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('backtest-chart-equity-preview')).toContainText('2026-05-04');

  await page.getByTestId('backtest-chart-keypoint-max-drawdown').click();
  await expect(page.getByTestId('backtest-chart-keypoint-max-drawdown')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.backtest-chart-keypoint-detail')).toContainText('最大回撤');
  await expect(page.getByTestId('backtest-chart-equity-preview')).toContainText('2026-05-06');
  await expect(page.getByTestId('backtest-chart-hover-anchor-main')).toContainText('2026-05-06');
  await expect(page.getByTestId('backtest-report-equity-preview')).toContainText('2026-05-06');
  await expect(page.getByTestId('backtest-report-sync-ribbon')).toContainText('2026-05-06');
  await expect(page.getByTestId('backtest-report-day-trades')).toContainText('000001.SZ');
  await page.getByTestId('backtest-report-equity-preview-locate').click();
  await expect(page.getByTestId('backtest-equity-date-linkage-panel')).toBeVisible();
  await expect(page.getByTestId('backtest-equity-date-linkage-grid')).toContainText('2026-05-06');
  await expect(page.getByTestId('backtest-report-sync-ribbon')).toContainText('服务端当日分页');
  await expect(page.getByTestId('table-backtest-trades')).toContainText('000001.SZ');
  await expect(page.getByTestId('table-backtest-trades')).not.toContainText('600000.SH');
  await expect(page.getByTestId('backtest-signal-filter-summary')).toContainText('2026-05-06');
  await expect(page.getByTestId('table-backtest-signals')).toContainText('000001.SZ');
  await expect(page.getByTestId('table-backtest-signals')).not.toContainText('600000.SH');
  await page.getByRole('tab', { name: '回测日志' }).click();
  await expect(page.getByTestId('backtest-log-date-boundary')).toContainText('回测日志不按曲线交易日强制筛选');
  await expect(page.getByTestId('backtest-log-date-boundary')).toContainText('2026-05-06');
  await expect(page.getByTestId('backtest-log-filter-summary')).toContainText('任务运行时间 created_at');
  await expect(page.getByTestId('table-backtest-logs')).toContainText('官方路径');
  await page.getByRole('tab', { name: '交易明细' }).click();
  await page.getByTestId('backtest-equity-date-linkage-panel').getByRole('button', { name: '清除定位' }).click();
  await page.getByRole('tab', { name: '绩效结果' }).click();
  await page.getByTestId('backtest-chart-trade-marker-1').hover();
  await expect(page.getByTestId('backtest-chart-trade-preview')).toContainText('600000.SH');
  await expect(page.getByTestId('backtest-report-preview-trade')).toContainText('600000.SH');
  await page.screenshot({ path: '../docs/reports/screenshots/qa_backtest_report_workbench_fixture_20260519.png', fullPage: false });

  await page.getByTestId('backtest-report-preview-locate').click();
  await expect(page.getByTestId('backtest-trade-linkage-panel')).toBeVisible();
  await expect(page.getByTestId('backtest-trade-linkage-grid')).toContainText('600000.SH');
  await expect(page.locator('.backtest-focused-trade-row')).toHaveCount(1);

  await page.getByRole('tab', { name: '交易明细' }).click();
  await expect(page.getByTestId('table-backtest-trades')).toBeVisible();
  expect(await scanTableColumnContract(page, 'table-backtest-trades'), '回测交易明细表格列宽语义未收口').toEqual([]);
  await expect(page.getByTestId('table-backtest-signals')).toBeVisible();
  expect(await scanTableColumnContract(page, 'table-backtest-signals'), '回测信号审计表格列宽语义未收口').toEqual([]);
  await page.getByRole('tab', { name: '回测日志' }).click();
  await expect(page.getByTestId('table-backtest-logs')).toBeVisible();
  expect(await scanTableColumnContract(page, 'table-backtest-logs'), '回测日志表格列宽语义未收口').toEqual([]);
});

test('数据中心K线查看区和确认弹窗保持终端暗色标准', async ({ page }) => {
  await page.route('**/api/data/sources/qmt/status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取 QMT 状态成功',
        data: {
          mode: 'real',
          connected: true,
          account_id: 'demo_account',
          status_text: '真实 QMT 只读',
          simulation_mode: false,
          last_check_time: '2026-05-19 15:00:00',
        },
        error: null,
        trace_id: 'visual-kline-qmt',
      }),
    });
  });
  await page.route('**/api/data/account/latest', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取账户资金成功',
        data: {
          id: 1,
          account_id: 'demo_account',
          total_asset: 5381.5,
          available_cash: 0,
          frozen_cash: 0,
          market_value: 5381.5,
          today_pnl: 0,
          snapshot_time: '2026-05-19 15:00:00',
        },
        error: null,
        trace_id: 'visual-kline-account',
      }),
    });
  });
  await page.route('**/api/data/quality/summary', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取质量摘要成功',
        data: {
          success_count: 8,
          warning_count: 0,
          failed_count: 0,
          latest_check_time: '2026-05-19 15:00:00',
          is_stale: false,
          stale_reason: null,
        },
        error: null,
        trace_id: 'visual-kline-quality',
      }),
    });
  });
  await page.route('**/api/data/freshness/summary', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取数据新鲜度成功',
        data: {
          target_trade_date: '2026-05-19',
          generated_at: '2026-05-19 15:00:00',
          overall_status: 'ok',
          stale_count: 0,
          warning_count: 0,
          next_actions: ['关键数据已到目标日。'],
          items: [],
        },
        error: null,
        trace_id: 'visual-kline-freshness',
      }),
    });
  });
  await page.route('**/api/data/catalog/official', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取官方数据目录成功',
        data: {
          source: 'qmt',
          account_type: 'normal_stock',
          account_type_label: '普通股票账户',
          has_l2: false,
          has_credit: false,
          limitation_note: '视觉回归夹具：普通股票账户只读数据边界。',
          unsupported_items: [],
          items: [],
        },
        error: null,
        trace_id: 'visual-kline-catalog',
      }),
    });
  });
  await page.route('**/api/data/sync/coverage-2026**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取覆盖率成功',
        data: { items: [], page: 1, page_size: 50, total: 0, has_more: false },
        error: null,
        trace_id: 'visual-kline-coverage',
      }),
    });
  });
  await page.route('**/api/data/sync/tasks**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取同步任务成功',
        data: { items: [], page: 1, page_size: 5, total: 0, has_more: false },
        error: null,
        trace_id: 'visual-sync-tasks-empty',
      }),
    });
  });
  await page.route('**/api/data/stocks**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取股票列表成功',
        data: {
          items: [
            { id: 1, symbol: '600000.SH', name: '浦发银行', market: 'SH', industry: '银行', list_date: '1999-11-10', total_market_value: 50000000000, updated_at: '2026-05-19 15:00:00' },
          ],
          page: 1,
          page_size: 20,
          total: 1,
          has_more: false,
        },
        error: null,
        trace_id: 'visual-kline-stocks',
      }),
    });
  });
  await page.route('**/api/data/kline/daily**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取日K成功',
        data: { items: [], page: 1, page_size: 50, total: 0, has_more: false },
        error: null,
        trace_id: 'visual-kline-daily',
      }),
    });
  });
  await page.route('**/api/data/kline/minute**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取分钟K成功',
        data: { items: [], page: 1, page_size: 50, total: 0, has_more: false },
        error: null,
        trace_id: 'visual-kline-minute',
      }),
    });
  });

  await gotoStable(page, '/data-center?tab=行情数据', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: '数据中心' })).toBeVisible();
  await expect(page.getByRole('tab', { name: '行情数据' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.market-kline-workbench')).toBeVisible();

  const workbenchLeaks = await page.evaluate(() => {
    const root = document.querySelector('.market-kline-workbench');
    if (!root) {
      return [{ className: 'missing-market-kline-workbench', background: 'none', text: '' }];
    }
    const isVisible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 12
        && rect.height > 6
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.bottom >= 0
        && rect.right >= 0
        && rect.top <= window.innerHeight
        && rect.left <= window.innerWidth;
    };
    const isLightBackground = (background: string) => {
      const match = background.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (!match) return false;
      const [, red, green, blue, alpha = '1'] = match;
      return Number(alpha) > 0.35 && Number(red) > 235 && Number(green) > 235 && Number(blue) > 235;
    };
    return Array.from(root.querySelectorAll('*'))
      .filter(isVisible)
      .map((element) => ({
        className: String((element as HTMLElement).className || '').slice(0, 120),
        background: window.getComputedStyle(element).backgroundColor,
        text: (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80),
      }))
      .filter((item) => isLightBackground(item.background))
      .slice(0, 10);
  });

  expect(workbenchLeaks, 'K线查看区存在默认浅色背景泄漏').toEqual([]);
  await expect(page.locator('.kline-chart-hover-strip, .kline-chart--empty').first()).toBeVisible();

  await expect(page.getByTestId('btn-sync-latest-data')).toBeEnabled({ timeout: 15000 });
  await page.getByTestId('btn-sync-latest-data').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('同步到最新完成交易日');
  await page.locator('.risk-confirm-content').waitFor({ state: 'visible' });
  await page.waitForTimeout(250);

  const modalMetrics = await page.evaluate(() => {
    const content = document.querySelector<HTMLElement>('.risk-confirm-content');
    const modalRoot = document.querySelector<HTMLElement>('.ant-modal:has(.risk-confirm-content)')
      ?? document.querySelector<HTMLElement>('.ant-modal-confirm');
    const body = modalRoot?.querySelector<HTMLElement>('.ant-modal-confirm-body-wrapper') ?? null;
    const buttons = Array.from(modalRoot?.querySelectorAll<HTMLElement>('.ant-modal-confirm-btns .ant-btn') ?? []);
    const sections = Array.from(document.querySelectorAll<HTMLElement>('.risk-confirm-content__object, .risk-confirm-content__block, .risk-confirm-content__details-wrap, .risk-confirm-content__next, .risk-confirm-content__extra'));
    const sectionHeights = sections.map((section) => Math.round(section.offsetHeight));
    const labels = Array.from(modalRoot?.querySelectorAll<HTMLElement>('.ant-descriptions-item-label') ?? []);
    const contents = Array.from(modalRoot?.querySelectorAll<HTMLElement>('.ant-descriptions-item-content') ?? []);
    const leaks = Array.from(modalRoot?.querySelectorAll<HTMLElement>('.ant-modal-confirm, .ant-modal-confirm *') ?? [])
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        if (rect.width <= 12 || rect.height <= 6 || style.visibility === 'hidden' || style.display === 'none') return false;
        const match = style.backgroundColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
        if (!match) return false;
        const [, red, green, blue, alpha = '1'] = match;
        return Number(alpha) > 0.35 && Number(red) > 235 && Number(green) > 235 && Number(blue) > 235;
      })
      .map((element) => ({
        className: String(element.className || '').slice(0, 120),
        text: (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80),
      }));
    return {
      modalWidth: Math.round(modalRoot?.getBoundingClientRect().width ?? 0),
      contentWidth: Math.round(content?.offsetWidth ?? 0),
      bodyPaddingTop: body ? Number.parseFloat(window.getComputedStyle(body).paddingTop) : 0,
      bodyPaddingLeft: body ? Number.parseFloat(window.getComputedStyle(body).paddingLeft) : 0,
      buttonHeights: buttons.map((button) => Math.round(button.getBoundingClientRect().height)),
      sectionHeights,
      sectionHeightSpread: sectionHeights.length ? Math.max(...sectionHeights) - Math.min(...sectionHeights) : 0,
      labelWidths: labels.map((label) => Math.round(label.getBoundingClientRect().width)),
      contentMinWidth: contents.length
        ? contents.reduce((min, content) => Math.min(min, Math.round(content.getBoundingClientRect().width)), Number.POSITIVE_INFINITY)
        : 0,
      leaks,
    };
  });

  expect(modalMetrics.modalWidth).toBeGreaterThanOrEqual(600);
  expect(modalMetrics.modalWidth).toBeLessThanOrEqual(720);
  expect(modalMetrics.contentWidth).toBeGreaterThan(560);
  expect(modalMetrics.bodyPaddingTop).toBeGreaterThanOrEqual(12);
  expect(modalMetrics.bodyPaddingTop).toBeLessThanOrEqual(18);
  expect(modalMetrics.bodyPaddingLeft).toBeGreaterThanOrEqual(14);
  expect(modalMetrics.buttonHeights.every((height) => height >= 26 && height <= 30)).toBeTruthy();
  expect(Math.max(...modalMetrics.sectionHeights)).toBeLessThanOrEqual(260);
  expect(modalMetrics.sectionHeightSpread, '数据中心确认弹窗信息块高度差异过大').toBeLessThanOrEqual(180);
  expect(modalMetrics.labelWidths.every((width) => width >= 104 && width <= 124), '数据中心确认弹窗关键参数标签宽度不统一').toBeTruthy();
  expect(modalMetrics.contentMinWidth, '数据中心确认弹窗关键参数内容列过窄').toBeGreaterThanOrEqual(420);
  expect(modalMetrics.leaks, '确认弹窗存在默认浅色背景泄漏').toEqual([]);
  expect(await scanActionableBlockers(page, '.ant-modal:has(.risk-confirm-content)'), '数据中心确认弹窗存在可操作元素遮挡').toEqual([]);

  await page.getByRole('button', { name: /取\s*消|取消/ }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('数据中心真实账户默认视图隔离历史测试数据', async ({ page }) => {
  await page.route('**/api/data/sources/qmt/status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取 QMT 状态成功',
        data: {
          source_code: 'qmt',
          source_name: '真实 QMT 只读数据源',
          mode: 'real',
          connected: true,
          account_id: 'real-account',
          qmt_path: 'C:/QMT',
          xtquant_installed: true,
          last_connected_at: '2026-05-10 09:12:05',
          message: '真实 QMT 前置检测已启用；同步前请先完成只读验收。',
        },
        error: null,
        trace_id: 'visual-real-qmt',
      }),
    });
  });
  await page.route('**/api/data/account/latest', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取账户资金成功',
        data: {
          id: 1,
          account_id: 'real-account',
          total_asset: 4408.25,
          available_cash: 0,
          frozen_cash: 0,
          market_value: 4408.25,
          today_pnl: -572.02,
          snapshot_time: '2026-05-10 09:12:05',
        },
        error: null,
        trace_id: 'visual-real-account',
      }),
    });
  });
  await page.route('**/api/data/freshness/summary', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取数据新鲜度成功',
        data: {
          target_trade_date: '2026-05-10',
          generated_at: '2026-05-10 09:12:05',
          overall_status: 'ok',
          stale_count: 0,
          warning_count: 0,
          next_actions: ['真实账户数据已隔离展示'],
          items: [],
        },
        error: null,
        trace_id: 'visual-freshness-real-account',
      }),
    });
  });
  await page.route('**/api/data/quality/summary', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取质量摘要成功',
        data: { success_count: 0, warning_count: 0, failed_count: 0, latest_check_time: null },
        error: null,
        trace_id: 'visual-quality-real-account',
      }),
    });
  });
  await page.route('**/api/data/sync/tasks**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取同步任务成功',
        data: { items: [], page: 1, page_size: 20, total: 0, has_more: false },
        error: null,
        trace_id: 'visual-sync-tasks-real-account',
      }),
    });
  });
  await page.route('**/api/data/positions**', async (route) => {
    const scope = new URL(route.request().url()).searchParams.get('scope') ?? 'current';
    const items = scope === 'all_history'
      ? [
          { id: 1, account_id: 'test_isolation_account', symbol: '600000.SH', name: '浦发银行', quantity: 100, available_quantity: 100, cost_price: 9, last_price: 9.1, market_value: 910, pnl: 10, pnl_ratio: 1.1, snapshot_time: '2026-05-09 09:00:00' },
          { id: 2, account_id: 'real-account', symbol: '871169.BJ', name: '辰光医疗', quantity: 229, available_quantity: 229, cost_price: 21.7479, last_price: 19.25, market_value: 4408.25, pnl: -572.02, pnl_ratio: -11.49, snapshot_time: '2026-05-10 09:12:05' },
        ]
      : [
          { id: 2, account_id: 'real-account', symbol: '871169.BJ', name: '辰光医疗', quantity: 229, available_quantity: 229, cost_price: 21.7479, last_price: 19.25, market_value: 4408.25, pnl: -572.02, pnl_ratio: -11.49, snapshot_time: '2026-05-10 09:12:05' },
        ];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, message: '获取持仓成功', data: { items, page: 1, page_size: 20, total: items.length, has_more: false }, error: null, trace_id: `visual-positions-${scope}` }),
    });
  });
  for (const path of ['orders', 'trades']) {
    await page.route(`**/api/data/${path}**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, message: '获取账户明细成功', data: { items: [], page: 1, page_size: 20, total: 0, has_more: false }, error: null, trace_id: `visual-${path}` }),
      });
    });
  }

  await gotoStable(page, '/data-center?tab=账户数据');
  await expect(page.getByRole('tab', { name: '账户数据', selected: true })).toBeVisible();
  await expect(page.getByText('当前数据来源：真实 QMT 只读')).toBeVisible({ timeout: 15000 });

  await expect(page.getByTestId('data-account-evidence-board')).toBeVisible();
  await expect(page.getByTestId('data-account-evidence-board')).toContainText('账户范围');
  expect(await scanVisibleLightLeaks(page, '[data-testid="data-account-evidence-board"]'), '账户数据证据板出现浅色泄漏').toEqual([]);
  await expect(page.getByTestId('account-scope-panel')).toContainText('当前账户最新快照');
  await expect(page.getByTestId('account-scope-panel')).toContainText('测试历史数据已隐藏');
  await expect(page.getByText('871169.BJ')).toBeVisible();
  await expect(page.getByText('600000.SH')).not.toBeVisible();

  await page.getByTestId('account-scope-panel').getByText('全部历史', { exact: true }).click();
  await expect(page.getByTestId('account-scope-panel')).toContainText('全部历史数据', { timeout: 15000 });
  await expect(page.getByTestId('table-positions')).toContainText('600000.SH', { timeout: 15000 });
});

test('交易执行和数据中心深层表格不泄漏浅色并保持列密度', async ({ page }) => {
  const pageResult = <T,>(items: T[]) => ({
    items,
    page: 1,
    page_size: 20,
    total: items.length,
    has_more: false,
  });

  await page.route('**/api/data/sources/qmt/status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '视觉回归测试隔离 QMT 状态',
        data: {
          source_code: 'qmt',
          source_name: 'MiniQMT',
          mode: 'test_isolation',
          connected: true,
          account_id: 'visual-account',
          qmt_path: 'C:\\visual\\qmt',
          xtquant_installed: true,
          last_connected_at: '2026-05-19 10:00:00',
          message: '测试隔离模式，仅用于视觉回归，不进入默认业务视图。',
        },
        error: null,
        trace_id: 'visual-qmt-test-mode',
      }),
    });
  });

  await page.route('**/api/data/account/latest', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '视觉回归账户数据',
        data: {
          id: 1,
          account_id: 'visual-account',
          total_asset: 5381.5,
          available_cash: 5381.5,
          frozen_cash: 0,
          market_value: 0,
          today_pnl: 0,
          snapshot_time: '2026-05-19 10:00:00',
        },
        error: null,
        trace_id: 'visual-account-latest',
      }),
    });
  });

  await page.route('**/api/trading/**', async (route) => {
    const url = new URL(route.request().url());
    let data: unknown = pageResult([]);

    if (url.pathname === '/api/trading/signals') {
      data = pageResult([{
        id: 1,
        strategy_id: 101,
        strategy_name: '视觉回归分钟策略',
        run_id: 'run_visual_001',
        symbol: '600000.SH',
        name: '浦发银行',
        action: 'BUY',
        price: 10.25,
        amount: 10000,
        reason: '连续三分钟放量并通过市值过滤，等待人工确认。',
        status: '未处理',
        signal_time: '2026-05-19 10:15:00',
        order_id: null,
        created_at: '2026-05-19 10:15:01',
      }]);
    } else if (url.pathname === '/api/trading/positions') {
      data = pageResult([{
        id: 1,
        account_id: 'demo_account',
        symbol: '600000.SH',
        name: '浦发银行',
        quantity: 1000,
        available_quantity: 1000,
        cost_price: 10.1,
        last_price: 10.25,
        market_value: 10250,
        pnl: 150,
        pnl_ratio: 1.49,
        snapshot_time: '2026-05-19 15:00:00',
      }]);
    } else if (url.pathname === '/api/trading/orders') {
      data = pageResult([{
        id: 1,
        local_order_id: 'LQC202605190001',
        qmt_order_id: 'QMT202605190001',
        account_id: 'demo_account',
        symbol: '600000.SH',
        name: '浦发银行',
        side: 'BUY',
        price: 10.25,
        quantity: 1000,
        filled_quantity: 600,
        status: 'partially_filled',
        qmt_status: '部分成交',
        source: 'signal',
        strategy_id: '101',
        strategy_name: '视觉回归分钟策略',
        signal_id: '1',
        idempotency_key: 'idem_visual_001',
        order_time: '2026-05-19 10:16:00',
        updated_at: '2026-05-19 10:18:00',
      }]);
    } else if (url.pathname === '/api/trading/trades') {
      data = pageResult([{
        id: 1,
        trade_id: 'TRD202605190001',
        local_order_id: 'LQC202605190001',
        qmt_order_id: 'QMT202605190001',
        account_id: 'demo_account',
        symbol: '600000.SH',
        name: '浦发银行',
        side: 'BUY',
        price: 10.23,
        quantity: 600,
        amount: 6138,
        fee: 1.84,
        source: 'signal',
        strategy_name: '视觉回归分钟策略',
        trade_time: '2026-05-19 10:17:10',
      }]);
    } else if (url.pathname === '/api/trading/logs') {
      data = pageResult([{
        id: 1,
        local_order_id: 'LQC202605190001',
        level: 'info',
        message: '委托已提交并完成部分成交同步。',
        technical_detail: 'status=partially_filled; filled_quantity=600',
        created_at: '2026-05-19 10:18:02',
      }]);
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, message: '视觉回归交易数据', data, error: null, trace_id: 'visual-trading-deep-table' }),
    });
  });

  await page.route('**/api/data/sync/tasks**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取同步任务成功',
        data: pageResult([{
          task_id: 'task_visual_sync_20260519',
          sync_type: 'sync_latest_data',
          status: 'success',
          total_count: 5000,
          success_count: 5000,
          failed_count: 0,
          progress: 100,
          message: '全市场日K补齐到最新完成交易日，分钟K缺失链路待单独验收。',
          technical_detail: JSON.stringify({ written_rows: 441039, failed_symbols: 0, period: '1m' }),
          started_at: '2026-05-19 09:00:00',
          finished_at: '2026-05-19 09:31:00',
        }]),
        error: null,
        trace_id: 'visual-data-sync-task',
      }),
    });
  });
  await page.route('**/api/data/quality/results**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取质量检查成功',
        data: pageResult([{
          id: 1,
          check_type: 'minute_coverage',
          target_table: 'minute_kline',
          status: 'warning',
          message: '当前分钟K覆盖率需要按回测区间复核。',
          suggestion: '先执行覆盖率检查，再运行正式分钟回测。',
          created_at: '2026-05-19 09:40:00',
        }]),
        error: null,
        trace_id: 'visual-data-quality',
      }),
    });
  });
  await page.route('**/api/data/quality/account-snapshot-duplicates**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取重复快照成功',
        data: pageResult([{
          account_id: 'demo_account',
          snapshot_time: '2026-05-19 09:31:00',
          duplicate_count: 2,
          min_id: 10,
          max_id: 12,
          min_total_asset: 5381.5,
          max_total_asset: 5381.5,
          min_available_cash: 0,
          max_available_cash: 0,
        }]),
        error: null,
        trace_id: 'visual-account-duplicate',
      }),
    });
  });
  await page.route('**/api/data/dictionary**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取数据字典成功',
        data: pageResult([{
          id: 1,
          table_name: 'minute_kline',
          field_name: 'amount',
          field_type: 'REAL',
          description: '1分钟K成交额，单位元。',
          example_value: '52300000',
          unit: '元',
          strategy_usage: '用于开盘放量、量比和成交额过滤。',
          is_indexed: true,
        }]),
        error: null,
        trace_id: 'visual-dictionary',
      }),
    });
  });
  await page.route('**/api/data/quality/summary**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取质量摘要成功',
        data: { success_count: 8, warning_count: 1, failed_count: 0, latest_check_time: '2026-05-19 09:40:00', is_stale: false, stale_reason: null },
        error: null,
        trace_id: 'visual-quality-summary',
      }),
    });
  });

  const scanTable = async (testId: string) => page.evaluate((currentTestId) => {
    const root = document.querySelector(`[data-testid="${currentTestId}"]`);
    if (!root) {
      return {
        overflow: 0,
        maxRowHeight: 0,
        maxActionWidth: 0,
        maxButtonHeight: 0,
        fixedActionCells: 0,
        pagerMaxHeight: 0,
        pagerMaxControlHeight: 0,
        stickyTrackMaxHeight: 0,
        stickyBarMaxHeight: 0,
        pagerLeaks: [] as Array<{ className: string; background: string; text: string }>,
        leaks: [{ className: 'missing-table', background: 'none', text: currentTestId }],
      };
    }

    const isVisible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 12
        && rect.height > 6
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.bottom >= 0
        && rect.right >= 0
        && rect.top <= window.innerHeight
        && rect.left <= window.innerWidth;
    };
    const isLightBackground = (background: string) => {
      const match = background.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (!match) return false;
      const [, red, green, blue, alpha = '1'] = match;
      return Number(alpha) > 0.35 && Number(red) > 235 && Number(green) > 235 && Number(blue) > 235;
    };
    const rows = Array.from(root.querySelectorAll<HTMLElement>('.ant-table-row'));
    const actionCells = Array.from(root.querySelectorAll<HTMLElement>('.data-table-col--action'));
    const buttons = Array.from(root.querySelectorAll<HTMLElement>('.data-table-col--action .ant-btn'));
    const pager = root.querySelector<HTMLElement>('.ant-pagination');
    const pagerControls = pager
      ? Array.from(pager.querySelectorAll<HTMLElement>('.ant-pagination-item, .ant-pagination-prev, .ant-pagination-next, .ant-select-selector, .ant-pagination-options-quick-jumper input')).filter(isVisible)
      : [];
    const stickyTracks = Array.from(root.querySelectorAll<HTMLElement>('.ant-table-sticky-scroll')).filter(isVisible);
    const stickyBars = Array.from(root.querySelectorAll<HTMLElement>('.ant-table-sticky-scroll-bar')).filter(isVisible);
    const rect = (root as HTMLElement).getBoundingClientRect();
    const leakEntries = (scope: ParentNode) => Array.from(scope.querySelectorAll('*'))
      .filter(isVisible)
      .map((element) => ({
        className: String((element as HTMLElement).className || '').slice(0, 140),
        background: window.getComputedStyle(element).backgroundColor,
        text: (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100),
      }))
      .filter((entry) => isLightBackground(entry.background))
      .slice(0, 12);
    return {
      overflow: Math.max(0, Math.round(rect.right - document.documentElement.clientWidth)),
      maxRowHeight: rows.reduce((max, row) => Math.max(max, Math.round(row.getBoundingClientRect().height)), 0),
      maxActionWidth: actionCells.reduce((max, cell) => Math.max(max, Math.round(cell.getBoundingClientRect().width)), 0),
      maxButtonHeight: buttons.reduce((max, button) => Math.max(max, Math.round(button.getBoundingClientRect().height)), 0),
      fixedActionCells: actionCells.filter((cell) => cell.classList.contains('ant-table-cell-fix-right')).length,
      pagerMaxHeight: pager ? Math.round(pager.getBoundingClientRect().height) : 0,
      pagerMaxControlHeight: pagerControls.reduce((max, control) => Math.max(max, Math.round(control.getBoundingClientRect().height)), 0),
      stickyTrackMaxHeight: stickyTracks.reduce((max, track) => Math.max(max, Math.round(track.getBoundingClientRect().height)), 0),
      stickyBarMaxHeight: stickyBars.reduce((max, bar) => Math.max(max, Math.round(bar.getBoundingClientRect().height)), 0),
      pagerLeaks: pager ? leakEntries(pager) : [],
      leaks: leakEntries(root),
    };
  }, testId);

  const scanModalChrome = async (selector: string) => page.evaluate((currentSelector) => {
    const modal = document.querySelector<HTMLElement>(currentSelector);
    if (!modal) {
      return {
        exists: false,
        width: 0,
        bodyHeight: 0,
        maxSectionHeight: 0,
        minSectionHeight: 0,
        sectionHeightSpread: 0,
        labelWidths: [] as number[],
        contentMinWidth: 0,
        buttonHeights: [],
        leaks: [{ className: 'missing-modal', background: 'none', text: currentSelector }],
      };
    }
    const isVisible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 12
        && rect.height > 6
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.bottom >= 0
        && rect.right >= 0
        && rect.top <= window.innerHeight
        && rect.left <= window.innerWidth;
    };
    const isLightBackground = (background: string) => {
      const match = background.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (!match) return false;
      const [, red, green, blue, alpha = '1'] = match;
      return Number(alpha) > 0.35 && Number(red) > 235 && Number(green) > 235 && Number(blue) > 235;
    };
    const sections = Array.from(modal.querySelectorAll<HTMLElement>('.risk-confirm-content__object, .risk-confirm-content__block, .risk-confirm-content__details-wrap, .risk-confirm-content__next, .risk-confirm-content__extra, .order-confirm-descriptions'));
    const sectionHeights = sections.map((section) => Math.round(section.getBoundingClientRect().height));
    const labels = Array.from(modal.querySelectorAll<HTMLElement>('.ant-descriptions-item-label'));
    const contents = Array.from(modal.querySelectorAll<HTMLElement>('.ant-descriptions-item-content'));
    const buttons = Array.from(modal.querySelectorAll<HTMLElement>('.ant-btn'));
    const body = modal.querySelector<HTMLElement>('.ant-modal-body, .ant-modal-confirm-content');
    return {
      exists: true,
      width: Math.round(modal.getBoundingClientRect().width),
      bodyHeight: Math.round(body?.getBoundingClientRect().height ?? 0),
      maxSectionHeight: sectionHeights.length ? Math.max(...sectionHeights) : 0,
      minSectionHeight: sectionHeights.length ? Math.min(...sectionHeights) : 0,
      sectionHeightSpread: sectionHeights.length ? Math.max(...sectionHeights) - Math.min(...sectionHeights) : 0,
      labelWidths: labels.map((label) => Math.round(label.getBoundingClientRect().width)),
      contentMinWidth: contents.length
        ? contents.reduce((min, content) => Math.min(min, Math.round(content.getBoundingClientRect().width)), Number.POSITIVE_INFINITY)
        : 0,
      contentMaxWidth: contents.reduce((max, content) => Math.max(max, Math.round(content.getBoundingClientRect().width)), 0),
      buttonHeights: buttons.map((button) => Math.round(button.getBoundingClientRect().height)),
      leaks: Array.from(modal.querySelectorAll<HTMLElement>('*'))
        .filter(isVisible)
        .map((element) => ({
          className: String(element.className || '').slice(0, 140),
          background: window.getComputedStyle(element).backgroundColor,
          text: (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100),
        }))
        .filter((entry) => isLightBackground(entry.background))
        .slice(0, 12),
    };
  }, selector);

  await gotoStable(page, '/trading');
  await expect(page.getByRole('heading', { name: '交易执行' })).toBeVisible();

  await page.getByRole('tab', { name: '信号下单' }).click();
  await page.getByRole('button', { name: /将信号 1 转入下单确认/ }).click();
  await expect(page.locator('.order-confirm-modal')).toBeVisible();
  await expect(page.getByTestId('risk-confirm-content')).toBeVisible();
  await page.waitForTimeout(300);
  const orderModalMetrics = await scanModalChrome('.order-confirm-modal');
  expect(orderModalMetrics.exists).toBeTruthy();
  expect(orderModalMetrics.width, '交易确认弹窗宽度未标准化').toBeGreaterThanOrEqual(640);
  expect(orderModalMetrics.width, '交易确认弹窗宽度过大').toBeLessThanOrEqual(760);
  expect(orderModalMetrics.bodyHeight, '交易确认弹窗内容高度异常').toBeLessThanOrEqual(620);
  expect(orderModalMetrics.maxSectionHeight, '交易确认弹窗信息块留白异常').toBeLessThanOrEqual(260);
  expect(orderModalMetrics.sectionHeightSpread, '交易确认弹窗信息块高度差异过大').toBeLessThanOrEqual(190);
  expect(orderModalMetrics.labelWidths.every((width) => width >= 104 && width <= 124), '交易确认弹窗描述标签宽度不统一').toBeTruthy();
  expect(orderModalMetrics.contentMinWidth, '交易确认弹窗描述内容列过窄').toBeGreaterThanOrEqual(420);
  expect(orderModalMetrics.buttonHeights.every((height) => height >= 26 && height <= 30)).toBeTruthy();
  expect(orderModalMetrics.leaks, '交易确认弹窗存在默认浅色背景泄漏').toEqual([]);
  expect(await scanActionableBlockers(page, '.order-confirm-modal'), '交易确认弹窗存在可操作元素遮挡').toEqual([]);
  await page.screenshot({ path: '../docs/reports/screenshots/qa_trading_order_confirm_modal_fixture_20260519.png', fullPage: false });
  await page.getByRole('button', { name: /取\s*消|取消/ }).click();
  await expect(page.locator('.order-confirm-modal')).toBeHidden();

  const tradingTabs = [
    { tab: '信号下单', testId: 'table-trading-signals' },
    { tab: '当前持仓', testId: 'table-trading-positions' },
    { tab: '委托记录', testId: 'table-trading-orders' },
    { tab: '成交记录', testId: 'table-trading-trades' },
    { tab: '执行日志', testId: 'table-trading-logs' },
  ];

  for (const item of tradingTabs) {
    await page.getByRole('tab', { name: item.tab }).click();
    await expect(page.getByTestId(item.testId)).toBeVisible();
    const metrics = await scanTable(item.testId);
    expect(metrics.leaks, `交易执行 ${item.tab} 表格出现默认浅色背景泄漏`).toEqual([]);
    expect(metrics.pagerLeaks, `交易执行 ${item.tab} 分页区出现默认浅色背景泄漏`).toEqual([]);
    expect(metrics.pagerMaxHeight, `交易执行 ${item.tab} 分页栏高度异常`).toBeLessThanOrEqual(38);
    expect(metrics.pagerMaxControlHeight, `交易执行 ${item.tab} 分页控件高度异常`).toBeLessThanOrEqual(30);
    expect(metrics.stickyTrackMaxHeight, `交易执行 ${item.tab} 横向滚动轨道高度异常`).toBeLessThanOrEqual(12);
    expect(metrics.stickyBarMaxHeight, `交易执行 ${item.tab} 横向滚动滑块高度异常`).toBeLessThanOrEqual(10);
    expect(metrics.overflow, `交易执行 ${item.tab} 表格越出页面右边界`).toBeLessThanOrEqual(1);
    expect(metrics.maxRowHeight, `交易执行 ${item.tab} 表格行高异常`).toBeLessThanOrEqual(96);
    expect(await scanTableColumnContract(page, item.testId), `交易执行 ${item.tab} 高频表格列宽语义未收口`).toEqual([]);
    if (metrics.maxActionWidth > 0) {
      expect(metrics.fixedActionCells, `交易执行 ${item.tab} 操作列未固定在右侧`).toBeGreaterThan(0);
      expect(metrics.maxActionWidth, `交易执行 ${item.tab} 操作列过宽`).toBeLessThanOrEqual(190);
      expect(metrics.maxButtonHeight, `交易执行 ${item.tab} 操作按钮高度异常`).toBeLessThanOrEqual(30);
    }
  }

  await page.getByRole('tab', { name: '委托记录' }).click();
  await page.screenshot({ path: '../docs/reports/screenshots/qa_trading_deep_tables_fixture_20260519.png', fullPage: false });

  await gotoStable(page, '/data-center');
  await expect(page.getByRole('heading', { name: '数据中心' })).toBeVisible();

  const dataTabs = [
    { tab: '数据同步', testId: 'table-sync-tasks' },
    { tab: '数据质量', testId: 'table-quality' },
    { tab: '数据质量', testId: 'table-account-duplicates' },
    { tab: '数据字典', testId: 'table-dictionary' },
  ];

  for (const item of dataTabs) {
    await page.getByRole('tab', { name: item.tab }).click();
    await expect(page.getByTestId(item.testId)).toBeVisible();
    const metrics = await scanTable(item.testId);
    expect(metrics.leaks, `数据中心 ${item.testId} 表格出现默认浅色背景泄漏`).toEqual([]);
    expect(metrics.pagerLeaks, `数据中心 ${item.testId} 分页区出现默认浅色背景泄漏`).toEqual([]);
    expect(metrics.pagerMaxHeight, `数据中心 ${item.testId} 分页栏高度异常`).toBeLessThanOrEqual(38);
    expect(metrics.pagerMaxControlHeight, `数据中心 ${item.testId} 分页控件高度异常`).toBeLessThanOrEqual(30);
    expect(metrics.stickyTrackMaxHeight, `数据中心 ${item.testId} 横向滚动轨道高度异常`).toBeLessThanOrEqual(12);
    expect(metrics.stickyBarMaxHeight, `数据中心 ${item.testId} 横向滚动滑块高度异常`).toBeLessThanOrEqual(10);
    expect(metrics.overflow, `数据中心 ${item.testId} 表格越出页面右边界`).toBeLessThanOrEqual(1);
    expect(metrics.maxRowHeight, `数据中心 ${item.testId} 表格行高异常`).toBeLessThanOrEqual(96);
    expect(await scanTableColumnContract(page, item.testId), `数据中心 ${item.testId} 表格列宽语义未收口`).toEqual([]);
    if (metrics.maxActionWidth > 0) {
      expect(metrics.fixedActionCells, `数据中心 ${item.testId} 操作列未固定在右侧`).toBeGreaterThan(0);
      expect(metrics.maxActionWidth, `数据中心 ${item.testId} 操作列过宽`).toBeLessThanOrEqual(190);
      expect(metrics.maxButtonHeight, `数据中心 ${item.testId} 操作按钮高度异常`).toBeLessThanOrEqual(30);
    }
  }

  await page.getByRole('tab', { name: '数据同步' }).click();
  await expect(page.locator('.data-sync-card-grid')).toBeVisible({ timeout: 15000 });
  const syncCardLeaks = await scanVisibleLightLeaks(page, '.data-sync-card-grid');
  expect(syncCardLeaks, '数据中心同步卡片矩阵出现默认浅色背景泄漏').toEqual([]);
  const syncCardMetrics = await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('.data-sync-card-grid');
    const buttons = root ? Array.from(root.querySelectorAll<HTMLElement>('.ant-btn')) : [];
    const disabledButtons = buttons.filter((button) => button.hasAttribute('disabled'));
    return {
      buttonCount: buttons.length,
      disabledCount: disabledButtons.length,
      maxButtonHeight: buttons.reduce((max, button) => Math.max(max, Math.round(button.getBoundingClientRect().height)), 0),
      gridHeight: root ? Math.round(root.getBoundingClientRect().height) : 0,
    };
  });
  expect(syncCardMetrics.buttonCount, '数据同步卡片矩阵缺少操作按钮').toBeGreaterThanOrEqual(4);
  expect(syncCardMetrics.maxButtonHeight, '数据同步卡片按钮高度失控').toBeLessThanOrEqual(32);
  expect(syncCardMetrics.gridHeight, '数据同步卡片矩阵高度过大').toBeLessThanOrEqual(420);
  await page.screenshot({ path: '../docs/reports/screenshots/qa_data_center_deep_tables_fixture_20260519.png', fullPage: false });
});

test('数据中心低频表格和系统运行监控保持终端标准', async ({ page }) => {
  const pageResult = <T,>(items: T[]) => ({
    items,
    page: 1,
    page_size: 20,
    total: items.length,
    has_more: false,
  });
  const longDataCenterText = '数据中心长文本核验：这里包含覆盖率建议、同步边界、真实 QMT 只读说明和下一步操作，必须两行截断且悬停后完整显示，不能被表格列宽直接截没。';

  const scanSurface = async (selector: string) => page.evaluate((currentSelector) => {
    const root = document.querySelector<HTMLElement>(currentSelector);
    if (!root) {
      return {
        exists: false,
        overflow: 0,
        maxRowHeight: 0,
        maxButtonHeight: 0,
        leaks: [{ className: 'missing-surface', background: 'none', text: currentSelector }],
      };
    }
    const isVisible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 12
        && rect.height > 6
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.bottom >= 0
        && rect.right >= 0
        && rect.top <= window.innerHeight
        && rect.left <= window.innerWidth;
    };
    const isLightBackground = (background: string) => {
      const match = background.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (!match) return false;
      const [, red, green, blue, alpha = '1'] = match;
      return Number(alpha) > 0.35 && Number(red) > 235 && Number(green) > 235 && Number(blue) > 235;
    };
    const rect = root.getBoundingClientRect();
    const rows = Array.from(root.querySelectorAll<HTMLElement>('.ant-table-row'));
    const buttons = Array.from(root.querySelectorAll<HTMLElement>('.ant-btn'));
    const leaks = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))]
      .filter(isVisible)
      .map((element) => ({
        className: String((element as HTMLElement).className || '').slice(0, 140),
        background: window.getComputedStyle(element).backgroundColor,
        text: (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100),
      }))
      .filter((entry) => isLightBackground(entry.background))
      .slice(0, 12);
    return {
      exists: true,
      overflow: Math.max(0, Math.round(rect.right - document.documentElement.clientWidth)),
      maxRowHeight: rows.reduce((max, row) => Math.max(max, Math.round(row.getBoundingClientRect().height)), 0),
      maxButtonHeight: buttons.reduce((max, button) => Math.max(max, Math.round(button.getBoundingClientRect().height)), 0),
      leaks,
    };
  }, selector);

  const scanTable = async (testId: string) => page.evaluate((currentTestId) => {
    const root = document.querySelector<HTMLElement>(`[data-testid="${currentTestId}"]`);
    if (!root) {
      return {
        exists: false,
        overflow: 0,
        maxRowHeight: 0,
        maxActionWidth: 0,
        maxButtonHeight: 0,
        columnContractIssues: [] as Array<{ text: string; width: number; className: string; reason: string }>,
        pagerMaxHeight: 0,
        pagerMaxControlHeight: 0,
        stickyTrackMaxHeight: 0,
        stickyBarMaxHeight: 0,
        pagerLeaks: [] as Array<{ className: string; background: string; text: string }>,
        leaks: [{ className: 'missing-table', background: 'none', text: currentTestId }],
      };
    }
    const isVisible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 12
        && rect.height > 6
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.bottom >= 0
        && rect.right >= 0
        && rect.top <= window.innerHeight
        && rect.left <= window.innerWidth;
    };
    const isLightBackground = (background: string) => {
      const match = background.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (!match) return false;
      const [, red, green, blue, alpha = '1'] = match;
      return Number(alpha) > 0.35 && Number(red) > 235 && Number(green) > 235 && Number(blue) > 235;
    };
    const leakEntries = (scope: ParentNode) => Array.from(scope.querySelectorAll<HTMLElement>('*'))
      .filter(isVisible)
      .map((element) => ({
        className: String(element.className || '').slice(0, 140),
        background: window.getComputedStyle(element).backgroundColor,
        text: (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100),
      }))
      .filter((entry) => isLightBackground(entry.background))
      .slice(0, 12);
    const rect = root.getBoundingClientRect();
    const rows = Array.from(root.querySelectorAll<HTMLElement>('.ant-table-row'));
    const actionCells = Array.from(root.querySelectorAll<HTMLElement>('.data-table-col--action'));
    const buttons = Array.from(root.querySelectorAll<HTMLElement>('.data-table-col--action .ant-btn'));
    const pager = root.querySelector<HTMLElement>('.ant-pagination');
    const pagerControls = pager
      ? Array.from(pager.querySelectorAll<HTMLElement>('.ant-pagination-item, .ant-pagination-prev, .ant-pagination-next, .ant-select-selector, .ant-pagination-options-quick-jumper input')).filter(isVisible)
      : [];
    const stickyTracks = Array.from(root.querySelectorAll<HTMLElement>('.ant-table-sticky-scroll')).filter(isVisible);
    const stickyBars = Array.from(root.querySelectorAll<HTMLElement>('.ant-table-sticky-scroll-bar')).filter(isVisible);
    const headers = Array.from(root.querySelectorAll<HTMLElement>('th')).filter(isVisible).map((header) => {
      const text = (header.textContent || '').trim().replace(/\s+/g, '');
      const className = String(header.className || '');
      return {
        text,
        className,
        width: Math.round(header.getBoundingClientRect().width),
      };
    });
    const longTextHeaders = new Set(['说明', '建议', '备注', '边界说明', '缺失日期', '策略使用', '中文含义', '官方接口', '当前说明']);
    const compactHeaders = new Set(['状态', '结果', '单位', '索引', '周期', '优先级', '分类', '来源']);
    const columnContractIssues = headers.flatMap((header) => {
      const issues: Array<{ text: string; width: number; className: string; reason: string }> = [];
      const isRightFixed = header.className.includes('ant-table-cell-fix-right');
      if (longTextHeaders.has(header.text) && header.width < 260) {
        issues.push({ ...header, reason: '长文本列宽不足，容易截断中文说明或排障建议' });
      }
      if (compactHeaders.has(header.text) && header.width > 140) {
        issues.push({ ...header, reason: '短状态列过宽，挤占有效信息区' });
      }
      if ((header.text === '详情' || header.text === '诊断' || (header.text === '操作' && isRightFixed)) && !header.className.includes('data-table-col--action')) {
        issues.push({ ...header, reason: '右侧按钮列缺少统一操作列语义' });
      }
      if (header.text === '操作' && !isRightFixed && header.width > 130) {
        issues.push({ ...header, reason: '业务操作字段不应占用右侧按钮列宽' });
      }
      return issues;
    });
    return {
      exists: true,
      overflow: Math.max(0, Math.round(rect.right - document.documentElement.clientWidth)),
      maxRowHeight: rows.reduce((max, row) => Math.max(max, Math.round(row.getBoundingClientRect().height)), 0),
      maxActionWidth: actionCells.reduce((max, cell) => Math.max(max, Math.round(cell.getBoundingClientRect().width)), 0),
      maxButtonHeight: buttons.reduce((max, button) => Math.max(max, Math.round(button.getBoundingClientRect().height)), 0),
      columnContractIssues,
      pagerMaxHeight: pager ? Math.round(pager.getBoundingClientRect().height) : 0,
      pagerMaxControlHeight: pagerControls.reduce((max, control) => Math.max(max, Math.round(control.getBoundingClientRect().height)), 0),
      stickyTrackMaxHeight: stickyTracks.reduce((max, track) => Math.max(max, Math.round(track.getBoundingClientRect().height)), 0),
      stickyBarMaxHeight: stickyBars.reduce((max, bar) => Math.max(max, Math.round(bar.getBoundingClientRect().height)), 0),
      pagerLeaks: pager ? leakEntries(pager) : [],
      leaks: leakEntries(root),
    };
  }, testId);

  await page.route('**/api/data/sources/qmt/status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '视觉回归真实 QMT 只读状态',
        data: {
          source_code: 'qmt',
          source_name: 'MiniQMT',
          mode: 'real_readonly',
          connected: true,
          account_id: 'demo_account',
          qmt_path: 'D:\\MiniQMT\\demo',
          xtquant_installed: true,
          last_connected_at: '2026-05-19 15:30:00',
          message: '测试隔离返回真实只读样式，不触发真实 QMT。',
        },
        error: null,
        trace_id: 'visual-low-frequency-qmt',
      }),
    });
  });
  await page.route('**/api/data/account/latest', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取账户快照成功',
        data: {
          id: 1,
          account_id: 'demo_account',
          total_asset: 5381.5,
          available_cash: 0,
          frozen_cash: 0,
          market_value: 5381.5,
          today_pnl: 0,
          snapshot_time: '2026-05-19 15:30:00',
        },
        error: null,
        trace_id: 'visual-low-frequency-account',
      }),
    });
  });
  await page.route('**/api/data/quality/summary', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '质量摘要成功',
        data: { success_count: 8, warning_count: 1, failed_count: 0, latest_check_time: '2026-05-19 15:20:00', is_stale: false, stale_reason: null },
        error: null,
        trace_id: 'visual-low-frequency-quality-summary',
      }),
    });
  });
  await page.route('**/api/data/freshness/summary', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '数据新鲜度成功',
        data: {
          target_trade_date: '2026-05-18',
          generated_at: '2026-05-19 15:30:00',
          overall_status: 'warning',
          stale_count: 1,
          warning_count: 1,
          next_actions: ['核对分钟K覆盖率', '补齐最新成交日数据'],
          items: [
            { key: 'daily_kline', name: '日K', table_name: 'daily_kline', latest_date: '2026-05-18', target_date: '2026-05-18', lag_days: 0, status: 'success', message: `日K已覆盖目标交易日。${longDataCenterText}`, suggestion: `可进入回测前覆盖率核对。${longDataCenterText}`, coverage_status: 'complete', coverage_rate: 100, actual_rows: 441039 },
            { key: 'minute_kline', name: '分钟K', table_name: 'minute_kline', latest_time: '2026-05-18 14:59:00', target_date: '2026-05-18', lag_days: 0, status: 'warning', message: `分钟K需要按策略区间复核。${longDataCenterText}`, suggestion: `正式分钟回测前执行覆盖率检查。${longDataCenterText}`, coverage_status: 'complete', coverage_rate: 99.8, actual_rows: 99800121 },
          ],
        },
        error: null,
        trace_id: 'visual-low-frequency-freshness',
      }),
    });
  });
  await page.route('**/api/data/catalog/official', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '官方目录成功',
        data: {
          source: 'qmt',
          account_type: 'normal_stock',
          account_type_label: '普通股票账户',
          has_l2: false,
          has_credit: false,
          limitation_note: '不含 Level2、信用账户、外部数据源。',
          unsupported_items: ['Level2 行情', '信用账户融资融券', '外部宏观数据'],
          items: [
            { data_type: 'daily_kline', name: '日K数据', category: '行情数据', source_module: 'xtdata', official_interface: 'download_history_data2', local_table: 'daily_kline', enabled: true, required_for_backtest: true, priority: 'P0', account_boundary: '普通股票账户可用', sync_frequency: '盘后补齐', notes: '用于日线回测和市值筛选。' },
            { data_type: 'minute_kline', name: '1分钟K数据', category: '行情数据', source_module: 'xtdata', official_interface: 'download_history_data2', local_table: 'minute_kline', enabled: true, required_for_backtest: true, priority: 'P0', account_boundary: '普通股票账户可用', sync_frequency: '显式长任务', notes: '用于分钟级策略回测。' },
          ],
        },
        error: null,
        trace_id: 'visual-low-frequency-catalog',
      }),
    });
  });
  await page.route('**/api/data/sync/coverage-2026**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '覆盖率成功',
        data: pageResult([
          { id: 1, data_type: 'daily_kline', symbol: 'ALL', period: '1d', start_date: '2026-01-01', end_date: '2026-05-18', expected_trading_days: 89, actual_trading_days: 89, expected_rows: 441039, actual_rows: 441039, missing_days: '[]', duplicate_rows: 0, coverage_rate: 100, status: 'complete', checked_at: '2026-05-19 15:20:00' },
          { id: 2, data_type: 'minute_kline', symbol: 'ALL', period: '1m', start_date: '2026-01-01', end_date: '2026-05-18', expected_trading_days: 88, actual_trading_days: 88, expected_rows: 100000000, actual_rows: 99800121, missing_days: '[]', duplicate_rows: 0, coverage_rate: 99.8, status: 'complete', checked_at: '2026-05-19 15:22:00' },
        ]),
        error: null,
        trace_id: 'visual-low-frequency-coverage',
      }),
    });
  });
  await page.route('**/api/data/sync/tasks**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '同步任务成功',
        data: pageResult([{ task_id: 'task_visual_low_frequency', sync_type: 'sync_latest_data', status: 'success', total_count: 5000, success_count: 5000, failed_count: 0, progress: 100, message: '最新交易日补齐完成', technical_detail: '{}', started_at: '2026-05-19 09:00:00', finished_at: '2026-05-19 09:31:00' }]),
        error: null,
        trace_id: 'visual-low-frequency-sync-tasks',
      }),
    });
  });
  await page.route('**/api/data/stocks**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '股票基础成功',
        data: pageResult([{ id: 1, symbol: '600000.SH', name: '浦发银行', market: 'SH', security_type: 'stock', list_status: '上市', is_st: false, updated_at: '2026-05-19 15:30:00' }]),
        error: null,
        trace_id: 'visual-low-frequency-stocks',
      }),
    });
  });
  await page.route('**/api/data/kline/daily**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '日K成功',
        data: pageResult([{ id: 1, symbol: '600000.SH', trade_date: '2026-05-18', open: 10.1, high: 10.5, low: 10.0, close: 10.25, volume: 1200000, amount: 12300000, created_at: '2026-05-19 15:30:00' }]),
        error: null,
        trace_id: 'visual-low-frequency-daily',
      }),
    });
  });
  await page.route('**/api/data/kline/minute**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '分钟K成功',
        data: pageResult([{ id: 1, symbol: '600000.SH', datetime: '2026-05-18 09:31:00', period: '1m', open: 10.1, high: 10.2, low: 10.08, close: 10.18, volume: 350000, amount: 3560000, created_at: '2026-05-19 15:30:00' }]),
        error: null,
        trace_id: 'visual-low-frequency-minute',
      }),
    });
  });
  await page.route('**/api/data/basic/instruments**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '合约基础成功',
        data: pageResult([{ id: 1, symbol: '600000.SH', exchange_id: 'SH', instrument_id: '600000', instrument_name: '浦发银行', exchange_code: 'SH', open_date: '1999-11-10', expire_date: null, pre_close: 10.1, up_stop_price: 11.11, down_stop_price: 9.09, is_trading: true, instrument_status: '正常', total_volume: 29352080397, float_volume: 29352080397, trading_day: '2026-05-18', raw_json: '{}', sync_time: '2026-05-19 15:30:00' }]),
        error: null,
        trace_id: 'visual-low-frequency-instruments',
      }),
    });
  });
  await page.route('**/api/data/basic/trading-calendar**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '交易日历成功',
        data: pageResult([{ id: 1, market: 'SH', trade_date: '2026-05-18', is_trading_day: true, source: 'qmt', sync_time: '2026-05-19 15:30:00' }]),
        error: null,
        trace_id: 'visual-low-frequency-calendar',
      }),
    });
  });
  await page.route('**/api/data/quality/results**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '质量检查成功',
        data: pageResult([{
          id: 1,
          check_type: 'minute_coverage_window',
          target_table: 'minute_kline',
          status: 'warning',
          message: `分钟K覆盖率需要按策略区间复核。${longDataCenterText}`,
          suggestion: `正式分钟回测前重新执行覆盖率检查。${longDataCenterText}`,
          created_at: '2026-05-19 15:35:00',
        }]),
        error: null,
        trace_id: 'visual-low-frequency-quality',
      }),
    });
  });
  await page.route('**/api/data/quality/account-snapshot-duplicates**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '账户重复检查成功',
        data: pageResult([{ account_id: 'demo_account', snapshot_time: '2026-05-19 15:30:00', duplicate_count: 2, min_id: 1, max_id: 2, min_total_asset: 5381.5, max_total_asset: 5381.5, min_available_cash: 0, max_available_cash: 0 }]),
        error: null,
        trace_id: 'visual-low-frequency-account-duplicates',
      }),
    });
  });
  await page.route('**/api/data/dictionary**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '数据字典成功',
        data: pageResult([{
          id: 1,
          table_name: 'minute_kline',
          field_name: 'amount',
          field_type: 'REAL',
          description: `1分钟K成交额，单位元。${longDataCenterText}`,
          unit: '元',
          example_value: '52300000',
          strategy_usage: `开盘放量、量比和成交额过滤必须通过 StrategyContext 读取。${longDataCenterText}`,
          is_indexed: true,
        }]),
        error: null,
        trace_id: 'visual-low-frequency-dictionary',
      }),
    });
  });

  await gotoStable(page, '/data-center');
  await expect(page.getByRole('heading', { name: '数据中心' })).toBeVisible();
  await expect(page.getByTestId('table-data-freshness')).toBeVisible();

  for (const testId of ['table-data-freshness', 'table-coverage-2026', 'table-official-catalog']) {
    const metrics = await scanTable(testId);
    expect(metrics.exists, `${testId} 未渲染`).toBeTruthy();
    expect(metrics.leaks, `${testId} 存在默认浅色背景泄漏`).toEqual([]);
    expect(metrics.pagerLeaks, `${testId} 分页区存在默认浅色背景泄漏`).toEqual([]);
    expect(metrics.pagerMaxHeight, `${testId} 分页栏高度异常`).toBeLessThanOrEqual(38);
    expect(metrics.pagerMaxControlHeight, `${testId} 分页控件高度异常`).toBeLessThanOrEqual(30);
    expect(metrics.stickyTrackMaxHeight, `${testId} 横向滚动轨道高度异常`).toBeLessThanOrEqual(12);
    expect(metrics.stickyBarMaxHeight, `${testId} 横向滚动滑块高度异常`).toBeLessThanOrEqual(10);
    expect(metrics.columnContractIssues, `${testId} 列宽或操作列语义未收口`).toEqual([]);
    expect(metrics.overflow, `${testId} 越出页面右边界`).toBeLessThanOrEqual(1);
    expect(metrics.maxRowHeight, `${testId} 行高异常`).toBeLessThanOrEqual(96);
    if (metrics.maxActionWidth > 0) {
      expect(metrics.maxActionWidth, `${testId} 操作列过宽`).toBeLessThanOrEqual(190);
      expect(metrics.maxButtonHeight, `${testId} 操作按钮高度异常`).toBeLessThanOrEqual(30);
    }
  }
  await page
    .locator('[data-testid="table-data-freshness"] .data-center-long-text')
    .filter({ hasText: '数据中心长文本核验' })
    .first()
    .hover();
  await expect(page.locator('.data-center-long-text-tooltip').filter({ hasText: '数据中心长文本核验' }).first()).toBeVisible();
  const messageCellMetrics = await page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="table-data-freshness"] td.data-table-col--message[title]'));
    return {
      count: cells.length,
      hasLongTextTitle: cells.some((cell) => (cell.getAttribute('title') ?? '').includes('数据中心长文本核验')),
      helpCursorCount: cells.filter((cell) => window.getComputedStyle(cell).cursor === 'help').length,
    };
  });
  expect(messageCellMetrics.count, '数据中心说明/建议列应带原生 title，便于复制和排障').toBeGreaterThan(0);
  expect(messageCellMetrics.hasLongTextTitle, '长说明单元格 title 未包含完整文本').toBeTruthy();
  expect(messageCellMetrics.helpCursorCount, '长说明单元格应显示 help 光标').toBeGreaterThan(0);

  await page.getByRole('tab', { name: '行情数据' }).click();
  await expect(page.getByTestId('data-market-evidence-board')).toBeVisible();
  await expect(page.getByTestId('data-market-evidence-board')).toContainText('覆盖门禁');
  expect(await scanVisibleLightLeaks(page, '[data-testid="data-market-evidence-board"]'), '行情数据证据板出现浅色泄漏').toEqual([]);
  await expect(page.locator('.market-kline-workbench')).toBeVisible();
  for (const selector of ['.market-kline-workbench', '.market-kline-side-panel']) {
    const metrics = await scanSurface(selector);
    expect(metrics.exists, `${selector} 未渲染`).toBeTruthy();
    expect(metrics.leaks, `${selector} 存在默认浅色背景泄漏`).toEqual([]);
    expect(metrics.overflow, `${selector} 越出页面右边界`).toBeLessThanOrEqual(1);
  }
  for (const testId of ['table-stocks', 'table-daily-kline']) {
    await expect(page.getByTestId(testId)).toBeVisible();
    const metrics = await scanTable(testId);
    expect(metrics.leaks, `${testId} 存在默认浅色背景泄漏`).toEqual([]);
    expect(metrics.pagerLeaks, `${testId} 分页区存在默认浅色背景泄漏`).toEqual([]);
    expect(metrics.columnContractIssues, `${testId} 列宽或操作列语义未收口`).toEqual([]);
    expect(metrics.overflow, `${testId} 越出页面右边界`).toBeLessThanOrEqual(1);
    expect(metrics.maxRowHeight, `${testId} 行高异常`).toBeLessThanOrEqual(96);
  }

  await page.getByRole('tab', { name: '基础资料' }).click();
  await expect(page.getByTestId('data-basic-evidence-board')).toBeVisible();
  await expect(page.getByTestId('data-basic-evidence-board')).toContainText('交易日历');
  expect(await scanVisibleLightLeaks(page, '[data-testid="data-basic-evidence-board"]'), '基础资料证据板出现浅色泄漏').toEqual([]);
  for (const testId of ['table-instrument-detail', 'table-trading-calendar']) {
    await expect(page.getByTestId(testId)).toBeVisible();
    const metrics = await scanTable(testId);
    expect(metrics.leaks, `${testId} 存在默认浅色背景泄漏`).toEqual([]);
    expect(metrics.pagerLeaks, `${testId} 分页区存在默认浅色背景泄漏`).toEqual([]);
    expect(metrics.columnContractIssues, `${testId} 列宽或操作列语义未收口`).toEqual([]);
    expect(metrics.overflow, `${testId} 越出页面右边界`).toBeLessThanOrEqual(1);
    expect(metrics.maxRowHeight, `${testId} 行高异常`).toBeLessThanOrEqual(96);
  }

  await page.getByRole('tab', { name: '数据同步' }).click();
  await expect(page.getByTestId('table-sync-tasks')).toBeVisible();
  const syncTaskMetrics = await scanTable('table-sync-tasks');
  expect(syncTaskMetrics.leaks, '同步任务表格存在默认浅色背景泄漏').toEqual([]);
  expect(syncTaskMetrics.pagerLeaks, '同步任务表格分页区存在默认浅色背景泄漏').toEqual([]);
  expect(syncTaskMetrics.columnContractIssues, '同步任务表格列宽或诊断列语义未收口').toEqual([]);
  expect(syncTaskMetrics.overflow, '同步任务表格越出页面右边界').toBeLessThanOrEqual(1);
  expect(syncTaskMetrics.maxRowHeight, '同步任务表格行高异常').toBeLessThanOrEqual(96);

  await page.getByRole('tab', { name: '数据质量' }).click();
  for (const testId of ['table-quality', 'table-account-duplicates']) {
    await expect(page.getByTestId(testId)).toBeVisible();
    const metrics = await scanTable(testId);
    expect(metrics.leaks, `${testId} 存在默认浅色背景泄漏`).toEqual([]);
    expect(metrics.pagerLeaks, `${testId} 分页区存在默认浅色背景泄漏`).toEqual([]);
    expect(metrics.columnContractIssues, `${testId} 列宽或操作列语义未收口`).toEqual([]);
    expect(metrics.overflow, `${testId} 越出页面右边界`).toBeLessThanOrEqual(1);
    expect(metrics.maxRowHeight, `${testId} 行高异常`).toBeLessThanOrEqual(96);
  }

  await page.getByRole('tab', { name: '数据字典' }).click();
  await expect(page.getByTestId('table-dictionary')).toBeVisible();
  const dictionaryMetrics = await scanTable('table-dictionary');
  expect(dictionaryMetrics.leaks, '数据字典表格存在默认浅色背景泄漏').toEqual([]);
  expect(dictionaryMetrics.pagerLeaks, '数据字典表格分页区存在默认浅色背景泄漏').toEqual([]);
  expect(dictionaryMetrics.columnContractIssues, '数据字典表格列宽或操作列语义未收口').toEqual([]);
  expect(dictionaryMetrics.overflow, '数据字典表格越出页面右边界').toBeLessThanOrEqual(1);
  expect(dictionaryMetrics.maxRowHeight, '数据字典表格行高异常').toBeLessThanOrEqual(96);

  await page.route('**/api/system/config', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '配置成功',
        data: {
          qmt_path: 'D:\\MiniQMT\\demo',
          account_id: 'demo_account',
          database_path: 'C:\\LocalQuantConsole\\data\\local_quant_console.db',
          strategy_dir: 'C:\\LocalQuantConsole\\strategies\\user',
          backup_dir: 'C:\\LocalQuantConsole\\backups',
          auto_connect: true,
          auto_sync: true,
          default_order_amount: 10000,
          max_order_amount: 100000,
          order_confirm_required: true,
          default_order_type: '限价委托',
          price_offset: 0,
          simulation_mode: false,
          strategy_timeout_seconds: 300,
          strategy_run_interval_seconds: 30,
          intraday_auto_run: false,
          strategy_log_level: 'info',
          strategy_max_log_mb: 50,
          log_retention_days: 30,
          task_retention_days: 30,
        },
        error: null,
        trace_id: 'visual-system-config',
      }),
    });
  });
  await page.route('**/api/system/env/results**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '环境检测成功',
        data: [{ id: 1, task_id: 'env_visual', check_item: '真实 QMT 只读连接', status: 'success', message: '已连接真实 QMT 只读链路', suggestion: '继续保持人工确认下单', technical_detail: 'visual isolation', created_at: '2026-05-19 15:30:00' }],
        error: null,
        trace_id: 'visual-system-env',
      }),
    });
  });
  await page.route('**/api/system/logs**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '日志成功',
        data: pageResult([{ id: 1, module: 'system', level: 'error', message: '视觉回归错误样例，用于最近错误列表。', technical_detail: 'trace=visual-monitor', related_id: 'visual', created_at: '2026-05-19 15:20:00' }]),
        error: null,
        trace_id: 'visual-system-logs',
      }),
    });
  });
  await page.route('**/api/system/monitor', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '监控成功',
        data: {
          running_task_count: 1,
          failed_task_count: 0,
          historical_failed_task_count: 19,
          database_size_bytes: 204800000,
          log_size_bytes: 4096000,
          backup_count: 3,
          recent_errors: [{ id: 1, module: 'data', level: 'error', message: '覆盖率检查提醒：分钟K需复核。', technical_detail: 'visual-monitor-error', related_id: 'coverage', created_at: '2026-05-19 15:20:00' }],
          slow_tasks: [{ task_id: 'task_visual_slow', task_type: 'backtest', status: 'running', progress: 62, message: '分钟回测推演中', technical_detail: 'minute replay', created_at: '2026-05-19 15:00:00', started_at: '2026-05-19 15:00:01', finished_at: null }],
        },
        error: null,
        trace_id: 'visual-system-monitor',
      }),
    });
  });
  await page.route('**/api/system/startup-check', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '启动检查成功',
        data: {
          app_name: 'Local Quant Console',
          version: '0.1.0',
          checked_at: '2026-05-19 15:30:00',
          overall_status: 'success',
          items: [
            { check_item: '后端服务', status: 'success', message: 'FastAPI 已启动', suggestion: '保持一键启动脚本运行', technical_detail: 'port=8000' },
            { check_item: 'SQLite WAL', status: 'success', message: 'WAL 已启用', suggestion: '无需处理', technical_detail: 'journal_mode=WAL' },
          ],
        },
        error: null,
        trace_id: 'visual-system-startup',
      }),
    });
  });
  await page.route('**/api/system/backups**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, message: '备份成功', data: pageResult([]), error: null, trace_id: 'visual-system-backups' }),
    });
  });
  await page.route('**/api/system/operations**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, message: '操作成功', data: pageResult([]), error: null, trace_id: 'visual-system-operations' }),
    });
  });

  await gotoStable(page, '/system?tab=运行监控');
  await expect(page.getByRole('heading', { name: '系统管理' })).toBeVisible();
  await expect(page.getByRole('tab', { name: '运行监控', selected: true })).toBeVisible();
  for (const selector of ['.monitor-health-grid', '.recent-error-list']) {
    const metrics = await scanSurface(selector);
    expect(metrics.exists, `${selector} 未渲染`).toBeTruthy();
    expect(metrics.leaks, `${selector} 存在默认浅色背景泄漏`).toEqual([]);
    expect(metrics.overflow, `${selector} 越出页面右边界`).toBeLessThanOrEqual(1);
  }
  await expect(page.getByTestId('table-startup-check')).toBeVisible();
  const startupMetrics = await scanTable('table-startup-check');
  expect(startupMetrics.leaks, '启动健康检查表格存在默认浅色背景泄漏').toEqual([]);
  expect(startupMetrics.overflow, '启动健康检查表格越出页面右边界').toBeLessThanOrEqual(1);
  expect(startupMetrics.maxRowHeight, '启动健康检查表格行高异常').toBeLessThanOrEqual(96);

  await page.screenshot({ path: '../docs/reports/screenshots/qa_low_frequency_tables_monitor_fixture_20260519.png', fullPage: false });
});

test('策略开发编辑器工作台文件栏、代码区和运行面板保持终端标准', async ({ page }) => {
  const pageResult = <T,>(items: T[]) => ({
    items,
    page: 1,
    page_size: 20,
    total: items.length,
    has_more: false,
  });

  const strategyFile = {
    id: 1,
    file_name: 'visual_strategy.py',
    file_path: 'C:/LocalQuantConsole/strategies/user/visual_strategy.py',
    strategy_name: '视觉回归策略',
    version: '1.0.0',
    description: '只用于前端视觉回归的隔离策略记录。',
    status: 'enabled',
    last_modified_at: '2026-05-19 15:00:00',
    last_run_at: '2026-05-19 15:10:00',
    created_at: '2026-05-19 14:00:00',
    today_signal_count: 3,
  };
  const run = {
    id: 1,
    run_id: 'run_visual_strategy_001',
    strategy_id: 1,
    task_id: 'task_visual_strategy_001',
    status: 'success',
    signal_count: 3,
    started_at: '2026-05-19 15:10:00',
    finished_at: '2026-05-19 15:10:05',
    message: '策略运行成功，生成 3 条信号。',
    technical_detail: 'visual regression run detail',
  };
  const version = {
    id: 1,
    strategy_id: 1,
    version_no: 'v202605191510',
    code_hash: 'abcdef1234567890abcdef1234567890',
    remark: '视觉回归快照',
    created_at: '2026-05-19 15:10:00',
  };

  await page.route('**/api/strategies/**', async (route) => {
    const url = new URL(route.request().url());
    let data: unknown = null;

    if (url.pathname === '/api/strategies/files') {
      data = pageResult([strategyFile]);
    } else if (url.pathname === '/api/strategies/runs') {
      data = pageResult([run]);
    } else if (url.pathname === '/api/strategies/signals') {
      data = pageResult([{
        id: 1,
        strategy_id: 1,
        run_id: run.run_id,
        strategy_name: strategyFile.strategy_name,
        symbol: '600000.SH',
        name: '浦发银行',
        action: 'BUY',
        price: 10.25,
        amount: 10000,
        reason: '视觉回归信号，验证表格和抽屉样式。',
        status: 'pending',
        signal_time: '2026-05-19 10:15:00',
        created_at: '2026-05-19 10:15:01',
      }]);
    } else if (url.pathname === '/api/strategies/files/1/content') {
      data = {
        strategy_id: 1,
        file_name: strategyFile.file_name,
        code_content: [
          'class Strategy:',
          '    name = "视觉回归策略"',
          '    version = "1.0.0"',
          '    description = "仅用于前端视觉回归"',
          '    params = {}',
          '',
          '    def __init__(self, context):',
          '        self.context = context',
          '',
          '    def run(self):',
          '        self.context.log("visual regression")',
          '        return []',
        ].join('\n'),
      };
    } else if (url.pathname === '/api/strategies/1/versions') {
      data = pageResult([version]);
    } else if (url.pathname === '/api/strategies/versions/1') {
      data = { ...version, code_content: 'class Strategy:\n    def run(self):\n        return []\n' };
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, message: '视觉回归策略数据', data, error: null, trace_id: 'visual-strategy-workbench' }),
    });
  });

  await gotoStable(page, '/strategy-dev?tab=代码编辑');
  await expect(page.getByRole('heading', { name: '策略开发' })).toBeVisible();
  await expect(page.getByTestId('strategy-editor-workbench')).toBeVisible();
  await expect(page.getByTestId('strategy-file-rail')).toBeVisible();
  await expect(page.getByTestId('strategy-editor-toolbar')).toBeVisible();
  await expect(page.getByTestId('strategy-editor-shell')).toBeVisible();
  await expect(page.getByTestId('strategy-editor-terminal')).toBeVisible();
  await expect(page.getByTestId('strategy-editor-toolbar')).toContainText('只生成信号');

  const workbenchMetrics = await page.evaluate(() => {
    const selectors = [
      '[data-testid="strategy-editor-workbench"]',
      '[data-testid="strategy-file-rail"]',
      '[data-testid="strategy-editor-shell"]',
      '[data-testid="strategy-editor-terminal"]',
    ];
    const isVisible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 12
        && rect.height > 6
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.bottom >= 0
        && rect.right >= 0
        && rect.top <= window.innerHeight
        && rect.left <= window.innerWidth;
    };
    const isLightBackground = (background: string) => {
      const match = background.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (!match) return false;
      const [, red, green, blue, alpha = '1'] = match;
      return Number(alpha) > 0.35 && Number(red) > 235 && Number(green) > 235 && Number(blue) > 235;
    };
    return selectors.map((selector) => {
      const root = document.querySelector(selector);
      if (!root) return { selector, missing: true, overflow: 0, leaks: [{ className: 'missing-root', background: 'none', text: selector }] };
      const rect = root.getBoundingClientRect();
      const leaks = Array.from(root.querySelectorAll('*'))
        .filter(isVisible)
        .map((element) => ({
          className: String((element as HTMLElement).className || '').slice(0, 140),
          background: window.getComputedStyle(element).backgroundColor,
          text: (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100),
        }))
        .filter((entry) => isLightBackground(entry.background))
        .slice(0, 12);
      return {
        selector,
        missing: false,
        overflow: Math.max(0, Math.round(rect.right - document.documentElement.clientWidth)),
        leaks,
      };
    });
  });

  for (const item of workbenchMetrics) {
    expect(item.missing, `${item.selector} 未渲染`).toBeFalsy();
    expect(item.overflow, `${item.selector} 越出页面右边界`).toBeLessThanOrEqual(1);
    expect(item.leaks, `${item.selector} 出现默认浅色背景泄漏`).toEqual([]);
  }

  await page.getByRole('tab', { name: '策略文件' }).click();
  await expect(page.getByTestId('table-strategy-files')).toBeVisible();
  expect(await scanTableColumnContract(page, 'table-strategy-files'), '策略文件表格列宽语义未收口').toEqual([]);
  const strategyFileHierarchy = await page.evaluate(() => {
    const table = document.querySelector('[data-testid="table-strategy-files"]');
    const nameCell = table?.querySelector<HTMLElement>('.strategy-audit-cell-text');
    const fileCell = table?.querySelector<HTMLElement>('.strategy-audit-cell-code');
    const fileStyle = fileCell ? window.getComputedStyle(fileCell) : null;
    return {
      hasNameCell: Boolean(nameCell),
      hasFileCodeCell: Boolean(fileCell),
      fileFontSize: fileStyle?.fontSize ?? '',
      fileColor: fileStyle?.color ?? '',
      fileUsesTextClass: fileCell?.classList.contains('strategy-audit-cell-text') ?? false,
    };
  });
  expect(strategyFileHierarchy.hasNameCell, '策略名称必须有主文本层级').toBeTruthy();
  expect(strategyFileHierarchy.hasFileCodeCell, '策略文件名必须使用代码/弱化层级').toBeTruthy();
  expect(strategyFileHierarchy.fileUsesTextClass, '策略文件名不能和策略名称共用主文本样式').toBeFalsy();
  expect(Number.parseFloat(strategyFileHierarchy.fileFontSize), '策略文件名应比策略名称更克制').toBeLessThanOrEqual(12);

  await page.getByPlaceholder('当前页搜索策略名/文件名').fill('NO_MATCH_FOR_EMPTY_GUIDE_20260519');
  await expect(page.getByText('筛选无结果')).toBeVisible();
  await expect(page.getByText('当前筛选条件下暂无数据')).toBeVisible();
  await expect(page.getByText('请调整筛选条件或刷新重试；清除搜索和筛选后会恢复当前页数据。')).toBeVisible();
  await page.getByPlaceholder('当前页搜索策略名/文件名').fill('');

  const strategyMoreButtons = page.getByRole('button', { name: '更多' });
  expect(await strategyMoreButtons.count()).toBeGreaterThan(0);
  await strategyMoreButtons.first().click();
  await expect(page.locator('.ant-dropdown')).toBeVisible();
  expect(await scanVisibleLightLeaks(page, '.ant-dropdown')).toEqual([]);
  await expect(page.getByText('删除策略', { exact: true })).toBeVisible();
  await page.getByText('删除策略', { exact: true }).click();
  await expect(page.locator('.strategy-confirm-modal')).toBeVisible();
  expect(await scanVisibleLightLeaks(page, '.strategy-confirm-modal')).toEqual([]);
  await page.getByRole('button', { name: /取\s*消|取消/ }).click();
  await expect(page.locator('.strategy-confirm-modal')).toBeHidden();

  await page.getByRole('button', { name: '新建策略' }).first().click();
  await expect(page.locator('.strategy-create-modal')).toBeVisible();
  expect(await scanVisibleLightLeaks(page, '.strategy-create-modal')).toEqual([]);
  await page.locator('.strategy-create-modal .ant-modal-close').click();
  await expect(page.locator('.strategy-create-modal')).toBeHidden();

  await page.getByRole('tab', { name: '运行调试' }).click();
  await expect(page.getByTestId('table-strategy-runs')).toBeVisible();
  expect(await scanTableColumnContract(page, 'table-strategy-runs'), '策略运行记录表格列宽语义未收口').toEqual([]);

  await page.getByRole('tab', { name: '策略信号' }).click();
  await expect(page.getByTestId('table-strategy-signals')).toBeVisible();
  expect(await scanTableColumnContract(page, 'table-strategy-signals'), '策略信号表格列宽语义未收口').toEqual([]);

  await page.getByRole('tab', { name: '版本记录' }).click();
  await expect(page.getByTestId('table-strategy-versions')).toBeVisible();
  expect(await scanTableColumnContract(page, 'table-strategy-versions'), '策略版本记录表格列宽语义未收口').toEqual([]);
  await page.getByRole('button', { name: '查看策略版本 v202605191510' }).click();
  await expect(page.locator('.strategy-version-detail-drawer')).toBeVisible();
  await expect(page.getByTestId('strategy-version-code-panel')).toBeVisible();
  await expect(page.locator('.strategy-version-detail-drawer .monaco-editor')).toBeVisible({ timeout: 30000 });
  expect(await scanVisibleLightLeaks(page, '.strategy-version-detail-drawer')).toEqual([]);
  const versionDrawerMetrics = await page.evaluate(() => {
    const drawer = document.querySelector<HTMLElement>('.strategy-version-detail-drawer');
    const panel = drawer?.querySelector<HTMLElement>('[data-testid="strategy-version-code-panel"]');
    const editor = drawer?.querySelector<HTMLElement>('.monaco-editor');
    const textareas = Array.from(drawer?.querySelectorAll<HTMLTextAreaElement>('textarea') ?? []);
    const panelRect = panel?.getBoundingClientRect();
    return {
      hasPanel: Boolean(panel),
      hasMonaco: Boolean(editor),
      allReadonly: textareas.length === 0 || textareas.every((textarea) => textarea.readOnly),
      panelHeight: panelRect ? Math.round(panelRect.height) : 0,
      overflow: drawer ? Math.max(0, Math.round(drawer.getBoundingClientRect().right - document.documentElement.clientWidth)) : 999,
    };
  });
  expect(versionDrawerMetrics.hasPanel, '版本快照未使用代码面板').toBeTruthy();
  expect(versionDrawerMetrics.hasMonaco, '版本快照未渲染 Monaco 代码视图').toBeTruthy();
  expect(versionDrawerMetrics.allReadonly, '版本快照代码区必须只读').toBeTruthy();
  expect(versionDrawerMetrics.panelHeight, '版本快照代码区高度过小').toBeGreaterThanOrEqual(300);
  expect(versionDrawerMetrics.overflow, '版本快照抽屉越出页面右边界').toBeLessThanOrEqual(1);
  await page.locator('.strategy-version-detail-drawer .ant-drawer-close').click();
  await expect(page.locator('.strategy-version-detail-drawer')).toBeHidden();

  await page.screenshot({ path: '../docs/reports/screenshots/qa_strategy_editor_workbench_fixture_20260519.png', fullPage: false });
});

test('审计表格极端长文本不撑破列宽和行高', async ({ page }) => {
  const pageResult = <T,>(items: T[]) => ({
    items,
    page: 1,
    page_size: 20,
    total: items.length,
    has_more: false,
  });
  const longAuditText = [
    '极端长审计文本：真实业务中可能包含策略说明、QMT 返回、覆盖率建议、错误堆栈和中文处理建议。',
    '本用例要求表格只能在单元格内两行截断，不能撑破操作列，不能把分页和固定列带回默认浅色。',
    '重复内容用于模拟长策略名、长文件名、长日志、长操作记录和长回测原因。',
  ].join('');

  const scanAuditTable = async (testId: string) => page.evaluate((currentTestId) => {
    const root = document.querySelector<HTMLElement>(`[data-testid="${currentTestId}"]`);
    if (!root) {
      return {
        exists: false,
        overflow: 0,
        maxRowHeight: 0,
        maxActionWidth: 0,
        maxButtonHeight: 0,
        maxAuditTextHeight: 0,
        pagerLeaks: [] as Array<{ className: string; background: string; text: string }>,
        leaks: [{ className: 'missing-table', background: 'none', text: currentTestId }],
      };
    }
    const isVisible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 12
        && rect.height > 6
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.bottom >= 0
        && rect.right >= 0
        && rect.top <= window.innerHeight
        && rect.left <= window.innerWidth;
    };
    const isLightBackground = (background: string) => {
      const match = background.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (!match) return false;
      const [, red, green, blue, alpha = '1'] = match;
      return Number(alpha) > 0.35 && Number(red) > 235 && Number(green) > 235 && Number(blue) > 235;
    };
    const leakEntries = (scope: ParentNode) => Array.from(scope.querySelectorAll<HTMLElement>('*'))
      .filter(isVisible)
      .map((element) => ({
        className: String(element.className || '').slice(0, 140),
        background: window.getComputedStyle(element).backgroundColor,
        text: (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100),
      }))
      .filter((entry) => isLightBackground(entry.background))
      .slice(0, 12);
    const rect = root.getBoundingClientRect();
    const rows = Array.from(root.querySelectorAll<HTMLElement>('.ant-table-row'));
    const actionCells = Array.from(root.querySelectorAll<HTMLElement>('.data-table-col--action'));
    const buttons = Array.from(root.querySelectorAll<HTMLElement>('.data-table-col--action .ant-btn'));
    const auditTexts = Array.from(root.querySelectorAll<HTMLElement>(
      '.backtest-audit-cell-text, .strategy-audit-cell-text, .strategy-audit-cell-code, .signal-audit-cell-text, .system-audit-cell-text, .system-audit-cell-code',
    ));
    const pager = root.querySelector<HTMLElement>('.ant-pagination');
    return {
      exists: true,
      overflow: Math.max(0, Math.round(rect.right - document.documentElement.clientWidth)),
      maxRowHeight: rows.reduce((max, row) => Math.max(max, Math.round(row.getBoundingClientRect().height)), 0),
      maxActionWidth: actionCells.reduce((max, cell) => Math.max(max, Math.round(cell.getBoundingClientRect().width)), 0),
      maxButtonHeight: buttons.reduce((max, button) => Math.max(max, Math.round(button.getBoundingClientRect().height)), 0),
      maxAuditTextHeight: auditTexts.reduce((max, node) => Math.max(max, Math.round(node.getBoundingClientRect().height)), 0),
      pagerLeaks: pager ? leakEntries(pager) : [],
      leaks: leakEntries(root),
    };
  }, testId);

  await page.route('**/api/strategies/files**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取策略文件成功',
        data: pageResult([{
          id: 9001,
          file_name: `audit_extreme_long_strategy_file_name_${longAuditText}.py`,
          file_path: 'C:/LocalQuantConsole/strategies/user/audit_extreme_long_strategy.py',
          strategy_name: `审计表格长文本策略-${longAuditText}`,
          version: '9.9.9',
          description: longAuditText,
          status: 'enabled',
          last_modified_at: '2026-05-19 15:30:00',
          last_run_at: '2026-05-19 15:31:00',
          created_at: '2026-05-19 15:00:00',
          today_signal_count: 999,
        }]),
        error: null,
        trace_id: 'visual-audit-strategy-files',
      }),
    });
  });
  await page.route('**/api/strategies/**', async (route) => {
    const url = new URL(route.request().url());
    let data: unknown = null;
    if (url.pathname === '/api/strategies/runs') {
      data = pageResult([{
        id: 1,
        run_id: `run_${longAuditText}`,
        strategy_id: 9001,
        task_id: `task_${longAuditText}`,
        status: 'failed',
        signal_count: 0,
        started_at: '2026-05-19 15:31:00',
        finished_at: '2026-05-19 15:32:00',
        message: longAuditText,
        technical_detail: longAuditText,
      }]);
    } else if (url.pathname === '/api/strategies/signals') {
      data = pageResult([{
        id: 1,
        strategy_id: 9001,
        run_id: 'run_visual_audit',
        strategy_name: `审计表格长文本策略-${longAuditText}`,
        symbol: '600000.SH',
        name: `浦发银行-${longAuditText}`,
        action: 'BUY',
        price: 10.25,
        amount: 10000,
        reason: longAuditText,
        status: 'pending',
        signal_time: '2026-05-19 10:15:00',
        created_at: '2026-05-19 10:15:01',
      }]);
    } else if (url.pathname === '/api/strategies/9001/versions') {
      data = pageResult([{ id: 1, strategy_id: 9001, version_no: `v${longAuditText}`, code_hash: longAuditText, remark: longAuditText, created_at: '2026-05-19 15:31:00' }]);
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, message: '视觉审计策略数据', data, error: null, trace_id: 'visual-audit-strategy' }),
    });
  });

  const backtestTask = {
    id: 9101,
    task_id: `task_backtest_${longAuditText}`,
    strategy_id: 9001,
    backtest_name: `审计长文本回测-${longAuditText}`,
    strategy_name: `审计长文本策略-${longAuditText}`,
    start_date: '2026-03-04',
    end_date: '2026-05-08',
    initial_cash: 1000000,
    single_order_amount: 10000,
    data_frequency: '分钟K',
    fill_mode: '下一分钟成交',
    fee_rate: 0.0003,
    stamp_tax_rate: 0.001,
    slippage: 0,
    status: 'success',
    created_at: '2026-05-19 15:33:00',
  };
  await page.route('**/api/backtests**', async (route) => {
    const url = new URL(route.request().url());
    let data: unknown = null;
    if (url.pathname === '/api/backtests') {
      data = pageResult([backtestTask]);
    } else if (url.pathname.endsWith('/trades')) {
      data = pageResult([{
        id: 1,
        backtest_id: 9101,
        symbol: '600000.SH',
        name: `浦发银行-${longAuditText}`,
        side: 'BUY',
        price: 10.25,
        quantity: 1000,
        amount: 10250,
        fee: 3.08,
        trade_time: '2026-05-19 10:15:00',
        reason: longAuditText,
        pnl: 0,
      }]);
    } else if (url.pathname.endsWith('/logs')) {
      data = pageResult([{
        id: 1,
        backtest_id: 9101,
        level: 'error',
        message: longAuditText,
        technical_detail: longAuditText,
        created_at: '2026-05-19 15:34:00',
      }]);
    } else if (url.pathname.endsWith('/signals')) {
      data = pageResult([]);
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, message: '视觉审计回测数据', data, error: null, trace_id: 'visual-audit-backtest' }),
    });
  });

  await page.route('**/api/system/**', async (route) => {
    const url = new URL(route.request().url());
    let data: unknown = null;
    if (url.pathname === '/api/system/config') {
      data = {
        qmt_path: 'D:\\MiniQMT\\demo',
        account_id: 'demo_account',
        database_path: 'C:\\LocalQuantConsole\\data\\local_quant_console.db',
        strategy_dir: 'C:\\LocalQuantConsole\\strategies\\user',
        backup_dir: 'C:\\LocalQuantConsole\\backups',
        auto_connect: true,
        auto_sync: true,
        default_order_amount: 10000,
        max_order_amount: 100000,
        order_confirm_required: true,
        default_order_type: '限价委托',
        price_offset: 0,
        simulation_mode: false,
        strategy_timeout_seconds: 300,
        strategy_run_interval_seconds: 30,
        intraday_auto_run: false,
        strategy_log_level: 'info',
        strategy_max_log_mb: 50,
        log_retention_days: 30,
        task_retention_days: 30,
      };
    } else if (url.pathname === '/api/system/logs') {
      data = pageResult([{ id: 1, module: 'backtest', level: 'error', message: longAuditText, technical_detail: longAuditText, related_id: `related_${longAuditText}`, created_at: '2026-05-19 15:35:00' }]);
    } else if (url.pathname === '/api/system/operations') {
      data = pageResult([{ id: 1, module: 'data_center', action: 'sync_latest_data', target_type: 'sync_task', target_id: `target_${longAuditText}`, result: 'success', message: longAuditText, technical_detail: longAuditText, created_at: '2026-05-19 15:36:00' }]);
    } else if (url.pathname === '/api/system/monitor') {
      data = { running_task_count: 0, failed_task_count: 0, historical_failed_task_count: 0, database_size_bytes: 1, log_size_bytes: 1, backup_count: 0, recent_errors: [], slow_tasks: [] };
    } else if (url.pathname === '/api/system/env/results') {
      data = [];
    } else if (url.pathname === '/api/system/startup-check') {
      data = { app_name: 'Local Quant Console', version: '0.1.0', checked_at: '2026-05-19 15:36:00', overall_status: 'success', items: [] };
    } else if (url.pathname === '/api/system/backups') {
      data = pageResult([]);
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, message: '视觉审计系统数据', data, error: null, trace_id: 'visual-audit-system' }),
    });
  });

  await gotoStable(page, '/strategy-dev?tab=策略文件');
  await expect(page.getByTestId('table-strategy-files')).toBeVisible();
  let metrics = await scanAuditTable('table-strategy-files');
  expect(metrics.exists).toBeTruthy();
  expect(metrics.leaks, '策略文件表存在默认浅色背景泄漏').toEqual([]);
  expect(metrics.pagerLeaks, '策略文件表分页存在默认浅色背景泄漏').toEqual([]);
  expect(metrics.overflow, '策略文件表越出页面右边界').toBeLessThanOrEqual(1);
  expect(metrics.maxRowHeight, '策略文件表极端长文本导致行高异常').toBeLessThanOrEqual(96);
  expect(metrics.maxAuditTextHeight, '策略文件表长文本未截断').toBeLessThanOrEqual(44);
  expect(metrics.maxActionWidth, '策略文件表操作列过宽').toBeLessThanOrEqual(190);

  await gotoStable(page, '/backtest?tab=回测任务');
  await expect(page.getByTestId('table-backtest-tasks')).toBeVisible();
  metrics = await scanAuditTable('table-backtest-tasks');
  expect(metrics.exists).toBeTruthy();
  expect(metrics.leaks, '回测任务表存在默认浅色背景泄漏').toEqual([]);
  expect(metrics.pagerLeaks, '回测任务表分页存在默认浅色背景泄漏').toEqual([]);
  expect(metrics.overflow, '回测任务表越出页面右边界').toBeLessThanOrEqual(1);
  expect(metrics.maxRowHeight, '回测任务表极端长文本导致行高异常').toBeLessThanOrEqual(96);
  expect(metrics.maxAuditTextHeight, '回测任务表长文本未截断').toBeLessThanOrEqual(44);
  expect(metrics.maxActionWidth, '回测任务表操作列过宽').toBeLessThanOrEqual(190);

  await gotoStable(page, '/system?tab=日志中心');
  await expect(page.getByTestId('table-system-logs')).toBeVisible();
  metrics = await scanAuditTable('table-system-logs');
  expect(metrics.exists).toBeTruthy();
  expect(metrics.leaks, '系统日志表存在默认浅色背景泄漏').toEqual([]);
  expect(metrics.pagerLeaks, '系统日志表分页存在默认浅色背景泄漏').toEqual([]);
  expect(metrics.overflow, '系统日志表越出页面右边界').toBeLessThanOrEqual(1);
  expect(metrics.maxRowHeight, '系统日志表极端长文本导致行高异常').toBeLessThanOrEqual(96);
  expect(metrics.maxAuditTextHeight, '系统日志表长文本未截断').toBeLessThanOrEqual(44);
  expect(metrics.maxActionWidth, '系统日志表操作列过宽').toBeLessThanOrEqual(190);

  await page.getByRole('tab', { name: '操作记录' }).click();
  await expect(page.getByTestId('table-operations')).toBeVisible();
  metrics = await scanAuditTable('table-operations');
  expect(metrics.exists).toBeTruthy();
  expect(metrics.leaks, '操作记录表存在默认浅色背景泄漏').toEqual([]);
  expect(metrics.pagerLeaks, '操作记录表分页存在默认浅色背景泄漏').toEqual([]);
  expect(metrics.overflow, '操作记录表越出页面右边界').toBeLessThanOrEqual(1);
  expect(metrics.maxRowHeight, '操作记录表极端长文本导致行高异常').toBeLessThanOrEqual(96);
  expect(metrics.maxAuditTextHeight, '操作记录表长文本未截断').toBeLessThanOrEqual(44);
  expect(metrics.maxActionWidth, '操作记录表操作列过宽').toBeLessThanOrEqual(190);

  await page.screenshot({ path: '../docs/reports/screenshots/qa_audit_tables_extreme_text_fixture_20260519.png', fullPage: false });
});

test('跨模块详情抽屉保持统一尺寸、分区和长文本约束', async ({ page }) => {
  const pageResult = <T,>(items: T[]) => ({
    items,
    page: 1,
    page_size: 20,
    total: items.length,
    has_more: false,
  });
  const longText = [
    '跨模块详情抽屉极端长文本：用于模拟真实 QMT 同步日志、回测交易原因、交易订单生命周期和系统日志。',
    '抽屉必须保持统一宽度、统一分区、按钮区不换行、中文说明和技术详情可滚动，不允许出现默认浅色背景。',
    '如果这里回退，用户在实盘排障时会看到凌乱的日志和无法复制的技术详情。',
  ].join('');

  const scanDrawer = async (expectedClass: string) => page.evaluate((currentExpectedClass) => {
    const testNode = document.querySelector<HTMLElement>('[data-testid="detail-drawer"]');
    const drawerRoot = testNode?.classList.contains('detail-drawer')
      ? testNode
      : testNode?.querySelector<HTMLElement>('.detail-drawer')
        ?? testNode?.closest<HTMLElement>('.detail-drawer')
        ?? document.querySelector<HTMLElement>('.detail-drawer');
    if (!testNode && !drawerRoot) {
      return {
        exists: false,
        className: '',
        workbenchRole: '',
        width: 0,
        overflowRight: 0,
        bodyHeight: 0,
        sectionCount: 0,
        summaryCount: 0,
        detailSections: [] as string[],
        maxSectionHeight: 0,
        messageHeight: 0,
        fieldsHeight: 0,
        technicalHeight: 0,
        technicalScrollHeight: 0,
        labelWidths: [] as number[],
        contentMinWidth: 0,
        contentMaxWidth: 0,
        buttonHeights: [] as number[],
        leaks: [{ className: 'missing-drawer', background: 'none', text: currentExpectedClass }],
      };
    }
    const scanRoot = drawerRoot ?? testNode!;
    const wrapper = (testNode?.classList.contains('ant-drawer-content-wrapper') ? testNode : null)
      ?? scanRoot.querySelector<HTMLElement>('.ant-drawer-content-wrapper')
      ?? scanRoot.closest<HTMLElement>('.ant-drawer-content-wrapper')
      ?? scanRoot;
    const body = scanRoot.querySelector<HTMLElement>('.ant-drawer-body');
    const messageSection = scanRoot.querySelector<HTMLElement>('[data-testid="detail-drawer-message-section"]');
    const fieldsSection = scanRoot.querySelector<HTMLElement>('[data-testid="detail-drawer-fields-section"]');
    const technicalSection = scanRoot.querySelector<HTMLElement>('[data-testid="detail-drawer-technical-section"]');
    const summaryCards = Array.from(scanRoot.querySelectorAll<HTMLElement>('.detail-drawer__summary-card'));
    const technical = scanRoot.querySelector<HTMLElement>('.detail-drawer__technical');
    const sections = Array.from(scanRoot.querySelectorAll<HTMLElement>('.detail-drawer__section'));
    const detailSections = Array.from(scanRoot.querySelectorAll<HTMLElement>('[data-detail-section]'))
      .map((section) => section.dataset.detailSection ?? '');
    const buttons = Array.from(scanRoot.querySelectorAll<HTMLElement>('.ant-drawer-extra .ant-btn, .detail-drawer__section-head .ant-btn'));
    const labels = Array.from(scanRoot.querySelectorAll<HTMLElement>('.ant-descriptions-item-label'));
    const contents = Array.from(scanRoot.querySelectorAll<HTMLElement>('.ant-descriptions-item-content'));
    const isVisible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 12
        && rect.height > 6
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.bottom >= 0
        && rect.right >= 0
        && rect.top <= window.innerHeight
        && rect.left <= window.innerWidth;
    };
    const isLightBackground = (background: string) => {
      const match = background.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (!match) return false;
      const [, red, green, blue, alpha = '1'] = match;
      return Number(alpha) > 0.35 && Number(red) > 235 && Number(green) > 235 && Number(blue) > 235;
    };
    const leakEntries = [scanRoot, ...Array.from(scanRoot.querySelectorAll<HTMLElement>('*'))]
      .filter(isVisible)
      .map((element) => ({
        className: String(element.className || '').slice(0, 140),
        background: window.getComputedStyle(element).backgroundColor,
        text: (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100),
      }))
      .filter((entry) => isLightBackground(entry.background))
      .slice(0, 12);
    const wrapperRect = wrapper.getBoundingClientRect();
    const sectionHeights = sections.map((section) => Math.round(section.getBoundingClientRect().height));
    return {
      exists: true,
      className: [
        String(testNode?.className ?? ''),
        String(drawerRoot?.className ?? ''),
        String(wrapper.className ?? ''),
      ].join(' '),
      workbenchRole: scanRoot.getAttribute('data-workbench-role')
        ?? scanRoot.querySelector<HTMLElement>('[data-workbench-role="detail-inspector"]')?.getAttribute('data-workbench-role')
        ?? '',
      width: Math.round(wrapperRect.width),
      overflowRight: Math.max(0, Math.round(wrapperRect.right - document.documentElement.clientWidth)),
      bodyHeight: Math.round(body?.getBoundingClientRect().height ?? 0),
      sectionCount: sections.length,
      summaryCount: summaryCards.length,
      detailSections,
      maxSectionHeight: sectionHeights.length ? Math.max(...sectionHeights) : 0,
      messageHeight: Math.round(messageSection?.getBoundingClientRect().height ?? 0),
      fieldsHeight: Math.round(fieldsSection?.getBoundingClientRect().height ?? 0),
      technicalHeight: Math.round(technicalSection?.getBoundingClientRect().height ?? 0),
      technicalScrollHeight: technical?.scrollHeight ?? 0,
      labelWidths: labels.map((label) => Math.round(label.getBoundingClientRect().width)),
      contentMinWidth: contents.length
        ? contents.reduce((min, content) => Math.min(min, Math.round(content.getBoundingClientRect().width)), Number.POSITIVE_INFINITY)
        : 0,
      contentMaxWidth: contents.reduce((max, content) => Math.max(max, Math.round(content.getBoundingClientRect().width)), 0),
      buttonHeights: buttons.map((button) => Math.round(button.getBoundingClientRect().height)),
      leaks: leakEntries,
    };
  }, expectedClass);

  const expectDrawerStandard = async (expectedClass: string) => {
    const metrics = await scanDrawer(expectedClass);
    expect(metrics.exists, `${expectedClass} 未打开`).toBeTruthy();
    expect(metrics.className, `${expectedClass} 未挂载对应类名`).toContain(expectedClass);
    expect(metrics.workbenchRole, `${expectedClass} 未声明详情检查器语义`).toBe('detail-inspector');
    expect(metrics.width, `${expectedClass} 宽度过窄`).toBeGreaterThanOrEqual(680);
    expect(metrics.width, `${expectedClass} 宽度过宽`).toBeLessThanOrEqual(820);
    expect(metrics.overflowRight, `${expectedClass} 越出页面右侧`).toBeLessThanOrEqual(1);
    expect(metrics.bodyHeight, `${expectedClass} 抽屉内容高度异常`).toBeLessThanOrEqual(760);
    expect(metrics.sectionCount, `${expectedClass} 分区不完整`).toBeGreaterThanOrEqual(4);
    expect(metrics.summaryCount, `${expectedClass} 缺少关键摘要卡片`).toBeGreaterThanOrEqual(2);
    expect(metrics.detailSections, `${expectedClass} 缺少统一分区语义`).toEqual(expect.arrayContaining(['summary', 'message', 'fields', 'technical']));
    expect(metrics.maxSectionHeight, `${expectedClass} 单个分区留白或长文本过高`).toBeLessThanOrEqual(500);
    expect(metrics.messageHeight, `${expectedClass} 中文说明分区高度异常`).toBeLessThanOrEqual(180);
    expect(metrics.fieldsHeight, `${expectedClass} 核对字段分区高度异常`).toBeLessThanOrEqual(500);
    expect(metrics.technicalHeight, `${expectedClass} 技术详情分区高度异常`).toBeLessThanOrEqual(300);
    expect(metrics.technicalScrollHeight, `${expectedClass} 技术详情未保留长文本`).toBeGreaterThan(120);
    expect(metrics.labelWidths.every((width) => width >= 88 && width <= 112), `${expectedClass} 核对字段标签宽度不统一`).toBeTruthy();
    expect(metrics.contentMaxWidth, `${expectedClass} 长字段未占据完整核对行`).toBeGreaterThanOrEqual(260);
    expect(metrics.buttonHeights.every((height) => height >= 26 && height <= 30), `${expectedClass} 按钮高度不统一`).toBeTruthy();
    expect(metrics.leaks, `${expectedClass} 出现默认浅色背景泄漏`).toEqual([]);
    expect(await scanActionableBlockers(page, '[data-testid="detail-drawer"]'), `${expectedClass} 存在可操作元素遮挡`).toEqual([]);
  };

  await page.route('**/api/data/**', async (route) => {
    const url = new URL(route.request().url());
    let data: unknown = null;
    if (url.pathname === '/api/data/sources/qmt/status') {
      data = { source_code: 'qmt', source_name: 'MiniQMT', mode: 'real_readonly', connected: true, account_id: 'demo_account', qmt_path: 'D:\\MiniQMT\\demo', xtquant_installed: true, last_connected_at: '2026-05-19 21:30:00', message: '测试隔离真实只读样式' };
    } else if (url.pathname === '/api/data/account/latest') {
      data = { id: 1, account_id: 'demo_account', total_asset: 5381.5, available_cash: 0, frozen_cash: 0, market_value: 5381.5, today_pnl: 0, snapshot_time: '2026-05-19 21:30:00' };
    } else if (url.pathname === '/api/data/sync/tasks') {
      data = pageResult([{ task_id: 'task_drawer_sync_20260519', sync_type: 'sync_latest_data', status: 'failed', total_count: 5000, success_count: 4999, failed_count: 1, progress: 100, message: longText, technical_detail: JSON.stringify({ qa: 'drawer', detail: longText, written_rows: 441039, failed_symbols: ['600000.SH'] }), started_at: '2026-05-19 21:20:00', finished_at: '2026-05-19 21:29:00' }]);
    } else if (url.pathname === '/api/data/sync/logs') {
      data = pageResult([{ id: 1, task_id: 'task_drawer_sync_20260519', sync_type: 'sync_latest_data', level: 'error', message: longText, technical_detail: JSON.stringify({ error: longText }), created_at: '2026-05-19 21:29:10' }]);
    } else if (url.pathname === '/api/data/quality/summary') {
      data = { success_count: 8, warning_count: 1, failed_count: 0, latest_check_time: '2026-05-19 21:20:00', is_stale: false, stale_reason: null };
    } else if (url.pathname === '/api/data/freshness/summary') {
      data = { target_trade_date: '2026-05-18', generated_at: '2026-05-19 21:20:00', overall_status: 'success', stale_count: 0, warning_count: 0, next_actions: [], items: [] };
    } else if (url.pathname === '/api/data/catalog/official') {
      data = { source: 'qmt', account_type: 'normal_stock', account_type_label: '普通股票账户', has_l2: false, has_credit: false, limitation_note: '普通账户边界', unsupported_items: [], items: [] };
    } else if (url.pathname === '/api/data/dictionary') {
      data = pageResult([]);
    } else {
      data = pageResult([]);
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, message: '视觉抽屉数据', data, error: null, trace_id: 'visual-drawer-data' }),
    });
  });

  await gotoStable(page, '/data-center?tab=数据同步');
  await expect(page.getByTestId('table-sync-tasks')).toBeVisible();
  await page.getByRole('button', { name: /看失败|失败\s*1\s*条/ }).first().click();
  await expect(page.getByTestId('detail-drawer')).toBeVisible();
  await expectDrawerStandard('data-sync-detail-drawer');
  await page.screenshot({ path: '../docs/reports/screenshots/qa_detail_drawer_data_sync_fixture_20260519.png', fullPage: false });
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('detail-drawer')).toBeHidden();

  await page.route('**/api/trading/**', async (route) => {
    const url = new URL(route.request().url());
    let data: unknown = pageResult([]);
    if (url.pathname === '/api/trading/orders') {
      data = pageResult([{ id: 1, local_order_id: 'LQC202605190001', qmt_order_id: 'QMT202605190001', account_id: 'demo_account', symbol: '600000.SH', name: '浦发银行', side: 'BUY', price: 10.25, quantity: 1000, filled_quantity: 600, status: 'partially_filled', qmt_status: '部分成交', source: 'signal', strategy_id: '101', strategy_name: `视觉抽屉策略-${longText}`, signal_id: '1', idempotency_key: 'idem_drawer_001', order_time: '2026-05-19 10:16:00', updated_at: '2026-05-19 10:18:00' }]);
    } else if (url.pathname === '/api/trading/positions') {
      data = pageResult([]);
    } else if (url.pathname === '/api/trading/signals') {
      data = pageResult([]);
    } else if (url.pathname === '/api/trading/trades') {
      data = pageResult([]);
    } else if (url.pathname === '/api/trading/logs') {
      data = pageResult([]);
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, message: '视觉抽屉交易数据', data, error: null, trace_id: 'visual-drawer-trading' }),
    });
  });

  await gotoStable(page, '/trading?tab=委托记录');
  await expect(page.getByTestId('table-trading-orders')).toBeVisible();
  await page.getByRole('button', { name: /查看订单详情/ }).first().click();
  await expect(page.getByTestId('detail-drawer')).toBeVisible();
  await expectDrawerStandard('order-detail-drawer');
  await page.screenshot({ path: '../docs/reports/screenshots/qa_detail_drawer_order_fixture_20260519.png', fullPage: false });
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('detail-drawer')).toBeHidden();

  const backtestTask = { id: 9301, task_id: 'task_drawer_backtest', strategy_id: 1, backtest_name: '抽屉核验回测', strategy_name: '抽屉核验策略', start_date: '2026-05-04', end_date: '2026-05-08', initial_cash: 1000000, single_order_amount: 10000, data_frequency: '分钟K', fill_mode: '下一分钟成交', fee_rate: 0.0003, stamp_tax_rate: 0.001, slippage: 0, status: 'success', created_at: '2026-05-19 21:35:00' };
  await page.route('**/api/strategies/files**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, message: '策略成功', data: pageResult([{ id: 1, file_name: 'drawer_strategy.py', file_path: 'C:/LocalQuantConsole/strategies/user/drawer_strategy.py', strategy_name: '抽屉核验策略', version: '1.0.0', description: longText, status: 'enabled', last_modified_at: '2026-05-19 21:00:00', last_run_at: '2026-05-19 21:01:00', created_at: '2026-05-19 21:00:00', today_signal_count: 1 }]), error: null, trace_id: 'visual-drawer-strategy' }),
    });
  });
  await page.route('**/api/backtests**', async (route) => {
    const url = new URL(route.request().url());
    let data: unknown = null;
    if (url.pathname === '/api/backtests') {
      data = pageResult([backtestTask]);
    } else if (url.pathname.endsWith('/trades')) {
      data = pageResult([{ id: 1, backtest_id: 9301, symbol: '600000.SH', name: '浦发银行', side: 'BUY', price: 10.25, quantity: 1000, amount: 10250, fee: 3.08, trade_time: '2026-05-19 10:15:00', reason: longText, pnl: 0 }]);
    } else if (url.pathname.endsWith('/logs')) {
      data = pageResult([]);
    } else if (url.pathname.endsWith('/signals')) {
      data = pageResult([]);
    } else if (url.pathname.endsWith('/report')) {
      data = { task: backtestTask, result: null, manifest: null, trades: [], signals: [], equity: [], logs: [] };
    } else if (url.pathname.endsWith('/result')) {
      data = null;
    } else if (url.pathname.endsWith('/equity')) {
      data = [];
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, message: '视觉抽屉回测数据', data, error: null, trace_id: 'visual-drawer-backtest' }),
    });
  });

  await gotoStable(page, '/backtest?tab=交易明细');
  await expect(page.getByTestId('table-backtest-trades')).toBeVisible();
  await page.getByRole('button', { name: /查看回测交易详情/ }).first().click();
  await expect(page.getByTestId('detail-drawer')).toBeVisible();
  await expectDrawerStandard('backtest-trade-detail-drawer');
  await page.screenshot({ path: '../docs/reports/screenshots/qa_detail_drawer_backtest_trade_fixture_20260519.png', fullPage: false });
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('detail-drawer')).toBeHidden();

  await page.route('**/api/system/**', async (route) => {
    const url = new URL(route.request().url());
    let data: unknown = null;
    if (url.pathname === '/api/system/config') {
      data = { qmt_path: 'D:\\MiniQMT\\demo', account_id: 'demo_account', database_path: 'C:\\LocalQuantConsole\\data\\local_quant_console.db', strategy_dir: 'C:\\LocalQuantConsole\\strategies\\user', backup_dir: 'C:\\LocalQuantConsole\\backups', auto_connect: true, auto_sync: true, default_order_amount: 10000, max_order_amount: 100000, order_confirm_required: true, default_order_type: '限价委托', price_offset: 0, simulation_mode: false, strategy_timeout_seconds: 300, strategy_run_interval_seconds: 30, intraday_auto_run: false, strategy_log_level: 'info', strategy_max_log_mb: 50, log_retention_days: 30, task_retention_days: 30 };
    } else if (url.pathname === '/api/system/logs') {
      data = pageResult([{ id: 1, module: 'data_center', level: 'error', message: longText, technical_detail: JSON.stringify({ detail: longText, trace: 'visual-drawer-system' }), related_id: 'task_drawer_sync_20260519', created_at: '2026-05-19 21:38:00' }]);
    } else if (url.pathname === '/api/system/operations') {
      data = pageResult([]);
    } else if (url.pathname === '/api/system/monitor') {
      data = { running_task_count: 0, failed_task_count: 0, historical_failed_task_count: 0, database_size_bytes: 1, log_size_bytes: 1, backup_count: 0, recent_errors: [], slow_tasks: [] };
    } else if (url.pathname === '/api/system/env/results') {
      data = [];
    } else if (url.pathname === '/api/system/startup-check') {
      data = { app_name: 'Local Quant Console', version: '0.1.0', checked_at: '2026-05-19 21:38:00', overall_status: 'success', items: [] };
    } else if (url.pathname === '/api/system/backups') {
      data = pageResult([]);
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, message: '视觉抽屉系统数据', data, error: null, trace_id: 'visual-drawer-system' }),
    });
  });

  await gotoStable(page, '/system?tab=日志中心');
  await expect(page.getByTestId('table-system-logs')).toBeVisible();
  await page.getByRole('button', { name: /查看系统日志详情/ }).first().click();
  await expect(page.getByTestId('detail-drawer')).toBeVisible();
  await expectDrawerStandard('system-log-detail-drawer');
  await page.screenshot({ path: '../docs/reports/screenshots/qa_detail_drawer_system_log_fixture_20260519.png', fullPage: false });
});

test('低频详情入口和交易深层抽屉保持统一终端规格', async ({ page }) => {
  test.setTimeout(90_000);

  const pageResult = <T,>(items: T[]) => ({
    items,
    page: 1,
    page_size: 20,
    total: items.length,
    has_more: false,
  });
  const longText = [
    '低频详情入口极端长文本：用于核验覆盖率缺口、数据质量建议、数据字典字段说明、备份路径、操作记录和交易生命周期明细。',
    '这里必须保持 720px 统一抽屉宽度、三段式分区、暗色终端背景、长字段可换行、技术详情可复制。',
    '如果某一处回退到默认 Ant Design 浅色或被长路径撑破，实盘排障会变得很难读。',
  ].join('');

  const scanDrawer = async (expectedClass: string) => page.evaluate((currentExpectedClass) => {
    const testNode = document.querySelector<HTMLElement>('[data-testid="detail-drawer"]');
    const root = testNode?.classList.contains('detail-drawer')
      ? testNode
      : testNode?.querySelector<HTMLElement>('.detail-drawer')
        ?? testNode?.closest<HTMLElement>('.detail-drawer')
        ?? document.querySelector<HTMLElement>('.detail-drawer');
    if (!testNode && !root) {
      return {
        exists: false,
        className: '',
        workbenchRole: '',
        width: 0,
        overflowRight: 0,
        sectionCount: 0,
        summaryCount: 0,
        detailSections: [] as string[],
        messageHeight: 0,
        technicalHeight: 0,
        maxSectionHeight: 0,
        labelWidths: [] as number[],
        contentMinWidth: 0,
        buttonHeights: [] as number[],
        leaks: [{ className: 'missing-drawer', background: 'none', text: currentExpectedClass }],
      };
    }
    const scanRoot = root ?? testNode!;
    const wrapper = (testNode?.classList.contains('ant-drawer-content-wrapper') ? testNode : null)
      ?? scanRoot.querySelector<HTMLElement>('.ant-drawer-content-wrapper')
      ?? scanRoot.closest<HTMLElement>('.ant-drawer-content-wrapper')
      ?? scanRoot;
    const isVisible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 12
        && rect.height > 6
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && rect.bottom >= 0
        && rect.right >= 0
        && rect.top <= window.innerHeight
        && rect.left <= window.innerWidth;
    };
    const isLightBackground = (background: string) => {
      const match = background.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (!match) return false;
      const [, red, green, blue, alpha = '1'] = match;
      return Number(alpha) > 0.35 && Number(red) > 235 && Number(green) > 235 && Number(blue) > 235;
    };
    const sections = Array.from(scanRoot.querySelectorAll<HTMLElement>('.detail-drawer__section'));
    const sectionHeights = sections.map((section) => Math.round(section.getBoundingClientRect().height));
    const summaryCards = Array.from(scanRoot.querySelectorAll<HTMLElement>('.detail-drawer__summary-card'));
    const detailSections = Array.from(scanRoot.querySelectorAll<HTMLElement>('[data-detail-section]'))
      .map((section) => section.dataset.detailSection ?? '');
    const buttons = Array.from(scanRoot.querySelectorAll<HTMLElement>('.ant-drawer-extra .ant-btn, .detail-drawer__section-head .ant-btn'));
    const labels = Array.from(scanRoot.querySelectorAll<HTMLElement>('.ant-descriptions-item-label'));
    const contents = Array.from(scanRoot.querySelectorAll<HTMLElement>('.ant-descriptions-item-content'));
    const leakEntries = [scanRoot, ...Array.from(scanRoot.querySelectorAll<HTMLElement>('*'))]
      .filter(isVisible)
      .map((element) => ({
        className: String(element.className || '').slice(0, 140),
        background: window.getComputedStyle(element).backgroundColor,
        text: (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100),
      }))
      .filter((entry) => isLightBackground(entry.background))
      .slice(0, 12);
    const wrapperRect = wrapper.getBoundingClientRect();
    return {
      exists: true,
      className: [
        String(testNode?.className ?? ''),
        String(root?.className ?? ''),
        String(wrapper.className ?? ''),
      ].join(' '),
      workbenchRole: scanRoot.getAttribute('data-workbench-role')
        ?? scanRoot.querySelector<HTMLElement>('[data-workbench-role="detail-inspector"]')?.getAttribute('data-workbench-role')
        ?? '',
      width: Math.round(wrapperRect.width),
      overflowRight: Math.max(0, Math.round(wrapperRect.right - document.documentElement.clientWidth)),
      sectionCount: sections.length,
      summaryCount: summaryCards.length,
      detailSections,
      messageHeight: Math.round(scanRoot.querySelector<HTMLElement>('[data-testid="detail-drawer-message-section"]')?.getBoundingClientRect().height ?? 0),
      technicalHeight: Math.round(scanRoot.querySelector<HTMLElement>('[data-testid="detail-drawer-technical-section"]')?.getBoundingClientRect().height ?? 0),
      maxSectionHeight: sectionHeights.length ? Math.max(...sectionHeights) : 0,
      labelWidths: labels.map((label) => Math.round(label.getBoundingClientRect().width)),
      contentMinWidth: contents.length
        ? contents.reduce((min, content) => Math.min(min, Math.round(content.getBoundingClientRect().width)), Number.POSITIVE_INFINITY)
        : 0,
      contentMaxWidth: contents.reduce((max, content) => Math.max(max, Math.round(content.getBoundingClientRect().width)), 0),
      buttonHeights: buttons.map((button) => Math.round(button.getBoundingClientRect().height)),
      leaks: leakEntries,
    };
  }, expectedClass);

  const expectDrawerStandard = async (expectedClass: string) => {
    const metrics = await scanDrawer(expectedClass);
    expect(metrics.exists, `${expectedClass} 未打开`).toBeTruthy();
    expect(metrics.className, `${expectedClass} 未挂载对应类名`).toContain(expectedClass);
    expect(metrics.workbenchRole, `${expectedClass} 未声明详情检查器语义`).toBe('detail-inspector');
    expect(metrics.width, `${expectedClass} 未使用统一 720px 抽屉宽度`).toBeGreaterThanOrEqual(700);
    expect(metrics.width, `${expectedClass} 宽度超过统一规格`).toBeLessThanOrEqual(740);
    expect(metrics.overflowRight, `${expectedClass} 越出页面右侧`).toBeLessThanOrEqual(1);
    expect(metrics.sectionCount, `${expectedClass} 分区不完整`).toBeGreaterThanOrEqual(4);
    expect(metrics.summaryCount, `${expectedClass} 缺少关键摘要卡片`).toBeGreaterThanOrEqual(2);
    expect(metrics.detailSections, `${expectedClass} 缺少统一分区语义`).toEqual(expect.arrayContaining(['summary', 'message', 'fields', 'technical']));
    expect(metrics.messageHeight, `${expectedClass} 中文说明区过高`).toBeLessThanOrEqual(180);
    expect(metrics.technicalHeight, `${expectedClass} 技术详情区过高`).toBeLessThanOrEqual(300);
    expect(metrics.maxSectionHeight, `${expectedClass} 单个分区留白或长文本过高`).toBeLessThanOrEqual(500);
    expect(metrics.labelWidths.every((width) => width >= 88 && width <= 112), `${expectedClass} 核对字段标签宽度不统一`).toBeTruthy();
    expect(metrics.contentMaxWidth, `${expectedClass} 长字段未占据完整核对行`).toBeGreaterThanOrEqual(260);
    expect(metrics.buttonHeights.every((height) => height >= 26 && height <= 30), `${expectedClass} 按钮高度不统一`).toBeTruthy();
    expect(metrics.leaks, `${expectedClass} 出现默认浅色背景泄漏`).toEqual([]);
  };

  const closeDrawer = async () => {
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('detail-drawer')).toBeHidden();
  };

  const clickFirstDetailButton = async (selector: string, label: string) => {
    const button = page.locator(selector).first();
    await expect(button, `${label} 详情按钮不存在`).toBeVisible({ timeout: 10_000 });
    await button.scrollIntoViewIfNeeded();
    await button.click();
  };

  await page.route('**/api/data/**', async (route) => {
    const url = new URL(route.request().url());
    let data: unknown = pageResult([]);
    if (url.pathname === '/api/data/sources/qmt/status') {
      data = { source_code: 'qmt', source_name: 'MiniQMT', mode: 'real', connected: true, account_id: 'demo_account', qmt_path: 'D:\\MiniQMT\\demo', xtquant_installed: true, last_connected_at: '2026-05-19 22:10:00', message: '测试隔离真实只读样式' };
    } else if (url.pathname === '/api/data/account/latest') {
      data = { id: 1, account_id: 'demo_account', total_asset: 5679.2, available_cash: 0, frozen_cash: 0, market_value: 5679.2, today_pnl: 0, snapshot_time: '2026-05-19 17:24:31' };
    } else if (url.pathname === '/api/data/freshness/summary') {
      data = { target_trade_date: '2026-05-19', generated_at: '2026-05-19 22:10:00', overall_status: 'warning', stale_count: 1, warning_count: 1, next_actions: [longText], items: [] };
    } else if (url.pathname === '/api/data/quality/summary') {
      data = { success_count: 8, warning_count: 1, failed_count: 0, latest_check_time: '2026-05-19 22:10:00', is_stale: false, stale_reason: null };
    } else if (url.pathname === '/api/data/sync/tasks') {
      data = pageResult([{
        task_id: 'task_coverage_sync_fixture_20260519',
        sync_type: 'sync_latest_data',
        status: 'failed',
        total_count: 5000,
        success_count: 4998,
        failed_count: 2,
        progress: 100,
        message: '视觉检查同步任务：2 只股票需回到数据质量页核对缺失。',
        technical_detail: JSON.stringify({
          batch: 89,
          total_batches: 90,
          full_range: '2026-01-01~2026-05-19',
          window: '2026-05-13~2026-05-19',
          period: '1m',
          rows: 99888001,
          success_symbols: 4998,
          failed_symbols: 2,
          resume_rule: 'minute_coverage_first',
        }),
        started_at: '2026-05-19 21:58:00',
        finished_at: '2026-05-19 22:10:00',
      }]);
    } else if (url.pathname === '/api/data/sync/coverage-2026') {
      data = pageResult([{
        id: 1,
        data_type: 'minute_kline',
        symbol: 'ALL',
        period: '1m',
        start_date: '2026-01-01',
        end_date: '2026-05-19',
        expected_trading_days: 90,
        actual_trading_days: 89,
        expected_rows: 100000000,
        actual_rows: 99888001,
        missing_days: JSON.stringify(['2026-04-03', '2026-04-07', longText]),
        duplicate_rows: 0,
        coverage_rate: 99.88,
        status: 'partial',
        checked_at: '2026-05-19 22:10:00',
      }]);
    } else if (url.pathname === '/api/data/quality/results') {
      data = pageResult([{ id: 1, check_type: `minute_coverage_${longText}`, target_table: 'minute_kline', status: 'warning', message: longText, suggestion: `${longText}；正式分钟回测前必须重新检查覆盖率。`, created_at: '2026-05-19 22:10:00' }]);
    } else if (url.pathname === '/api/data/quality/account-snapshot-duplicates') {
      data = pageResult([{ account_id: 'demo_account', snapshot_time: '2026-05-19 17:24:31', duplicate_count: 2, min_id: 1, max_id: 3, min_total_asset: 5679.2, max_total_asset: 5679.2, min_available_cash: 0, max_available_cash: 0 }]);
    } else if (url.pathname === '/api/data/catalog/official') {
      data = { source: 'qmt', account_type: 'normal_stock', account_type_label: '普通股票账户', has_l2: false, has_credit: false, limitation_note: longText, unsupported_items: [], items: [] };
    } else if (url.pathname === '/api/data/dictionary') {
      data = pageResult([{ id: 1, table_name: 'minute_kline', field_name: `amount_${longText}`, field_type: 'REAL', description: longText, example_value: '52300000', unit: '元', strategy_usage: `${longText}；策略必须通过 StrategyContext 读取。`, is_indexed: true }]);
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, message: '低频详情视觉数据', data, error: null, trace_id: 'visual-deep-detail-data' }),
    });
  });

  await page.route('**/api/system/**', async (route) => {
    const url = new URL(route.request().url());
    let data: unknown = pageResult([]);
    if (url.pathname === '/api/system/config') {
      data = { qmt_path: 'D:\\MiniQMT\\demo', account_id: 'demo_account', database_path: 'C:\\LocalQuantConsole\\data\\local_quant_console.db', strategy_dir: 'C:\\LocalQuantConsole\\strategies\\user', backup_dir: 'C:\\LocalQuantConsole\\backups', auto_connect: true, auto_sync: true, default_order_amount: 10000, max_order_amount: 100000, order_confirm_required: true, default_order_type: '限价委托', price_offset: 0, simulation_mode: false, strategy_timeout_seconds: 300, strategy_run_interval_seconds: 30, intraday_auto_run: false, strategy_log_level: 'info', strategy_max_log_mb: 50, log_retention_days: 30, task_retention_days: 30 };
    } else if (url.pathname === '/api/system/env/results') {
      data = [];
    } else if (url.pathname === '/api/system/backups') {
      data = pageResult([{ id: 1, backup_name: `backup_${longText}`, backup_path: `C:\\LocalQuantConsole\\backups\\20260519\\${longText}\\local_quant_console_backup.zip`, backup_size: 268435456, status: 'success', created_at: '2026-05-19 22:11:00' }]);
    } else if (url.pathname === '/api/system/operations') {
      data = pageResult([{ id: 1, module: '数据中心', action: `sync_latest_data_${longText}`, target_type: 'task', target_id: 'task_20260519221000_long_detail', result: '成功', message: longText, technical_detail: JSON.stringify({ detail: longText, path: `C:\\LocalQuantConsole\\logs\\${longText}.log` }), created_at: '2026-05-19 22:12:00' }]);
    } else if (url.pathname === '/api/system/monitor') {
      data = { running_task_count: 0, failed_task_count: 0, historical_failed_task_count: 0, database_size_bytes: 1, log_size_bytes: 1, backup_count: 1, recent_errors: [], slow_tasks: [] };
    } else if (url.pathname === '/api/system/startup-check') {
      data = { app_name: 'Local Quant Console', version: '0.1.0', checked_at: '2026-05-19 22:12:00', overall_status: 'success', items: [] };
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, message: '低频详情系统数据', data, error: null, trace_id: 'visual-deep-detail-system' }),
    });
  });

  await page.route('**/api/trading/**', async (route) => {
    const url = new URL(route.request().url());
    let data: unknown = pageResult([]);
    if (url.pathname === '/api/trading/positions') {
      data = pageResult([{ id: 1, account_id: 'demo_account', symbol: '600000.SH', name: `浦发银行-${longText}`, quantity: 1000, available_quantity: 800, cost_price: 10.1, last_price: 10.25, market_value: 10250, pnl: 150, pnl_ratio: 1.49, source: 'real_sync', snapshot_time: '2026-05-19 14:50:00' }]);
    } else if (url.pathname === '/api/trading/orders') {
      data = pageResult([]);
    } else if (url.pathname === '/api/trading/signals') {
      data = pageResult([]);
    } else if (url.pathname === '/api/trading/trades') {
      data = pageResult([{ id: 1, trade_id: `TRD202605190001_${longText}`, local_order_id: 'LQC202605190001', qmt_order_id: 'QMT202605190001', account_id: 'demo_account', symbol: '600000.SH', name: '浦发银行', side: 'BUY', price: 10.25, quantity: 1000, amount: 10250, fee: 3.08, source: 'signal', strategy_name: longText, trade_time: '2026-05-19 10:16:00' }]);
    } else if (url.pathname === '/api/trading/logs') {
      data = pageResult([{ id: 1, local_order_id: 'LQC202605190001', level: 'warning', message: longText, technical_detail: JSON.stringify({ detail: longText, local_order_id: 'LQC202605190001', qmt_order_id: 'QMT202605190001' }), created_at: '2026-05-19 10:17:00' }]);
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, message: '低频详情交易数据', data, error: null, trace_id: 'visual-deep-detail-trading' }),
    });
  });

  const openAndCheck = async (expectedClass: string, screenshotName: string) => {
    await expect(page.getByTestId('detail-drawer')).toBeVisible();
    await expectDrawerStandard(expectedClass);
    await page.screenshot({ path: `../docs/reports/screenshots/${screenshotName}`, fullPage: false });
    await closeDrawer();
  };

  await gotoStable(page, '/data-center');
  await expect(page.getByTestId('data-coverage-evidence-board')).toBeVisible();
  await expect(page.getByTestId('data-coverage-evidence-board')).toContainText('分钟K覆盖');
  expect(await scanVisibleLightLeaks(page, '[data-testid="data-coverage-evidence-board"]'), '数据中心覆盖率证据板出现浅色泄漏').toEqual([]);
  await expect(page.getByTestId('table-coverage-2026')).toBeVisible();
  await clickFirstDetailButton('[data-testid="table-coverage-2026"] button[aria-label^="查看覆盖率详情"]', '覆盖率');
  await openAndCheck('data-coverage-detail-drawer', 'qa_deep_detail_coverage_fixture_20260519.png');

  await gotoStable(page, '/data-center?tab=数据同步');
  await expect(page.getByTestId('data-sync-evidence-board')).toBeVisible();
  await expect(page.getByTestId('data-sync-evidence-board')).toContainText('任务总量');
  expect(await scanVisibleLightLeaks(page, '[data-testid="data-sync-evidence-board"]'), '数据中心同步证据板出现浅色泄漏').toEqual([]);
  await expect(page.getByTestId('table-sync-tasks')).toBeVisible();

  await gotoStable(page, '/data-center?tab=数据质量');
  await expect(page.getByTestId('table-quality')).toBeVisible();
  await clickFirstDetailButton('[data-testid="table-quality"] button[aria-label^="查看质量检查详情"]', '质量检查');
  await openAndCheck('data-quality-detail-drawer', 'qa_deep_detail_quality_fixture_20260519.png');

  await gotoStable(page, '/data-center?tab=数据字典');
  await expect(page.getByTestId('table-dictionary')).toBeVisible();
  await clickFirstDetailButton('[data-testid="table-dictionary"] button[aria-label^="查看数据字典字段详情"]', '数据字典');
  await openAndCheck('data-dictionary-detail-drawer', 'qa_deep_detail_dictionary_fixture_20260519.png');

  await gotoStable(page, '/system?tab=备份恢复');
  await expect(page.getByTestId('table-backups')).toBeVisible();
  await clickFirstDetailButton('[data-testid="table-backups"] button[aria-label^="查看备份详情"], .backup-timeline button[aria-label^="查看备份详情"]', '备份');
  await openAndCheck('system-backup-detail-drawer', 'qa_deep_detail_backup_fixture_20260519.png');

  await gotoStable(page, '/system?tab=操作记录');
  await expect(page.getByTestId('table-operations')).toBeVisible();
  await clickFirstDetailButton('[data-testid="table-operations"] button[aria-label^="查看操作记录详情"]', '操作记录');
  await openAndCheck('system-operation-detail-drawer', 'qa_deep_detail_operation_fixture_20260519.png');

  await gotoStable(page, '/trading?tab=当前持仓');
  await expect(page.getByTestId('table-trading-positions')).toBeVisible();
  await clickFirstDetailButton('[data-testid="table-trading-positions"] button[aria-label^="查看持仓详情"]', '持仓');
  await openAndCheck('position-detail-drawer', 'qa_deep_detail_position_fixture_20260519.png');

  await gotoStable(page, '/trading?tab=成交记录');
  await expect(page.getByTestId('table-trading-trades')).toBeVisible();
  await clickFirstDetailButton('[data-testid="table-trading-trades"] button[aria-label^="查看成交详情"]', '成交');
  await openAndCheck('trade-detail-drawer', 'qa_deep_detail_trade_fixture_20260519.png');

  await gotoStable(page, '/trading?tab=执行日志');
  await expect(page.getByTestId('table-trading-logs')).toBeVisible();
  await clickFirstDetailButton('[data-testid="table-trading-logs"] button[aria-label^="查看交易执行日志详情"]', '交易执行日志');
  await openAndCheck('execution-log-detail-drawer', 'qa_deep_detail_execution_log_fixture_20260519.png');
});
