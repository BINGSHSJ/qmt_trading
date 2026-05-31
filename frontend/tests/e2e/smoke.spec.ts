import { expect, test, type Page } from '@playwright/test';

const emptyDashboardBundle = {
  summary: {
    asset: {
      total_asset: 0,
      available_cash: 0,
      market_value: 0,
      today_pnl: 0,
      position_count: 0,
      updated_at: null,
      has_account: false,
    },
    running_task_count: 0,
    failed_task_count: 0,
    today_signal_count: 0,
    today_order_count: 0,
    today_trade_amount: 0,
    qmt_mode: 'test_isolation',
    qmt_connected: false,
    trading_mode: '测试隔离',
  },
  tasks: [],
  today_signals: [],
  today_trades: {
    submitted_count: 0,
    filled_count: 0,
    cancelled_count: 0,
    failed_count: 0,
    trade_amount: 0,
    order_count: 0,
    trade_count: 0,
  },
  latest_orders: [],
  latest_trades: [],
};

async function routeQmtStatus(page: Page, mode: 'test_isolation' | 'real' = 'test_isolation') {
  await page.route('**/api/data/sources/qmt/status**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取 QMT 状态成功',
        data: {
          source_code: 'qmt',
          source_name: 'QMT',
          mode,
          connected: true,
          account_id: mode === 'real' ? 'real-account' : 'test_isolation_account',
          qmt_path: mode === 'real' ? 'D:\\MiniQMT\\demo' : '',
          xtquant_installed: mode === 'real',
          last_connected_at: '2026-05-09 10:00:00',
          message: mode === 'real' ? '真实 QMT 只读验收模式已启用。' : '测试隔离 QMT 数据源已启用，仅用于自动化测试，不会调用真实 QMT。',
        },
        error: null,
        trace_id: `ui-qmt-status-${mode}`,
      }),
    });
  });
}

async function routeDataCenterBasics(page: Page, mode: 'test_isolation' | 'real' = 'real') {
  await routeQmtStatus(page, mode);
  await page.route('**/api/data/account/latest**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取账户快照成功',
        data: null,
        error: null,
        trace_id: 'ui-data-center-account-empty',
      }),
    });
  });
  await page.route('**/api/data/quality/summary**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取数据质量摘要成功',
        data: { success_count: 0, warning_count: 0, failed_count: 0, latest_check_time: null, is_stale: false, stale_reason: null },
        error: null,
        trace_id: 'ui-data-center-quality-summary',
      }),
    });
  });
  await page.route('**/api/data/freshness/summary**', async (route) => {
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
          items: [],
          next_actions: [],
        },
        error: null,
        trace_id: 'ui-data-center-freshness',
      }),
    });
  });
}

async function scanVisibleDarkSurfaceLeaks(page: Page, selector = '.app-shell') {
  return page.evaluate((rootSelector) => {
    const root = document.querySelector(rootSelector);
    if (!root) {
      return [{ selector: rootSelector, className: 'missing-root', background: 'none', text: '' }];
    }

    const parseRgb = (value: string) => {
      const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (!match) return null;
      return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: Number(match[4] ?? '1') };
    };
    const luminance = (rgb: { r: number; g: number; b: number } | null) =>
      rgb ? 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b : 255;
    const isVisible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 18
        && rect.height > 12
        && rect.bottom >= 0
        && rect.right >= 0
        && rect.top <= window.innerHeight
        && rect.left <= window.innerWidth
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && style.opacity !== '0';
    };
    const isAllowedDark = (element: Element) =>
      Boolean(element.closest(
        '.ant-modal-mask,.ant-drawer-mask,.ant-tooltip,.ant-message,.ant-notification,.monaco-editor,.monaco-editor-background,.lightweight-charts,.k-line-chart,canvas',
      ));

    return [root, ...Array.from(root.querySelectorAll('*'))]
      .filter(isVisible)
      .filter((element) => !isAllowedDark(element))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        const rgb = parseRgb(style.backgroundColor);
        return {
          selector: rootSelector,
          className: String((element as HTMLElement).className || element.tagName).slice(0, 140),
          background: style.backgroundColor,
          luminance: Math.round(luminance(rgb)),
          area: Math.round(rect.width * rect.height),
          text: (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100),
        };
      })
      .filter((entry) => {
        const rgb = parseRgb(entry.background);
        return Boolean(rgb && rgb.a > 0.35 && entry.area > 420 && entry.luminance < 72);
      })
      .slice(0, 12);
  }, selector);
}

async function scanVisibleLightSurfaceLeaks(page: Page, selector = '.app-shell') {
  return page.evaluate((rootSelector) => {
    const root = document.querySelector(rootSelector);
    if (!root) {
      return [{ selector: rootSelector, className: 'missing-root', background: 'none', text: '' }];
    }

    const parseRgb = (value: string) => {
      const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (!match) return null;
      return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: Number(match[4] ?? '1') };
    };
    const luminance = (rgb: { r: number; g: number; b: number } | null) =>
      rgb ? 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b : 0;
    const isVisible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 18
        && rect.height > 12
        && rect.bottom >= 0
        && rect.right >= 0
        && rect.top <= window.innerHeight
        && rect.left <= window.innerWidth
        && style.visibility !== 'hidden'
        && style.display !== 'none'
        && style.opacity !== '0';
    };
    const isAllowedLight = (element: Element) =>
      Boolean(element.closest(
        '.ant-tooltip,.ant-message,.ant-notification,.monaco-editor,.monaco-editor-background,.lightweight-charts,.k-line-chart,canvas',
      ));

    return [root, ...Array.from(root.querySelectorAll('*'))]
      .filter(isVisible)
      .filter((element) => !isAllowedLight(element))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        const rgb = parseRgb(style.backgroundColor);
        return {
          selector: rootSelector,
          className: String((element as HTMLElement).className || element.tagName).slice(0, 140),
          background: style.backgroundColor,
          luminance: Math.round(luminance(rgb)),
          area: Math.round(rect.width * rect.height),
          text: (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100),
        };
      })
      .filter((entry) => {
        const rgb = parseRgb(entry.background);
        return Boolean(rgb && rgb.a > 0.35 && entry.area > 420 && entry.luminance > 226);
      })
      .slice(0, 12);
  }, selector);
}

async function sampleThemeOverlaySurfaces(page: Page) {
  return page.evaluate(() => {
    document.querySelector('[data-testid="theme-overlay-samples"]')?.remove();

    const host = document.createElement('div');
    host.setAttribute('data-testid', 'theme-overlay-samples');
    host.style.cssText = [
      'position: fixed',
      'right: 24px',
      'top: 88px',
      'z-index: 2147483000',
      'display: grid',
      'gap: 8px',
      'pointer-events: none',
    ].join(';');
    host.innerHTML = `
      <div class="ant-message">
        <div class="ant-message-notice">
          <div class="ant-message-notice-content">主题消息提示</div>
        </div>
      </div>
      <div class="ant-notification">
        <div class="ant-notification-notice">
          <div class="ant-notification-notice-message">主题通知标题</div>
          <div class="ant-notification-notice-description">主题通知内容</div>
        </div>
      </div>
    `;
    document.body.appendChild(host);

    const parseRgb = (value: string) => {
      const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (!match) return null;
      return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: Number(match[4] ?? '1') };
    };
    const luminance = (rgb: { r: number; g: number; b: number } | null) =>
      rgb ? Math.round(0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) : -1;

    return Array.from(host.querySelectorAll<HTMLElement>('.ant-message-notice-content, .ant-notification-notice'))
      .map((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return {
          className: String(element.className),
          background: style.backgroundColor,
          color: style.color,
          backgroundLuminance: luminance(parseRgb(style.backgroundColor)),
          textLuminance: luminance(parseRgb(style.color)),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          text: element.innerText.replace(/\s+/g, ' ').trim(),
        };
      });
  });
}

async function sampleThemeControlStateSurfaces(page: Page) {
  return page.evaluate(() => {
    document.querySelector('[data-testid="theme-control-samples"]')?.remove();

    const mount = document.querySelector<HTMLElement>('.module-page') ?? document.body;
    const host = document.createElement('div');
    host.setAttribute('data-testid', 'theme-control-samples');
    host.style.cssText = [
      'position: fixed',
      'left: 160px',
      'bottom: 56px',
      'z-index: 2147482900',
      'display: grid',
      'grid-template-columns: repeat(3, minmax(140px, 180px))',
      'gap: 8px',
      'padding: 8px',
      'pointer-events: none',
    ].join(';');
    host.innerHTML = `
      <input class="ant-input theme-control-sample theme-control-surface" value="普通输入" />
      <input class="ant-input ant-input-disabled theme-control-sample theme-control-surface" disabled value="禁用输入" />
      <span class="ant-input-affix-wrapper ant-input-affix-wrapper-status-error theme-control-sample theme-control-surface">
        <input class="ant-input" value="错误输入" />
      </span>
      <div class="ant-select ant-select-single theme-control-sample"><div class="ant-select-selector theme-control-surface"><span class="ant-select-selection-item">普通下拉</span></div></div>
      <div class="ant-select ant-select-disabled ant-select-single theme-control-sample"><div class="ant-select-selector theme-control-surface"><span class="ant-select-selection-item">禁用下拉</span></div></div>
      <div class="ant-picker theme-control-sample theme-control-surface"><div class="ant-picker-input"><input value="2026-05-28" /></div></div>
      <button class="ant-btn ant-btn-default theme-control-sample theme-control-surface" type="button"><span>普通按钮</span></button>
      <button class="ant-btn ant-btn-default ant-btn-disabled theme-control-sample theme-control-surface" disabled type="button"><span>禁用按钮</span></button>
      <button class="ant-switch theme-control-sample theme-control-surface" type="button"><span class="ant-switch-handle"></span></button>
      <label class="ant-checkbox-wrapper theme-control-sample"><span class="ant-checkbox ant-checkbox-checked"><span class="ant-checkbox-inner theme-control-surface"></span></span><span>复选框</span></label>
      <label class="ant-radio-button-wrapper ant-radio-button-wrapper-checked theme-control-sample theme-control-surface"><span>单选按钮</span></label>
      <div class="ant-segmented theme-control-sample theme-control-surface"><div class="ant-segmented-item ant-segmented-item-selected">买入</div><div class="ant-segmented-item">卖出</div></div>
      <div class="ant-form-item-explain ant-form-item-explain-error theme-control-sample theme-control-surface">中文错误提示</div>
    `;
    mount.appendChild(host);

    const parseRgb = (value: string) => {
      const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (!match) return null;
      return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: Number(match[4] ?? '1') };
    };
    const luminance = (rgb: { r: number; g: number; b: number } | null) =>
      rgb ? Math.round(0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) : -1;
    const visible = Array.from(host.querySelectorAll<HTMLElement>('.theme-control-surface'));

    return visible.map((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        className: String(element.className),
        text: (element.innerText || element.getAttribute('value') || element.textContent || '').replace(/\s+/g, ' ').trim(),
        background: style.backgroundColor,
        color: style.color,
        borderColor: style.borderColor,
        backgroundLuminance: luminance(parseRgb(style.backgroundColor)),
        textLuminance: luminance(parseRgb(style.color)),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    });
  });
}

async function injectThemePickerDropdownSample(page: Page) {
  return page.evaluate(() => {
    document.querySelector('[data-testid="theme-picker-dropdown-sample"]')?.remove();

    const host = document.createElement('div');
    host.setAttribute('data-testid', 'theme-picker-dropdown-sample');
    host.className = 'ant-picker-dropdown';
    host.style.cssText = [
      'position: fixed',
      'left: 220px',
      'top: 116px',
      'z-index: 2147482800',
      'pointer-events: none',
    ].join(';');
    host.innerHTML = `
      <div class="ant-picker-panel-container">
        <div class="ant-picker-panel">
          <div class="ant-picker-header">
            <button type="button">上月</button>
            <div class="ant-picker-header-view">2026年5月</div>
            <button type="button">下月</button>
          </div>
          <div class="ant-picker-body">
            <table class="ant-picker-content">
              <thead><tr><th>一</th><th>二</th><th>三</th></tr></thead>
              <tbody>
                <tr>
                  <td class="ant-picker-cell ant-picker-cell-in-view"><div class="ant-picker-cell-inner">18</div></td>
                  <td class="ant-picker-cell ant-picker-cell-in-view ant-picker-cell-selected"><div class="ant-picker-cell-inner">19</div></td>
                  <td class="ant-picker-cell ant-picker-cell-disabled"><div class="ant-picker-cell-inner">20</div></td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="ant-picker-footer">今天</div>
        </div>
      </div>
    `;
    document.body.appendChild(host);
  });
}

async function sampleThemeFeedbackEdgeSurfaces(page: Page) {
  return page.evaluate(() => {
    document.querySelector('[data-testid="theme-feedback-edge-samples"]')?.remove();

    const mount = document.querySelector<HTMLElement>('.module-page') ?? document.body;
    const host = document.createElement('div');
    host.setAttribute('data-testid', 'theme-feedback-edge-samples');
    host.style.cssText = [
      'position: fixed',
      'left: 180px',
      'top: 92px',
      'z-index: 2147482950',
      'display: grid',
      'grid-template-columns: repeat(2, minmax(180px, 240px))',
      'gap: 8px',
      'padding: 8px',
      'pointer-events: auto',
    ].join(';');
    host.innerHTML = `
      <button class="ant-btn ant-btn-default theme-feedback-focus theme-feedback-surface" type="button"><span>焦点按钮</span></button>
      <input class="ant-input theme-feedback-input theme-feedback-surface" value="焦点输入" />
      <div class="ant-skeleton ant-skeleton-active theme-feedback-skeleton theme-feedback-surface">
        <div class="ant-skeleton-content">
          <h3 class="ant-skeleton-title"></h3>
          <ul class="ant-skeleton-paragraph"><li></li><li></li></ul>
        </div>
      </div>
      <div class="ant-popover theme-feedback-popover">
        <div class="ant-popover-inner theme-feedback-surface">
          <div class="ant-popover-title">浮层标题</div>
          <div class="ant-popover-inner-content">
            <div class="ant-popconfirm">
              <div class="ant-popconfirm-title">确认标题</div>
              <div class="ant-popconfirm-description">确认说明</div>
            </div>
          </div>
        </div>
      </div>
    `;
    mount.appendChild(host);

    const focusTarget = host.querySelector<HTMLElement>('.theme-feedback-focus');
    focusTarget?.focus({ preventScroll: true });

    const parseRgb = (value: string) => {
      const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (!match) return null;
      return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: Number(match[4] ?? '1') };
    };
    const luminance = (rgb: { r: number; g: number; b: number } | null) =>
      rgb ? Math.round(0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) : -1;
    const read = (element: HTMLElement) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        className: String(element.className),
        text: (element.innerText || element.getAttribute('value') || element.textContent || '').replace(/\s+/g, ' ').trim(),
        background: style.backgroundColor,
        color: style.color,
        borderColor: style.borderColor,
        outlineColor: style.outlineColor,
        outlineStyle: style.outlineStyle,
        outlineWidth: Number.parseFloat(style.outlineWidth || '0'),
        backgroundLuminance: luminance(parseRgb(style.backgroundColor)),
        textLuminance: luminance(parseRgb(style.color)),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    };

    return {
      surfaces: Array.from(host.querySelectorAll<HTMLElement>('.theme-feedback-surface')).map(read),
      skeletonBlocks: Array.from(host.querySelectorAll<HTMLElement>('.ant-skeleton-title, .ant-skeleton-paragraph > li')).map(read),
      popoverText: Array.from(host.querySelectorAll<HTMLElement>('.ant-popover-title, .ant-popconfirm-title, .ant-popconfirm-description')).map(read),
      focused: focusTarget ? read(focusTarget) : null,
      autofillRulePresent: Array.from(document.styleSheets).some((sheet) => {
        try {
          return Array.from(sheet.cssRules).some((rule) => rule.cssText.includes(':-webkit-autofill'));
        } catch {
          return false;
        }
      }),
    };
  });
}

async function sampleThemeCompositeSurfaces(page: Page) {
  return page.evaluate(() => {
    document.querySelector('[data-testid="theme-composite-samples"]')?.remove();
    document.querySelector('[data-testid="theme-composite-portal-samples"]')?.remove();

    const mount = document.querySelector<HTMLElement>('.module-page') ?? document.body;
    const host = document.createElement('div');
    host.setAttribute('data-testid', 'theme-composite-samples');
    host.style.cssText = [
      'position: fixed',
      'left: 180px',
      'bottom: 64px',
      'z-index: 2147482940',
      'display: grid',
      'grid-template-columns: repeat(2, minmax(220px, 280px))',
      'gap: 8px',
      'padding: 8px',
      'pointer-events: none',
    ].join(';');
    host.innerHTML = `
      <div class="ant-alert ant-alert-info ant-alert-with-description theme-composite-surface">
        <span class="ant-alert-message">组合提示标题</span>
        <span class="ant-alert-description">组合提示说明</span>
      </div>
      <div class="theme-composite-surface">
        <span class="ant-tag ant-tag-default theme-composite-tag">默认标签</span>
        <span class="ant-tag ant-tag-processing theme-composite-tag">运行中</span>
        <span class="ant-tag ant-tag-success theme-composite-tag">成功</span>
      </div>
      <div class="ant-progress ant-progress-line theme-composite-surface">
        <div class="ant-progress-outer">
          <div class="ant-progress-inner"><div class="ant-progress-bg" style="width: 62%; height: 8px;"></div></div>
        </div>
        <span class="ant-progress-text">62%</span>
      </div>
      <div class="ant-descriptions ant-descriptions-bordered theme-composite-surface">
        <div class="ant-descriptions-view">
          <table class="ant-descriptions-table"><tbody>
            <tr class="ant-descriptions-row">
              <td class="ant-descriptions-item-label theme-composite-description">字段</td>
              <td class="ant-descriptions-item-content theme-composite-description">内容</td>
            </tr>
          </tbody></table>
        </div>
      </div>
    `;
    mount.appendChild(host);

    const portal = document.createElement('div');
    portal.setAttribute('data-testid', 'theme-composite-portal-samples');
    portal.style.cssText = [
      'position: fixed',
      'right: 24px',
      'bottom: 64px',
      'z-index: 2147482960',
      'display: grid',
      'grid-template-columns: repeat(3, minmax(180px, 240px))',
      'gap: 8px',
      'pointer-events: none',
    ].join(';');
    portal.innerHTML = `
      <div class="ant-dropdown">
        <ul class="ant-dropdown-menu ant-dropdown-menu-root theme-composite-surface">
          <li class="ant-dropdown-menu-item">普通菜单</li>
          <li class="ant-dropdown-menu-item ant-dropdown-menu-item-active">激活菜单</li>
          <li class="ant-dropdown-menu-item ant-dropdown-menu-item-disabled">禁用菜单</li>
        </ul>
      </div>
      <div class="ant-modal-root">
        <div class="ant-modal">
          <div class="ant-modal-content theme-composite-surface">
            <div class="ant-modal-header"><div class="ant-modal-title">标准弹窗</div><button class="ant-modal-close" type="button">关闭</button></div>
            <div class="ant-modal-body">弹窗正文内容</div>
            <div class="ant-modal-footer"><button class="ant-btn ant-btn-default" type="button">取消</button></div>
          </div>
        </div>
      </div>
      <div class="ant-drawer-root">
        <div class="ant-drawer-content theme-composite-surface">
          <div class="ant-drawer-header"><div class="ant-drawer-title">详情抽屉</div><button class="ant-drawer-close" type="button">关闭</button></div>
          <div class="ant-drawer-body">抽屉正文内容</div>
        </div>
      </div>
    `;
    document.body.appendChild(portal);

    const parseRgb = (value: string) => {
      const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (!match) return null;
      return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: Number(match[4] ?? '1') };
    };
    const luminance = (rgb: { r: number; g: number; b: number } | null) =>
      rgb ? Math.round(0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) : -1;
    const read = (element: HTMLElement) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        className: String(element.className),
        text: (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim(),
        background: style.backgroundColor,
        color: style.color,
        borderColor: style.borderColor,
        backgroundLuminance: luminance(parseRgb(style.backgroundColor)),
        textLuminance: luminance(parseRgb(style.color)),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    };

    return {
      surfaces: Array.from(document.querySelectorAll<HTMLElement>('[data-testid="theme-composite-samples"] .theme-composite-surface, [data-testid="theme-composite-portal-samples"] .theme-composite-surface')).map(read),
      descriptionCells: Array.from(document.querySelectorAll<HTMLElement>('.theme-composite-description')).map(read),
      dropdownItems: Array.from(portal.querySelectorAll<HTMLElement>('.ant-dropdown-menu-item')).map(read),
      modalText: Array.from(portal.querySelectorAll<HTMLElement>('.ant-modal-title, .ant-modal-close, .ant-modal-body')).map(read),
      drawerText: Array.from(portal.querySelectorAll<HTMLElement>('.ant-drawer-title, .ant-drawer-close, .ant-drawer-body')).map(read),
      progressInner: read(host.querySelector<HTMLElement>('.ant-progress-inner')!),
      tags: Array.from(host.querySelectorAll<HTMLElement>('.theme-composite-tag')).map(read),
    };
  });
}

async function readExistingThemeCompositeSurfaces(page: Page) {
  return page.evaluate(() => {
    const portal = document.querySelector<HTMLElement>('[data-testid="theme-composite-portal-samples"]');
    const parseRgb = (value: string) => {
      const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (!match) return null;
      return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: Number(match[4] ?? '1') };
    };
    const luminance = (rgb: { r: number; g: number; b: number } | null) =>
      rgb ? Math.round(0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) : -1;
    const read = (element: HTMLElement) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        className: String(element.className),
        text: (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim(),
        background: style.backgroundColor,
        color: style.color,
        borderColor: style.borderColor,
        backgroundLuminance: luminance(parseRgb(style.backgroundColor)),
        textLuminance: luminance(parseRgb(style.color)),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    };

    return {
      surfaces: Array.from(document.querySelectorAll<HTMLElement>('[data-testid="theme-composite-samples"] .theme-composite-surface, [data-testid="theme-composite-portal-samples"] .theme-composite-surface')).map(read),
      descriptionCells: Array.from(document.querySelectorAll<HTMLElement>('.theme-composite-description')).map(read),
      dropdownItems: portal ? Array.from(portal.querySelectorAll<HTMLElement>('.ant-dropdown-menu-item')).map(read) : [],
      modalText: portal ? Array.from(portal.querySelectorAll<HTMLElement>('.ant-modal-title, .ant-modal-close, .ant-modal-body')).map(read) : [],
      drawerText: portal ? Array.from(portal.querySelectorAll<HTMLElement>('.ant-drawer-title, .ant-drawer-close, .ant-drawer-body')).map(read) : [],
      progressInner: document.querySelector<HTMLElement>('[data-testid="theme-composite-samples"] .ant-progress-inner')
        ? read(document.querySelector<HTMLElement>('[data-testid="theme-composite-samples"] .ant-progress-inner')!)
        : null,
      theme: document.documentElement.dataset.theme,
    };
  });
}

async function sampleDynamicThemeChromeSurfaces(page: Page) {
  return page.evaluate(() => {
    document.querySelector('[data-testid="dynamic-theme-color-sample"]')?.remove();

    const mount = document.querySelector<HTMLElement>('.module-page') ?? document.body;
    const host = document.createElement('div');
    host.setAttribute('data-testid', 'dynamic-theme-color-sample');
    host.style.cssText = [
      'position: fixed',
      'left: 144px',
      'bottom: 54px',
      'z-index: 2147482700',
      'display: grid',
      'grid-template-columns: repeat(4, minmax(132px, 180px))',
      'gap: 8px',
      'padding: 8px',
      'pointer-events: none',
    ].join(';');
    host.innerHTML = `
      <button class="ant-btn ant-btn-default dynamic-theme-surface" type="button"><span>普通按钮</span></button>
      <button class="ant-btn ant-btn-primary ant-btn-disabled dynamic-theme-surface" disabled type="button"><span>禁用主按钮</span></button>
      <button class="ant-btn ant-btn-primary ant-btn-loading dynamic-theme-surface" type="button"><span>忙碌主按钮</span></button>
      <input class="ant-input dynamic-theme-surface" value="主题输入框" />
      <div class="ant-select ant-select-single dynamic-theme-surface-wrap"><div class="ant-select-selector dynamic-theme-surface"><span class="ant-select-selection-item">主题下拉</span></div></div>
      <span class="ant-tag dynamic-theme-surface">默认标签</span>
      <span class="ant-tag ant-tag-success dynamic-theme-surface">成功标签</span>
      <span class="data-freshness-tag data-freshness-tag--fresh dynamic-theme-surface">刷新时间</span>
      <button class="ant-switch ant-switch-checked dynamic-theme-surface" type="button"><span class="ant-switch-handle"></span></button>
    `;
    mount.appendChild(host);

    const parseRgb = (value: string) => {
      const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (!match) return null;
      return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: Number(match[4] ?? '1') };
    };
    const luminance = (rgb: { r: number; g: number; b: number } | null) =>
      rgb ? Math.round(0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) : -1;
    const relative = (value: number) => {
      const channel = value / 255;
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    };
    const contrast = (
      fg: { r: number; g: number; b: number } | null,
      bg: { r: number; g: number; b: number } | null,
    ) => {
      if (!fg || !bg) return -1;
      const fgLum = 0.2126 * relative(fg.r) + 0.7152 * relative(fg.g) + 0.0722 * relative(fg.b);
      const bgLum = 0.2126 * relative(bg.r) + 0.7152 * relative(bg.g) + 0.0722 * relative(bg.b);
      const [lighter, darker] = fgLum >= bgLum ? [fgLum, bgLum] : [bgLum, fgLum];
      return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100;
    };
    const effectiveBackground = (element: HTMLElement) => {
      let current: HTMLElement | null = element;
      while (current) {
        const value = getComputedStyle(current).backgroundColor;
        const rgb = parseRgb(value);
        if (rgb && rgb.a > 0.2) {
          return { value, rgb };
        }
        current = current.parentElement;
      }
      const value = getComputedStyle(document.body).backgroundColor;
      return { value, rgb: parseRgb(value) };
    };
    const read = (name: string, element: HTMLElement | null) => {
      if (!element) {
        return {
          name,
          missing: true,
          className: '',
          text: '',
          background: '',
          color: '',
          borderColor: '',
          backgroundLuminance: -1,
          textLuminance: -1,
          contrastRatio: -1,
          width: 0,
          height: 0,
        };
      }
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const effectiveBg = effectiveBackground(element);
      const fg = parseRgb(style.color);
      return {
        name,
        missing: false,
        className: String(element.className || element.tagName).slice(0, 160),
        tagName: element.tagName,
        disabledAttr: element.hasAttribute('disabled'),
        disabledProp: element instanceof HTMLButtonElement ? element.disabled : false,
        loadingClass: element.classList.contains('ant-btn-loading'),
        text: (element.innerText || element.getAttribute('value') || element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
        background: effectiveBg.value,
        color: style.color,
        borderColor: style.borderColor,
        backgroundLuminance: luminance(effectiveBg.rgb),
        textLuminance: luminance(fg),
        contrastRatio: contrast(fg, effectiveBg.rgb),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    };

    const entries = [
      read('left-sider', document.querySelector<HTMLElement>('.app-shell__sider')),
      read('top-status', document.querySelector<HTMLElement>('.status-strip')),
      read('bottom-status', document.querySelector<HTMLElement>('.app-shell__bottom-status')),
      read('menu-item', document.querySelector<HTMLElement>('.app-shell__menu .ant-menu-item')),
      read('selected-menu-item', document.querySelector<HTMLElement>('.app-shell__menu .ant-menu-item-selected')),
      read('sample-default-button', host.querySelector<HTMLElement>('.ant-btn-default')),
      read('sample-disabled-primary-button', host.querySelector<HTMLElement>('.ant-btn-primary')),
      read('sample-loading-primary-button', host.querySelector<HTMLElement>('.ant-btn-loading')),
      read('sample-input', host.querySelector<HTMLElement>('.ant-input')),
      read('sample-select', host.querySelector<HTMLElement>('.ant-select-selector')),
      read('sample-default-tag', host.querySelector<HTMLElement>('.ant-tag:not(.ant-tag-success)')),
      read('sample-success-tag', host.querySelector<HTMLElement>('.ant-tag-success')),
      read('sample-freshness-tag', host.querySelector<HTMLElement>('.data-freshness-tag')),
      read('sample-switch', host.querySelector<HTMLElement>('.ant-switch')),
    ];

    return {
      theme: document.documentElement.dataset.theme,
      colorScheme: getComputedStyle(document.documentElement).colorScheme,
      entries,
      busyButtons: Array.from(document.querySelectorAll<HTMLElement>('.module-page :is(button.ant-btn[disabled], button.ant-btn.ant-btn-disabled, button.ant-btn.ant-btn-loading)'))
        .map((element, index) => read(`real-busy-button-${index + 1}`, element)),
      disabledPrimary: read('real-disabled-primary', document.querySelector<HTMLElement>('.app-shell .ant-btn-primary:disabled, .app-shell .ant-btn-primary.ant-btn-disabled')),
    };
  });
}

test('六大菜单和关键页面可打开', async ({ page }) => {
  test.setTimeout(60000);
  await page.goto('/dashboard');
  for (const menu of ['总览看板', '数据中心', '策略开发', '回测研究', '交易执行', '系统管理']) {
    await expect(page.getByRole('menuitem', { name: new RegExp(menu) })).toBeVisible();
  }

  await expect(page.getByRole('heading', { name: '总览看板' })).toBeVisible();
  await page.getByRole('tab', { name: '任务状态' }).click();
  await expect(page.getByTestId('table-dashboard-tasks')).toBeVisible();

  await page.goto('/data-center?tab=数据同步');
  await expect(page).toHaveURL(/\/data-center/);
  await expect(page.getByRole('heading', { name: '数据中心' })).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('table-sync-tasks')).toBeVisible({ timeout: 15000 });

  await page.goto('/strategy-dev');
  await expect(page).toHaveURL(/\/strategy-dev/);
  await expect(page.getByRole('heading', { name: '策略开发' })).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('table-strategy-files')).toBeVisible({ timeout: 15000 });

  await page.goto('/backtest?tab=回测任务');
  await expect(page).toHaveURL(/\/backtest/);
  await expect(page.getByRole('heading', { name: '回测研究' })).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('table-backtest-tasks')).toBeVisible({ timeout: 15000 });

  await page.goto('/trading?tab=信号下单');
  await expect(page).toHaveURL(/\/trading/);
  await expect(page.getByRole('heading', { name: '交易执行' })).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('table-trading-signals')).toBeVisible({ timeout: 15000 });

  await page.goto('/system?tab=日志中心');
  await expect(page).toHaveURL(/\/system/);
  await expect(page.getByRole('heading', { name: '系统管理' })).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('table-system-logs')).toBeVisible({ timeout: 15000 });
});

test('深色和浅色主题可切换并跨页面保持', async ({ page }) => {
  test.setTimeout(60000);
  await page.addInitScript(() => {
    if (!window.sessionStorage.getItem('lqc_theme_mode_test_initialized')) {
      window.localStorage.removeItem('lqc_theme_mode');
      window.sessionStorage.setItem('lqc_theme_mode_test_initialized', '1');
    }
  });

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: '总览看板' })).toBeVisible({ timeout: 30000 });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByTestId('btn-theme-mode')).toBeVisible();

  await page.getByTestId('btn-theme-mode').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect.poll(async () => page.evaluate(() => window.localStorage.getItem('lqc_theme_mode'))).toBe('light');
  await expect.poll(async () => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('light');
  await expect(page.getByTestId('btn-theme-mode')).toContainText('浅色');

  const lightMetrics = await page.evaluate(() => {
    const appShell = document.querySelector<HTMLElement>('.app-shell');
    const statusStrip = document.querySelector<HTMLElement>('.status-strip');
    return {
      shellBg: appShell ? getComputedStyle(appShell).backgroundColor : '',
      statusBg: statusStrip ? getComputedStyle(statusStrip).backgroundColor : '',
    };
  });
  expect(lightMetrics.shellBg, '浅色主题下 AppShell 不应继续使用纯深色背景').not.toBe('rgb(11, 15, 20)');
  expect(lightMetrics.statusBg, '浅色主题下顶部状态栏应切换为浅色背景').toBe('rgb(255, 255, 255)');

  await page.goto('/data-center?tab=数据字典');
  await expect(page.getByRole('heading', { name: '数据中心' })).toBeVisible({ timeout: 30000 });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByTestId('btn-theme-mode')).toContainText('浅色');
  await expect.poll(async () => page.locator('.ant-table').first().evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgb(255, 255, 255)');

  await page.getByTestId('btn-theme-mode').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(async () => page.evaluate(() => window.localStorage.getItem('lqc_theme_mode'))).toBe('dark');
  await expect.poll(async () => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('dark');
  await expect(page.getByTestId('btn-theme-mode')).toContainText('深色');
});

test('主题切换期间临时关闭颜色过渡并可靠释放', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('lqc_theme_mode', 'dark');
    window.localStorage.setItem('lqc_display_density', 'compact');
  });

  await page.goto('/data-center', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: '数据中心' })).toBeVisible({ timeout: 30000 });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.evaluate(() => {
    const root = document.documentElement;
    const probeWindow = window as Window & {
      __lqcThemeSwitchEvents?: string[];
      __lqcThemeSwitchObserver?: MutationObserver;
    };
    probeWindow.__lqcThemeSwitchEvents = [];
    probeWindow.__lqcThemeSwitchObserver?.disconnect();
    probeWindow.__lqcThemeSwitchObserver = new MutationObserver(() => {
      probeWindow.__lqcThemeSwitchEvents?.push(root.dataset.themeSwitching || '');
    });
    probeWindow.__lqcThemeSwitchObserver.observe(root, {
      attributes: true,
      attributeFilter: ['data-theme-switching'],
    });
  });

  await page.getByTestId('btn-theme-mode').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect.poll(async () => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('light');

  const switchingAudit = await page.evaluate(() => {
    const probeWindow = window as Window & { __lqcThemeSwitchEvents?: string[] };
    const themeButton = document.querySelector<HTMLElement>('[data-testid="btn-theme-mode"]');
    const firstNavItem = document.querySelector<HTMLElement>('.workbench-nav__item');
    return {
      events: probeWindow.__lqcThemeSwitchEvents || [],
      buttonTransitionDuration: themeButton ? getComputedStyle(themeButton).transitionDuration : '',
      navTransitionDuration: firstNavItem ? getComputedStyle(firstNavItem).transitionDuration : '',
    };
  });

  expect(switchingAudit.events).toContain('true');
  expect(switchingAudit.buttonTransitionDuration.split(',').every((item) => item.trim() === '0s')).toBeTruthy();
  if (switchingAudit.navTransitionDuration) {
    expect(switchingAudit.navTransitionDuration.split(',').every((item) => item.trim() === '0s')).toBeTruthy();
  }

  await expect.poll(async () => page.locator('html').getAttribute('data-theme-switching'), { timeout: 3000 }).toBeNull();
});

test('告警状态条和浅色主操作色不残留旧版深色', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('lqc_theme_mode', 'dark');
    window.localStorage.setItem('lqc_display_density', 'compact');
  });

  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: '总览看板' })).toBeVisible({ timeout: 30000 });

  const readWarningStrip = async () =>
    page.evaluate(() => {
      const strip = document.querySelector<HTMLElement>('.status-strip');
      if (!strip) throw new Error('status-strip missing');
      strip.classList.add('status-strip--warning');
      const style = getComputedStyle(strip);
      const rootStyle = getComputedStyle(document.documentElement);
      return {
        theme: document.documentElement.dataset.theme,
        backgroundImage: style.backgroundImage,
        borderBottomColor: style.borderBottomColor,
        actionPrimaryBg: rootStyle.getPropertyValue('--lqc-action-primary-bg').trim(),
        linkColor: rootStyle.getPropertyValue('--lqc-link-color').trim(),
      };
    });

  const darkWarning = await readWarningStrip();
  expect(darkWarning.theme).toBe('dark');
  expect(darkWarning.backgroundImage).not.toContain('21, 26, 35');
  expect(darkWarning.backgroundImage).toContain('33, 24, 13');

  await page.getByTestId('btn-theme-mode').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect.poll(async () => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('light');

  const lightWarning = await readWarningStrip();
  expect(lightWarning.theme).toBe('light');
  expect(lightWarning.backgroundImage).not.toContain('21, 26, 35');
  expect(lightWarning.backgroundImage).toContain('255, 251, 235');
  expect(lightWarning.actionPrimaryBg).toBe('#0a58ca');
  expect(lightWarning.linkColor).toBe('#0a58ca');
});

test('真实点击主题切换后六大页面外壳和控件颜色同步刷新', async ({ page }) => {
  test.setTimeout(120000);
  await page.addInitScript(() => {
    if (!window.sessionStorage.getItem('lqc_dynamic_theme_click_test_initialized')) {
      window.localStorage.setItem('lqc_theme_mode', 'dark');
      window.localStorage.setItem('lqc_display_density', 'compact');
      window.sessionStorage.setItem('lqc_dynamic_theme_click_test_initialized', '1');
    }
  });

  const pages = [
    { url: '/dashboard', heading: '总览看板' },
    { url: '/data-center?tab=数据概览', heading: '数据中心' },
    { url: '/strategy-dev', heading: '策略开发' },
    { url: '/backtest?tab=新建回测', heading: '回测研究' },
    { url: '/trading?tab=信号下单', heading: '交易执行' },
    { url: '/system', heading: '系统管理' },
  ];

  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: '总览看板' })).toBeVisible({ timeout: 30000 });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.getByTestId('btn-theme-mode').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect.poll(async () => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('light');

  for (const item of pages) {
    await page.goto(item.url, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: item.heading })).toBeVisible({ timeout: 30000 });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(scanVisibleDarkSurfaceLeaks(page, '.app-shell'), `${item.heading} 点击切到浅色后仍残留暗色块`).resolves.toEqual([]);

    const audit = await sampleDynamicThemeChromeSurfaces(page);
    const missing = audit.entries.filter((entry) => entry.missing).map((entry) => entry.name);
    expect(missing, `${item.heading} 浅色主题关键样本缺失: ${JSON.stringify(audit.entries)}`).toEqual([]);
    expect(
      audit.entries
        .filter((entry) => !entry.name.includes('switch'))
        .every((entry) => entry.backgroundLuminance > 175),
      `${item.heading} 浅色主题关键控件背景仍偏暗: ${JSON.stringify(audit.entries)}`,
    ).toBeTruthy();
    expect(
      audit.entries
        .filter((entry) => entry.text && !entry.name.includes('switch'))
        .every((entry) => entry.contrastRatio >= 3),
      `${item.heading} 浅色主题关键控件文字对比不足: ${JSON.stringify(audit.entries)}`,
    ).toBeTruthy();
    expect(
      audit.entries.find((entry) => entry.name === 'sample-disabled-primary-button')?.backgroundLuminance ?? 0,
      `${item.heading} 浅色主题禁用主按钮仍像可点击主按钮: ${JSON.stringify(audit.entries)}`,
    ).toBeGreaterThan(200);
    expect(
      audit.entries.find((entry) => entry.name === 'sample-loading-primary-button')?.backgroundLuminance ?? 0,
      `${item.heading} 浅色主题忙碌主按钮仍像可点击主按钮: ${JSON.stringify(audit.entries)}`,
    ).toBeGreaterThan(200);
    expect(
      audit.busyButtons.filter((entry) => entry.backgroundLuminance < 200),
      `${item.heading} 浅色主题真实忙碌/禁用按钮仍残留深色或主色: ${JSON.stringify(audit.busyButtons)}`,
    ).toEqual([]);
  }

  await page.getByTestId('btn-theme-mode').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(async () => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('dark');

  for (const item of pages) {
    await page.goto(item.url, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: item.heading })).toBeVisible({ timeout: 30000 });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(scanVisibleLightSurfaceLeaks(page, '.app-shell'), `${item.heading} 点击切回深色后仍泄漏浅色块`).resolves.toEqual([]);

    const audit = await sampleDynamicThemeChromeSurfaces(page);
    const missing = audit.entries.filter((entry) => entry.missing).map((entry) => entry.name);
    expect(missing, `${item.heading} 深色主题关键样本缺失: ${JSON.stringify(audit.entries)}`).toEqual([]);
    expect(
      audit.entries
        .filter((entry) => !entry.name.includes('switch'))
        .every((entry) => entry.backgroundLuminance >= 0 && entry.backgroundLuminance < 128),
      `${item.heading} 深色主题关键控件背景仍偏亮: ${JSON.stringify(audit.entries)}`,
    ).toBeTruthy();
    expect(
      audit.entries
        .filter((entry) => entry.text && !entry.name.includes('switch'))
        .every((entry) => entry.contrastRatio >= 3),
      `${item.heading} 深色主题关键控件文字对比不足: ${JSON.stringify(audit.entries)}`,
    ).toBeTruthy();
    expect(
      audit.entries.find((entry) => entry.name === 'sample-disabled-primary-button')?.backgroundLuminance ?? 255,
      `${item.heading} 深色主题禁用主按钮仍像可点击主按钮: ${JSON.stringify(audit.entries)}`,
    ).toBeLessThan(90);
    expect(
      audit.entries.find((entry) => entry.name === 'sample-loading-primary-button')?.backgroundLuminance ?? 255,
      `${item.heading} 深色主题忙碌主按钮仍像可点击主按钮: ${JSON.stringify(audit.entries)}`,
    ).toBeLessThan(90);
    expect(
      audit.busyButtons.filter((entry) => entry.backgroundLuminance > 90),
      `${item.heading} 深色主题真实忙碌/禁用按钮仍泄漏浅色或主色: ${JSON.stringify(audit.busyButtons)}`,
    ).toEqual([]);
  }
});

test('主题切换后消息和通知浮层颜色跟随主题', async ({ page }) => {
  test.setTimeout(60000);
  await page.addInitScript(() => {
    window.localStorage.setItem('lqc_theme_mode', 'dark');
    window.localStorage.setItem('lqc_display_density', 'compact');
  });

  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: '总览看板' })).toBeVisible({ timeout: 30000 });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  const darkMetrics = await sampleThemeOverlaySurfaces(page);
  expect(darkMetrics, '深色主题消息/通知样本未渲染').toHaveLength(2);
  expect(
    darkMetrics.every((item) => item.backgroundLuminance >= 0 && item.backgroundLuminance < 72 && item.textLuminance > 170),
    `深色主题消息/通知浮层颜色异常: ${JSON.stringify(darkMetrics)}`,
  ).toBeTruthy();

  await page.getByTestId('btn-theme-mode').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect.poll(async () => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('light');

  const lightMetrics = await sampleThemeOverlaySurfaces(page);
  expect(lightMetrics, '浅色主题消息/通知样本未渲染').toHaveLength(2);
  expect(
    lightMetrics.every((item) => item.backgroundLuminance > 225 && item.textLuminance >= 0 && item.textLuminance < 105),
    `浅色主题消息/通知浮层颜色异常: ${JSON.stringify(lightMetrics)}`,
  ).toBeTruthy();
});

test('主题切换后表单控件状态颜色跟随主题', async ({ page }) => {
  test.setTimeout(60000);
  await page.addInitScript(() => {
    window.localStorage.setItem('lqc_theme_mode', 'dark');
    window.localStorage.setItem('lqc_display_density', 'compact');
  });

  await page.goto('/trading?tab=交易面板', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: '交易执行' })).toBeVisible({ timeout: 30000 });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  const darkMetrics = await sampleThemeControlStateSurfaces(page);
  expect(darkMetrics.length, '深色主题控件状态样本不足').toBeGreaterThanOrEqual(12);
  expect(
    darkMetrics
      .filter((item) => !item.className.includes('ant-form-item-explain-error')
        && !item.className.includes('ant-switch')
        && !item.className.includes('ant-checkbox-inner')
        && !item.className.includes('ant-radio-button-wrapper-checked'))
      .every((item) => item.backgroundLuminance >= 0 && item.backgroundLuminance < 90),
    `深色主题控件背景异常: ${JSON.stringify(darkMetrics)}`,
  ).toBeTruthy();
  expect(
    darkMetrics.some((item) => item.className.includes('ant-form-item-explain-error') && item.textLuminance > 95 && item.textLuminance < 170),
    `深色主题错误提示颜色异常: ${JSON.stringify(darkMetrics)}`,
  ).toBeTruthy();

  await page.getByTestId('btn-theme-mode').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect.poll(async () => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('light');

  const lightMetrics = await sampleThemeControlStateSurfaces(page);
  expect(lightMetrics.length, '浅色主题控件状态样本不足').toBeGreaterThanOrEqual(12);
  expect(
    lightMetrics
      .filter((item) => !item.className.includes('ant-form-item-explain-error')
        && !item.className.includes('ant-switch')
        && !item.className.includes('ant-checkbox-inner')
        && !item.className.includes('ant-radio-button-wrapper-checked'))
      .every((item) => item.backgroundLuminance > 210),
    `浅色主题控件背景异常: ${JSON.stringify(lightMetrics)}`,
  ).toBeTruthy();
  expect(
    lightMetrics.some((item) => item.className.includes('ant-form-item-explain-error') && item.textLuminance > 45 && item.textLuminance < 130),
    `浅色主题错误提示颜色异常: ${JSON.stringify(lightMetrics)}`,
  ).toBeTruthy();
});

test('主题切换后焦点、骨架屏和确认浮层颜色跟随主题', async ({ page }) => {
  test.setTimeout(60000);
  await page.addInitScript(() => {
    window.localStorage.setItem('lqc_theme_mode', 'dark');
    window.localStorage.setItem('lqc_display_density', 'compact');
  });

  await page.goto('/strategy-dev', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: '策略开发' })).toBeVisible({ timeout: 30000 });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  const darkMetrics = await sampleThemeFeedbackEdgeSurfaces(page);
  expect(darkMetrics.autofillRulePresent, '主题自动填充样式规则未挂载').toBeTruthy();
  expect(darkMetrics.focused?.outlineWidth ?? 0, `深色主题焦点轮廓不可见: ${JSON.stringify(darkMetrics.focused)}`).toBeGreaterThanOrEqual(1);
  expect(
    darkMetrics.skeletonBlocks.every((item) => item.backgroundLuminance >= 0 && item.backgroundLuminance < 90),
    `深色主题骨架屏背景异常: ${JSON.stringify(darkMetrics.skeletonBlocks)}`,
  ).toBeTruthy();
  expect(
    darkMetrics.popoverText.every((item) => item.textLuminance > 160),
    `深色主题确认浮层文字异常: ${JSON.stringify(darkMetrics.popoverText)}`,
  ).toBeTruthy();

  await page.getByTestId('btn-theme-mode').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect.poll(async () => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('light');

  const lightMetrics = await sampleThemeFeedbackEdgeSurfaces(page);
  expect(lightMetrics.autofillRulePresent, '浅色主题自动填充样式规则未挂载').toBeTruthy();
  expect(lightMetrics.focused?.outlineWidth ?? 0, `浅色主题焦点轮廓不可见: ${JSON.stringify(lightMetrics.focused)}`).toBeGreaterThanOrEqual(1);
  expect(
    lightMetrics.skeletonBlocks.every((item) => item.backgroundLuminance > 180),
    `浅色主题骨架屏背景异常: ${JSON.stringify(lightMetrics.skeletonBlocks)}`,
  ).toBeTruthy();
  expect(
    lightMetrics.popoverText.every((item) => item.textLuminance >= 0 && item.textLuminance < 120),
    `浅色主题确认浮层文字异常: ${JSON.stringify(lightMetrics.popoverText)}`,
  ).toBeTruthy();
});

test('主题切换后组合组件和门户层颜色跟随主题', async ({ page }) => {
  test.setTimeout(60000);
  await page.addInitScript(() => {
    window.localStorage.setItem('lqc_theme_mode', 'dark');
    window.localStorage.setItem('lqc_display_density', 'compact');
  });

  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: '总览看板' })).toBeVisible({ timeout: 30000 });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  const darkMetrics = await sampleThemeCompositeSurfaces(page);
  const darkFilledSurfaces = darkMetrics.surfaces.filter((item) => !item.background.startsWith('rgba(0, 0, 0, 0)'));
  const darkReadableText = [
    ...darkMetrics.dropdownItems,
    ...darkMetrics.modalText,
    ...darkMetrics.drawerText,
    ...darkMetrics.descriptionCells,
  ].filter((item) => !item.className.includes('ant-dropdown-menu-item-disabled'));
  const darkDisabledText = darkMetrics.dropdownItems.filter((item) => item.className.includes('ant-dropdown-menu-item-disabled'));
  expect(
    darkFilledSurfaces.every((item) => item.backgroundLuminance >= 0 && item.backgroundLuminance < 98),
    `深色主题组合组件背景异常: ${JSON.stringify(darkMetrics.surfaces)}`,
  ).toBeTruthy();
  expect(
    darkReadableText.every((item) => item.textLuminance > 120),
    `深色主题组合组件文字异常: ${JSON.stringify(darkMetrics)}`,
  ).toBeTruthy();
  expect(
    darkDisabledText.every((item) => item.textLuminance >= 70 && item.textLuminance <= 135),
    `深色主题禁用菜单文字异常: ${JSON.stringify(darkDisabledText)}`,
  ).toBeTruthy();
  expect(darkMetrics.progressInner.backgroundLuminance, `深色主题进度条底色异常: ${JSON.stringify(darkMetrics.progressInner)}`).toBeLessThan(100);

  await page.getByTestId('btn-theme-mode').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect.poll(async () => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('light');

  const lightMetrics = await sampleThemeCompositeSurfaces(page);
  const lightFilledSurfaces = lightMetrics.surfaces.filter((item) => !item.background.startsWith('rgba(0, 0, 0, 0)'));
  const lightReadableText = [
    ...lightMetrics.dropdownItems,
    ...lightMetrics.modalText,
    ...lightMetrics.drawerText,
    ...lightMetrics.descriptionCells,
  ].filter((item) => !item.className.includes('ant-dropdown-menu-item-disabled'));
  const lightDisabledText = lightMetrics.dropdownItems.filter((item) => item.className.includes('ant-dropdown-menu-item-disabled'));
  expect(
    lightFilledSurfaces.every((item) => item.backgroundLuminance > 210),
    `浅色主题组合组件背景异常: ${JSON.stringify(lightMetrics.surfaces)}`,
  ).toBeTruthy();
  expect(
    lightReadableText.every((item) => item.textLuminance >= 0 && item.textLuminance < 135),
    `浅色主题组合组件文字异常: ${JSON.stringify(lightMetrics)}`,
  ).toBeTruthy();
  expect(
    lightDisabledText.every((item) => item.textLuminance > 80 && item.textLuminance < 180),
    `浅色主题禁用菜单文字异常: ${JSON.stringify(lightDisabledText)}`,
  ).toBeTruthy();
  expect(lightMetrics.progressInner.backgroundLuminance, `浅色主题进度条底色异常: ${JSON.stringify(lightMetrics.progressInner)}`).toBeGreaterThan(180);
});

test('已打开门户层在主题切换时同步换肤', async ({ page }) => {
  test.setTimeout(60000);
  await page.addInitScript(() => {
    window.localStorage.setItem('lqc_theme_mode', 'dark');
    window.localStorage.setItem('lqc_display_density', 'compact');
  });

  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: '总览看板' })).toBeVisible({ timeout: 30000 });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  const darkMetrics = await sampleThemeCompositeSurfaces(page);
  expect(darkMetrics.surfaces.length, '主题门户层样本未初始化').toBeGreaterThanOrEqual(6);
  expect(
    darkMetrics.surfaces
      .filter((item) => !item.background.startsWith('rgba(0, 0, 0, 0)'))
      .every((item) => item.backgroundLuminance >= 0 && item.backgroundLuminance < 98),
    `深色主题已打开门户层背景异常: ${JSON.stringify(darkMetrics.surfaces)}`,
  ).toBeTruthy();

  await page.getByTestId('btn-theme-mode').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect.poll(async () => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('light');

  const lightMetrics = await readExistingThemeCompositeSurfaces(page);
  const lightReadableText = [
    ...lightMetrics.dropdownItems,
    ...lightMetrics.modalText,
    ...lightMetrics.drawerText,
    ...lightMetrics.descriptionCells,
  ].filter((item) => !item.className.includes('ant-dropdown-menu-item-disabled'));
  expect(lightMetrics.theme, '已打开门户层切换后主题未同步到 light').toBe('light');
  expect(
    lightMetrics.surfaces
      .filter((item) => !item.background.startsWith('rgba(0, 0, 0, 0)'))
      .every((item) => item.backgroundLuminance > 210),
    `浅色主题已打开门户层背景未同步: ${JSON.stringify(lightMetrics.surfaces)}`,
  ).toBeTruthy();
  expect(
    lightReadableText.every((item) => item.textLuminance >= 0 && item.textLuminance < 135),
    `浅色主题已打开门户层文字未同步: ${JSON.stringify(lightReadableText)}`,
  ).toBeTruthy();
  expect(lightMetrics.progressInner?.backgroundLuminance ?? 0, `浅色主题进度条底色未同步: ${JSON.stringify(lightMetrics.progressInner)}`).toBeGreaterThan(180);

  await page.getByTestId('btn-theme-mode').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(async () => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('dark');

  const darkAgainMetrics = await readExistingThemeCompositeSurfaces(page);
  const darkReadableText = [
    ...darkAgainMetrics.dropdownItems,
    ...darkAgainMetrics.modalText,
    ...darkAgainMetrics.drawerText,
    ...darkAgainMetrics.descriptionCells,
  ].filter((item) => !item.className.includes('ant-dropdown-menu-item-disabled'));
  expect(darkAgainMetrics.theme, '已打开门户层切回深色后主题未同步到 dark').toBe('dark');
  expect(
    darkAgainMetrics.surfaces
      .filter((item) => !item.background.startsWith('rgba(0, 0, 0, 0)'))
      .every((item) => item.backgroundLuminance >= 0 && item.backgroundLuminance < 98),
    `深色主题已打开门户层背景未同步: ${JSON.stringify(darkAgainMetrics.surfaces)}`,
  ).toBeTruthy();
  expect(
    darkReadableText.every((item) => item.textLuminance > 120),
    `深色主题已打开门户层文字未同步: ${JSON.stringify(darkReadableText)}`,
  ).toBeTruthy();
  expect(darkAgainMetrics.progressInner?.backgroundLuminance ?? 255, `深色主题进度条底色未同步: ${JSON.stringify(darkAgainMetrics.progressInner)}`).toBeLessThan(100);
});

test('主题和密度在应用启动前按用户偏好预挂载', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('lqc_theme_mode', 'light');
    window.localStorage.setItem('lqc_display_density', 'dense');
  });

  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('html')).toHaveAttribute('data-density', 'dense');
  await expect.poll(async () => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('light');
  await expect(page.getByRole('heading', { name: '总览看板' })).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('btn-theme-mode')).toContainText('浅色');
});

test('主题 Token 和 CSS 变量在深浅切换后保持一致', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('lqc_theme_mode', 'dark');
    window.localStorage.setItem('lqc_display_density', 'compact');
  });

  const readThemeVariables = async () => page.evaluate(() => {
    const styles = getComputedStyle(document.documentElement);
    const pick = (name: string) => styles.getPropertyValue(name).trim().toLowerCase();
    return {
      theme: document.documentElement.dataset.theme,
      colorScheme: styles.colorScheme,
      primary: pick('--lqc-primary'),
      primaryHover: pick('--lqc-primary-hover'),
      info: pick('--lqc-info'),
      textMuted: pick('--lqc-text-muted'),
      terminalBlue: pick('--lqc-terminal-blue'),
      actionPrimary: pick('--lqc-action-primary-bg'),
      link: pick('--lqc-link-color'),
      scrollbarTrack: pick('--lqc-scrollbar-track'),
      scrollbarThumb: pick('--lqc-scrollbar-thumb'),
      scrollbarThumbHover: pick('--lqc-scrollbar-thumb-hover'),
      scrollbarBorder: pick('--lqc-scrollbar-border'),
      themeColor: document.querySelector('meta[name="theme-color"]')?.getAttribute('content')?.toLowerCase() ?? '',
    };
  });

  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: '总览看板' })).toBeVisible({ timeout: 30000 });
  await expect(readThemeVariables()).resolves.toMatchObject({
    theme: 'dark',
    colorScheme: 'dark',
    primary: '#58a6ff',
    primaryHover: '#7bb8ff',
    info: '#58a6ff',
    textMuted: '#9aa8bc',
    terminalBlue: '#58a6ff',
    actionPrimary: '#0b66d8',
    link: '#58a6ff',
    scrollbarTrack: '#0b0f14',
    scrollbarThumb: '#445169',
    scrollbarThumbHover: '#53627a',
    scrollbarBorder: '#0b0f14',
    themeColor: '#0b0f14',
  });

  await page.getByTestId('btn-theme-mode').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(readThemeVariables()).resolves.toMatchObject({
    theme: 'light',
    colorScheme: 'light',
    primary: '#0a58ca',
    primaryHover: '#084db4',
    info: '#0a58ca',
    textMuted: '#5f6f83',
    terminalBlue: '#0a58ca',
    actionPrimary: '#0a58ca',
    link: '#0a58ca',
    scrollbarTrack: '#edf2f7',
    scrollbarThumb: '#b8c4d4',
    scrollbarThumbHover: '#8ea0b6',
    scrollbarBorder: '#edf2f7',
    themeColor: '#edf2f8',
  });
});

test('主题源文件不再使用旧版默认蓝和弱文本硬编码', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const root = path.resolve(process.cwd(), 'src');
  const forbiddenPatterns = [
    '#246bfe',
    '#1857d6',
    '#0f8cff',
    '#1677ff',
    '#1890ff',
    '#4096ff',
    '#367ce0',
    '#33a3ff',
    '#7db7ff',
    '#4da3ff',
    '#8f96a3',
    '#168cff',
    '#0b5bd3',
    '#084fa8',
    '#0b63ce',
    '#8f9aaa',
    '#102442',
    '#11284a',
    'rgba(15, 140, 255',
    'rgba(31, 94, 255',
    'rgba(36, 107, 254',
  ];
  const extensions = new Set(['.css', '.ts', '.tsx']);
  const matches: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const filePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(filePath);
        continue;
      }
      if (!extensions.has(path.extname(entry.name))) continue;
      const text = fs.readFileSync(filePath, 'utf8').toLowerCase();
      for (const pattern of forbiddenPatterns) {
        const normalizedPattern = pattern.toLowerCase();
        if (text.includes(normalizedPattern)) {
          matches.push(`${path.relative(process.cwd(), filePath)} :: ${pattern}`);
        }
      }
    }
  };

  walk(root);
  expect(matches, `主题源文件仍残留旧版颜色硬编码: ${matches.join('; ')}`).toEqual([]);
});

test('滚动条主题颜色必须通过统一变量', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const root = path.resolve(process.cwd(), 'src');
  const matches: string[] = [];
  const scanCssFile = (cssPath: string) => {
    const lines = fs.readFileSync(cssPath, 'utf8').split(/\r?\n/);
    let inScrollbarBlock = false;

    lines.forEach((line, index) => {
      const normalized = line.trim().toLowerCase();
      if (normalized.includes('::-webkit-scrollbar') || normalized.includes('ant-table-sticky-scroll')) {
        inScrollbarBlock = true;
      }
      if (/^scrollbar-color\s*:\s*#[0-9a-f]{3,8}/i.test(normalized)) {
        matches.push(`${path.relative(process.cwd(), cssPath)}:${index + 1} ${line.trim()}`);
      }
      if (
        inScrollbarBlock
        && /^(background|border|border-color)\s*:\s*#[0-9a-f]{3,8}/i.test(normalized)
      ) {
        matches.push(`${path.relative(process.cwd(), cssPath)}:${index + 1} ${line.trim()}`);
      }
      if (normalized.includes('}')) {
        inScrollbarBlock = false;
      }
    });
  };
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const filePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(filePath);
        continue;
      }
      if (path.extname(entry.name) === '.css') {
        scanCssFile(filePath);
      }
    }
  };

  walk(root);
  expect(matches, `滚动条主题仍残留硬编码颜色: ${matches.join('; ')}`).toEqual([]);
});

test('页面局部背景色必须走主题变量', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const roots = [
    path.resolve(process.cwd(), 'src', 'pages'),
    path.resolve(process.cwd(), 'src', 'components'),
  ];
  const matches: string[] = [];
  const highRiskBackgrounds = new Set([
    '#ffffff',
    '#fff',
    '#f8fafc',
    '#fbfdff',
    '#f8fbff',
    '#eff6ff',
    '#fffbeb',
    '#fffbe6',
    '#fff7ed',
    '#fff7f7',
    '#fff1f2',
    '#f0fdf4',
    '#0b0f14',
    '#0f1219',
    '#10141d',
    '#111827',
  ]);

  const scanCssFile = (cssPath: string) => {
    fs.readFileSync(cssPath, 'utf8').split(/\r?\n/).forEach((line, index) => {
      const normalized = line.trim().toLowerCase();
      const backgroundMatch = normalized.match(/^background(?:-color)?\s*:\s*(#[0-9a-f]{3,8})/i);
      if (backgroundMatch && highRiskBackgrounds.has(backgroundMatch[1])) {
        matches.push(`${path.relative(process.cwd(), cssPath)}:${index + 1} ${line.trim()}`);
        return;
      }
      if (
        normalized.includes('linear-gradient(')
        && [...highRiskBackgrounds].some((color) => normalized.includes(color))
      ) {
        matches.push(`${path.relative(process.cwd(), cssPath)}:${index + 1} ${line.trim()}`);
      }
    });
  };
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const filePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(filePath);
        continue;
      }
      if (path.extname(entry.name) === '.css') {
        scanCssFile(filePath);
      }
    }
  };

  roots.forEach(walk);
  expect(matches, `页面局部背景色仍残留高风险硬编码: ${matches.join('; ')}`).toEqual([]);
});

test('页面和组件展示色不得绕过主题变量', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const roots = [
    path.resolve(process.cwd(), 'src', 'pages'),
    path.resolve(process.cwd(), 'src', 'components'),
  ];
  const matches: string[] = [];
  const rawHexColor = /#[0-9a-f]{3,8}/i;
  const rawFunctionColor = /(?:rgba?|hsla?)\(\s*(?!var\()/i;
  const colorSourceExtensions = new Set(['.css', '.ts', '.tsx']);

  const scanColorSourceFile = (sourcePath: string) => {
    fs.readFileSync(sourcePath, 'utf8').split(/\r?\n/).forEach((line, index) => {
      const normalized = line.trim().toLowerCase();
      if (normalized.includes('mask-image')) return;
      if (rawHexColor.test(normalized) || rawFunctionColor.test(normalized)) {
        matches.push(`${path.relative(process.cwd(), sourcePath)}:${index + 1} ${line.trim()}`);
      }
    });
  };
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const filePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(filePath);
        continue;
      }
      if (colorSourceExtensions.has(path.extname(entry.name))) {
        scanColorSourceFile(filePath);
      }
    }
  };

  roots.forEach(walk);
  expect(matches, `页面和组件展示色仍绕过主题变量: ${matches.join('; ')}`).toEqual([]);
});

test('全局主题最终覆盖层不得绕过语义变量', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const globalCssPath = path.resolve(process.cwd(), 'src', 'theme', 'global.css');
  const cssText = fs.readFileSync(globalCssPath, 'utf8');
  const marker = 'UI-THEME-COLOR-FINAL-GUARD-20260529';
  const markerIndex = cssText.indexOf(marker);
  expect(markerIndex, '缺少全局主题颜色最终归一化层').toBeGreaterThanOrEqual(0);

  const matches: string[] = [];
  const rawHexColor = /#[0-9a-f]{3,8}/i;
  const rawFunctionColor = /(?:rgba?|hsla?)\(\s*(?!var\()/i;
  cssText.slice(markerIndex).split(/\r?\n/).forEach((line, index) => {
    const normalized = line.trim().toLowerCase();
    if (!normalized || normalized.startsWith('/*') || normalized.startsWith('*')) return;
    if (rawHexColor.test(normalized) || rawFunctionColor.test(normalized)) {
      matches.push(`${index + 1} ${line.trim()}`);
    }
  });

  expect(matches, `全局主题最终覆盖层仍残留硬编码展示色: ${matches.join('; ')}`).toEqual([]);
});

test('全局主题旧样式块不得保留可生效的硬编码展示色', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const globalCssPath = path.resolve(process.cwd(), 'src', 'theme', 'global.css');
  const cssText = fs.readFileSync(globalCssPath, 'utf8');
  const marker = 'UI-THEME-COLOR-FINAL-GUARD-20260529';
  const markerIndex = cssText.indexOf(marker);
  expect(markerIndex, '缺少全局主题颜色最终归一化层').toBeGreaterThanOrEqual(0);

  const matches: string[] = [];
  const rawHexColor = /#[0-9a-f]{3,8}/i;
  const rawFunctionColor = /(?:rgba?|hsla?)\(\s*(?!var\()/i;
  cssText.slice(0, markerIndex).split(/\r?\n/).forEach((line, index) => {
    const normalized = line.trim().toLowerCase();
    if (!normalized || normalized.startsWith('/*') || normalized.startsWith('*') || normalized.startsWith('--')) return;
    if (normalized.includes('var(')) return;
    if (rawHexColor.test(normalized) || rawFunctionColor.test(normalized)) {
      matches.push(`${path.relative(process.cwd(), globalCssPath)}:${index + 1} ${line.trim()}`);
    }
  });

  expect(matches, `全局主题旧样式块仍有可生效硬编码展示色: ${matches.join('; ')}`).toEqual([]);
});

test('图表组件颜色只通过统一图表主题入口', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const root = path.resolve(process.cwd(), 'src');
  const chartPalettePath = path.join(root, 'theme', 'chartTheme.ts');
  const chartFiles = [
    path.join(root, 'components', 'KLineChart', 'KLineChart.tsx'),
    path.join(root, 'components', 'BacktestChart', 'BacktestChart.tsx'),
  ];
  const forbiddenPatterns = [
    '#58a6ff',
    '#7bb8ff',
    '#f59e0b',
    '#22c55e',
    '#e11d48',
    '#16a34a',
    '#94a3b8',
    'rgba(225, 29, 72',
    'rgba(22, 163, 74',
    'rgba(255, 77, 109',
    'rgba(34, 197, 94',
    'function getChartTheme',
  ];
  const matches: string[] = [];

  for (const filePath of chartFiles) {
    const text = fs.readFileSync(filePath, 'utf8').toLowerCase();
    for (const pattern of forbiddenPatterns) {
      const normalizedPattern = pattern.toLowerCase();
      if (text.includes(normalizedPattern)) {
        matches.push(`${path.relative(process.cwd(), filePath)} :: ${pattern}`);
      }
    }
  }

  const paletteText = fs.readFileSync(chartPalettePath, 'utf8');
  expect(paletteText).toContain('getLocalQuantChartPalette');
  expect(matches, `图表组件仍绕过统一调色板: ${matches.join('; ')}`).toEqual([]);
});

test('主题和密度响应跨标签存储事件并同步浏览器主题色', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('lqc_theme_mode', 'dark');
    window.localStorage.setItem('lqc_display_density', 'compact');
  });

  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: '总览看板' })).toBeVisible({ timeout: 30000 });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
  await expect.poll(async () => page.locator('meta[name="theme-color"]').getAttribute('content')).toBe('#0b0f14');

  await page.evaluate(() => {
    window.localStorage.setItem('lqc_theme_mode', 'light');
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'lqc_theme_mode',
      newValue: 'light',
      oldValue: 'dark',
      storageArea: window.localStorage,
    }));
    window.localStorage.setItem('lqc_display_density', 'dense');
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'lqc_display_density',
      newValue: 'dense',
      oldValue: 'compact',
      storageArea: window.localStorage,
    }));
  });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('html')).toHaveAttribute('data-density', 'dense');
  await expect.poll(async () => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('light');
  await expect.poll(async () => page.locator('meta[name="theme-color"]').getAttribute('content')).toBe('#edf2f8');

  await page.evaluate(() => {
    window.localStorage.setItem('lqc_theme_mode', 'dark');
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'lqc_theme_mode',
      newValue: 'dark',
      oldValue: 'light',
      storageArea: window.localStorage,
    }));
  });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(async () => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('dark');
  await expect.poll(async () => page.locator('meta[name="theme-color"]').getAttribute('content')).toBe('#0b0f14');
});

test('系统管理浅色主题检查清单不残留暗色卡片', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('lqc_theme_mode', 'light');
  });

  await page.goto('/system', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: '系统管理' })).toBeVisible({ timeout: 30000 });

  const metrics = await page.evaluate(() => {
    const parseRgb = (value: string) => {
      const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (!match) return null;
      return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: Number(match[4] ?? '1') };
    };
    const luminance = (rgb: { r: number; g: number; b: number } | null) =>
      rgb ? (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) : 0;
    const items = Array.from(document.querySelectorAll<HTMLElement>('.system-setting-checklist > div'));
    return {
      theme: document.documentElement.dataset.theme,
      count: items.length,
      darkLeaks: items
        .map((item) => {
          const style = getComputedStyle(item);
          return {
            text: item.innerText.replace(/\s+/g, ' ').trim(),
            background: style.backgroundColor,
            luminance: Math.round(luminance(parseRgb(style.backgroundColor))),
          };
        })
        .filter((item) => item.luminance < 180),
    };
  });

  expect(metrics.theme).toBe('light');
  expect(metrics.count, '系统管理基础设置检查清单未渲染').toBeGreaterThan(0);
  expect(metrics.darkLeaks, '系统管理浅色主题检查清单仍残留暗色背景').toEqual([]);
});

test('浅色主题六大页面和关键弹窗不残留深色终端块', async ({ page }) => {
  test.setTimeout(90000);
  await page.addInitScript(() => {
    window.localStorage.setItem('lqc_theme_mode', 'light');
    window.localStorage.setItem('lqc_display_density', 'compact');
  });

  const pages = [
    { url: '/dashboard', heading: '总览看板' },
    { url: '/data-center?tab=数据概览', heading: '数据中心' },
    { url: '/strategy-dev', heading: '策略开发' },
    { url: '/backtest?tab=新建回测', heading: '回测研究' },
    { url: '/trading?tab=信号下单', heading: '交易执行' },
    { url: '/system', heading: '系统管理' },
  ];

  for (const item of pages) {
    await page.goto(item.url, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: item.heading })).toBeVisible({ timeout: 30000 });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    const leaks = await scanVisibleDarkSurfaceLeaks(page, '.app-shell');
    expect(leaks, `${item.heading} 浅色主题仍残留大面积暗色块`).toEqual([]);
  }

  await page.goto('/data-center?tab=数据概览', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: '数据中心' })).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: /同步到最新/ }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 15000 });
  await expect(scanVisibleDarkSurfaceLeaks(page, '.ant-modal-root'), '数据中心同步确认弹窗浅色主题暗色残留').resolves.toEqual([]);
  await page.keyboard.press('Escape');
});

test('深色主题六大页面和关键弹层不泄漏浅色默认块', async ({ page }) => {
  test.setTimeout(90000);
  await page.addInitScript(() => {
    window.localStorage.setItem('lqc_theme_mode', 'dark');
    window.localStorage.setItem('lqc_display_density', 'compact');
  });

  const pages = [
    { url: '/dashboard', heading: '总览看板' },
    { url: '/data-center?tab=数据来源', heading: '数据中心' },
    { url: '/strategy-dev', heading: '策略开发' },
    { url: '/backtest?tab=新建回测', heading: '回测研究' },
    { url: '/trading?tab=信号下单', heading: '交易执行' },
    { url: '/system', heading: '系统管理' },
  ];

  for (const item of pages) {
    await page.goto(item.url, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: item.heading })).toBeVisible({ timeout: 30000 });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const leaks = await scanVisibleLightSurfaceLeaks(page, '.app-shell');
    expect(leaks, `${item.heading} 深色主题仍泄漏大面积浅色块`).toEqual([]);
  }

  await page.goto('/data-center?tab=数据字典', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: '数据中心' })).toBeVisible({ timeout: 30000 });
  await page.locator('.ant-select-selector').first().click();
  await expect(page.locator('.ant-select-dropdown:visible')).toBeVisible({ timeout: 15000 });
  await expect(scanVisibleLightSurfaceLeaks(page, 'body'), '数据中心筛选下拉层深色主题浅色泄漏').resolves.toEqual([]);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: /同步到最新/ }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 15000 });
  await expect(scanVisibleLightSurfaceLeaks(page, '.ant-modal-root'), '数据中心同步确认弹窗深色主题浅色泄漏').resolves.toEqual([]);
  await page.keyboard.press('Escape');
});

test('浅色主题关键下拉层不残留暗色终端块', async ({ page }) => {
  test.setTimeout(90000);
  await page.addInitScript(() => {
    window.localStorage.setItem('lqc_theme_mode', 'light');
    window.localStorage.setItem('lqc_display_density', 'compact');
  });

  await page.goto('/data-center?tab=数据字典', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: '数据中心' })).toBeVisible({ timeout: 30000 });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.locator('.ant-select-selector').first().click();
  await expect(page.locator('.ant-select-dropdown:visible')).toBeVisible({ timeout: 15000 });
  await expect(scanVisibleDarkSurfaceLeaks(page, 'body'), '数据中心筛选下拉层浅色主题暗色残留').resolves.toEqual([]);
  await page.keyboard.press('Escape');

  await page.goto('/backtest?tab=新建回测', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: '回测研究' })).toBeVisible({ timeout: 30000 });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.locator('.ant-select-selector').last().click();
  await expect(page.locator('.ant-select-dropdown:visible')).toBeVisible({ timeout: 15000 });
  await expect(scanVisibleDarkSurfaceLeaks(page, 'body'), '回测成交规则下拉层浅色主题暗色残留').resolves.toEqual([]);
  await page.keyboard.press('Escape');
});

test('主题切换后日期选择器浮层不泄漏旧主题颜色', async ({ page }) => {
  test.setTimeout(90000);
  await page.addInitScript(() => {
    window.localStorage.setItem('lqc_theme_mode', 'dark');
    window.localStorage.setItem('lqc_display_density', 'compact');
  });

  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: '总览看板' })).toBeVisible({ timeout: 30000 });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await injectThemePickerDropdownSample(page);
  await expect(page.locator('.ant-picker-dropdown:visible')).toBeVisible({ timeout: 15000 });
  await expect(scanVisibleLightSurfaceLeaks(page, '.ant-picker-dropdown'), '深色主题日期选择器浮层浅色泄漏').resolves.toEqual([]);

  await page.getByTestId('btn-theme-mode').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect.poll(async () => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('light');
  await injectThemePickerDropdownSample(page);
  await expect(page.locator('.ant-picker-dropdown:visible')).toBeVisible({ timeout: 15000 });
  await expect(scanVisibleDarkSurfaceLeaks(page, '.ant-picker-dropdown'), '浅色主题日期选择器浮层暗色残留').resolves.toEqual([]);
});

test('数据中心深链进入数据质量仍显示真实 QMT 状态', async ({ page }) => {
  await routeQmtStatus(page, 'real');

  await page.goto('/data-center?tab=数据质量');

  await expect(page.getByRole('tab', { name: '数据质量' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('当前数据来源：真实 QMT 只读')).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('真实 QMT 只读').first()).toBeVisible();
  await expect(page.getByRole('button', { name: '在检查矩阵开始数据质量检查' })).toBeVisible();
  await expect(page.getByRole('button', { name: '在质量检查列表开始数据质量检查' })).toBeVisible();
});

test('回测深链会准确带入策略开发选择的策略', async ({ page }) => {
  await routeQmtStatus(page, 'real');
  const strategies = [
    {
      id: 11,
      file_name: 'daily_ma.py',
      file_path: 'C:/LocalQuantConsole/strategies/user/daily_ma.py',
      strategy_name: '日线均线策略',
      version: '1.0.1',
      description: '日K策略',
      status: 'enabled',
      created_at: '2026-05-18 10:00:00',
      last_modified_at: '2026-05-18 10:00:00',
      last_run_at: null,
      today_signal_count: 0,
    },
    {
      id: 22,
      file_name: 'minute_breakout.py',
      file_path: 'C:/LocalQuantConsole/strategies/user/minute_breakout.py',
      strategy_name: '分钟突破策略',
      version: '1.2.3',
      description: '分钟K策略',
      status: 'enabled',
      created_at: '2026-05-18 10:05:00',
      last_modified_at: '2026-05-18 10:05:00',
      last_run_at: '2026-05-18 10:30:00',
      today_signal_count: 3,
    },
  ];

  await page.route('**/api/strategies/files**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取策略文件成功',
        data: { items: strategies, page: 1, page_size: 20, total: strategies.length, has_more: false },
        error: null,
        trace_id: 'ui-strategy-link',
      }),
    });
  });
  await page.route('**/api/backtests?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取回测任务成功',
        data: { items: [], page: 1, page_size: 20, total: 0, has_more: false },
        error: null,
        trace_id: 'ui-backtest-empty',
      }),
    });
  });

  await page.goto('/backtest?tab=新建回测&strategy_id=22');

  await expect(page.getByRole('tab', { name: '新建回测' })).toHaveAttribute('aria-selected', 'true');
  const strategySelect = page.locator('.backtest-page .ant-select:has(#strategy_id)');
  await expect(strategySelect).toContainText('分钟突破策略');
  await expect(strategySelect).toContainText('v1.2.3');
  await expect(strategySelect).toContainText('minute_breakout.py');
  await expect(page.getByText('分钟突破策略 · v1.2.3 · minute_breakout.py').first()).toBeVisible();
});

test('回测任务点击后直接打开分析报告', async ({ page }) => {
  await routeQmtStatus(page, 'real');
  const task = {
    id: 1,
    task_id: 'task_ui_open',
    backtest_name: 'UI回测打开测试',
    strategy_id: 1,
    strategy_name: '开盘三分钟放量买入修正版',
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
    created_at: '2026-05-11 18:30:08',
  };
  const result = {
    id: 1,
    backtest_id: 1,
    total_return: -5.86,
    annual_return: -29.24,
    max_drawdown: -13.73,
    win_rate: 44.58,
    trade_count: 7385,
    buy_count: 3749,
    sell_count: 3636,
    profit_loss_ratio: 0.9,
    average_holding_days: 1,
    ending_cash: 69.39,
    open_position_count: 111,
    open_market_value: 941338,
    total_fee: 50026.61,
    realized_pnl: -58207.16,
    final_cash: 941407.39,
    created_at: '2026-05-11 18:34:19',
  };
  const manifest = {
    id: 1,
    backtest_id: 1,
    strategy_file_name: 'public_minute_signal_demo.py',
    strategy_code_hash: 'bd46a3dd23bf0000000000000000000000000000000000000000000000000000',
    strategy_name: task.strategy_name,
    strategy_version: '1.0.2',
    data_frequency: '分钟K',
    fill_mode: '下一分钟成交',
    qmt_mode: 'real_qmt_data',
    qmt_path: 'D:\\MiniQMT\\demo',
    account_id: 'real-account',
    data_coverage_snapshot: JSON.stringify([{ data_type: 'minute_kline', status: 'complete', coverage_rate: 100, start_date: '2026-03-04', end_date: '2026-05-08' }]),
    universe_summary: JSON.stringify({ symbols_total: 5202, daily_bar_count: 228489, minute_bar_count: 9900000, minute_scanned_trade_days: 44, minute_symbols_scanned: 5202, minute_symbols_with_rows: 5202, minute_trigger_count: 4745, minute_return_limit: 200, minute_possible_truncation: false, signal_count: 4745, trade_count: 7385, matched_signal_count: 7385, skipped_signal_count: 999 }),
    rule_snapshot: JSON.stringify({ lot_size: 100, t_plus_1: true, real_qmt_order: false, minute_mode: 'minute_signal_next_bar', minute_market_cap_basis: 'previous_visible_daily_bar', strategy_max_signals: 200 }),
    engine_version: 'backtest-local-1.1',
    trust_level: 'verified_data_signal_simulation',
    trust_message: '真实 QMT 落库覆盖完整；当前为分钟信号本地撮合。',
    created_at: '2026-05-11 18:34:19',
  };
  const strategySnapshotCheck = {
    status: 'matched',
    message: '已找到与本次回测策略代码哈希一致的策略运行记录。',
    manifest_hash: manifest.strategy_code_hash,
    latest_code_hash: manifest.strategy_code_hash,
    matched_run_id: 'run_ui_open_strategy',
    matched_task_id: 'task_ui_open_strategy',
    matched_run_status: 'success',
    matched_started_at: '2026-05-11 18:20:00',
    matched_finished_at: '2026-05-11 18:20:10',
    latest_run_id: 'run_ui_open_strategy',
    latest_task_id: 'task_ui_open_strategy',
    latest_run_status: 'success',
    latest_started_at: '2026-05-11 18:20:00',
    latest_finished_at: '2026-05-11 18:20:10',
    latest_strategy_file_name: manifest.strategy_file_name,
    latest_strategy_version: manifest.strategy_version,
    technical_detail: '{"strategy_id":1}',
  };
  await page.route('**/api/strategies/files**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, message: '获取策略文件成功', data: { items: [{ id: 1, file_name: 'public_minute_signal_demo.py', file_path: '', strategy_name: task.strategy_name, version: '1.0.2', description: '', status: 'enabled', created_at: '2026-05-11 10:00:00', last_modified_at: '2026-05-11 10:00:00', last_run_at: null, today_signal_count: 0 }], page: 1, page_size: 20, total: 1, has_more: false }, error: null, trace_id: 'ui-open-strategies' }) });
  });
  await page.route('**/api/backtests?**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, message: '获取回测任务成功', data: { items: [task], page: 1, page_size: 20, total: 1, has_more: false }, error: null, trace_id: 'ui-open-backtests' }) });
  });
  await page.route('**/api/backtests/task_ui_open/report', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, message: '获取回测报告成功', data: { task, result, manifest, strategy_snapshot_check: strategySnapshotCheck, trades: [], signals: [], equity: [], logs: [] }, error: null, trace_id: 'ui-open-report' }) });
  });
  await page.route('**/api/backtests/task_ui_open/result', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, message: '获取回测结果成功', data: result, error: null, trace_id: 'ui-open-result' }) });
  });
  await page.route('**/api/backtests/task_ui_open/equity**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, message: '获取资金曲线成功', data: [], error: null, trace_id: 'ui-open-equity' }) });
  });
  for (const path of ['trades', 'signals', 'logs']) {
    await page.route(`**/api/backtests/task_ui_open/${path}**`, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, message: '获取回测明细成功', data: { items: [], page: 1, page_size: 20, total: 0, has_more: false }, error: null, trace_id: `ui-open-${path}` }) });
    });
  }
  let exportRequestCount = 0;
  await page.route('**/api/backtests/task_ui_open/export', async (route) => {
    exportRequestCount += 1;
    if (exportRequestCount === 1) {
      await route.fulfill({
        status: 200,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        headers: {
          'content-disposition': 'attachment; filename="backtest_task_ui_open_complete.xlsx"',
        },
        body: 'test isolation backtest workbook bytes',
      });
      return;
    }
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, message: '回测导出失败', error: { code: 'EXPORT_FAILED', detail: 'export guard failure' }, trace_id: 'ui-open-export-failed' }),
    });
  });

  await page.goto('/backtest?tab=回测任务');
  await expect(page.getByRole('tab', { name: '回测任务' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('table-backtest-tasks')).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: '更多' }).first().click();
  await expect(page.getByRole('menuitem', { name: '复制任务摘要' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '查看回测结果', exact: true }).click();

  await expect(page.getByRole('tab', { name: '绩效结果' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('绩效结果').getByRole('heading', { name: 'UI回测打开测试' })).toBeVisible();
  await expect(page.getByLabel('回测导出追溯清单')).toContainText('分钟K 9900000');
  await expect(page.getByLabel('回测 Manifest 证据链')).toContainText('日K 228,489 行');
  await expect(page.getByText('策略运行交叉核对：已匹配运行快照')).toBeVisible();
  await expect(page.getByText('匹配运行：run_ui_open_strategy')).toBeVisible();
  await expect(page.getByTestId('backtest-result-workbench')).toBeVisible();

  await page.getByRole('button', { name: '导出Excel' }).click();
  const successExportDialog = page.getByRole('dialog', { name: '导出回测记录' });
  await expect(successExportDialog).toBeVisible();
  await expect(page.getByTestId('backtest-export-consistency')).toBeVisible();
  await expect(page.getByText('当前报告、任务 ID 和导出对象一致。')).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await successExportDialog.getByRole('button', { name: '确认导出' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('backtest_task_ui_open_complete.xlsx');
  await expect(successExportDialog).toBeHidden();
  await expect(page.getByText('已下载回测记录：backtest_task_ui_open_complete.xlsx')).toBeVisible();
  await expect(page.getByText('已下载回测记录：backtest_task_ui_open_complete.xlsx')).toBeHidden({ timeout: 5000 });

  await page.getByRole('tab', { name: '交易明细' }).click();
  await expect(page.getByTestId('table-backtest-trades')).toBeVisible();
  await expect(page.getByTestId('table-backtest-signals')).toBeVisible();

  await page.getByRole('tab', { name: '回测日志' }).click();
  await expect(page.getByTestId('table-backtest-logs')).toBeVisible();

  await page.getByRole('tab', { name: '绩效结果' }).click();
  await expect(page.getByTestId('backtest-result-workbench')).toBeVisible();
  await page.getByRole('button', { name: '导出Excel' }).click();
  const exportDialog = page.getByRole('dialog', { name: '导出回测记录' });
  await expect(exportDialog).toBeVisible();
  await exportDialog.getByRole('button', { name: '确认导出' }).click();
  const exportError = page.getByRole('dialog', { name: '错误详情' });
  await expect(exportError).toBeVisible();
  await expect(exportError.getByText('回测导出失败')).toBeVisible();
  await expect(exportError.getByText('错误码：EXPORT_FAILED')).toBeVisible();
  await expect(exportError.getByText('下一步建议：请检查后端服务和导出权限。')).toBeVisible();
  await expect(exportError.getByText('追踪ID：ui-open-export-failed')).toBeVisible();
  await expect(exportError.locator('.error-panel__technical')).toContainText('export guard failure');
  await expect(exportError.getByRole('button', { name: '复制给 AI' })).toBeVisible();
});

test('历史回测在当前策略文件记录缺失时仍可打开报告', async ({ page }) => {
  await routeQmtStatus(page, 'real');
  const task = {
    id: 88,
    task_id: 'task_archived_strategy',
    strategy_id: 404,
    strategy_name: '已归档高胜率策略',
    backtest_name: '策略归档后历史回测',
    start_date: '2026-05-04',
    end_date: '2026-05-08',
    initial_cash: 1000000,
    single_order_amount: 10000,
    data_frequency: '日K',
    fill_mode: '下一日开盘',
    fee_rate: 0.0003,
    stamp_tax_rate: 0.001,
    slippage: 0,
    status: 'success',
    created_at: '2026-05-20 09:40:00',
  };
  const result = {
    id: 1,
    backtest_id: 88,
    total_return: 2.18,
    annual_return: 10.24,
    max_drawdown: -1.2,
    win_rate: 66.7,
    trade_count: 3,
    buy_count: 2,
    sell_count: 1,
    profit_loss_ratio: 1.6,
    average_holding_days: 2,
    ending_cash: 1021800,
    open_position_count: 0,
    open_market_value: 0,
    total_fee: 120,
    realized_pnl: 21800,
    final_cash: 1021800,
    created_at: '2026-05-20 09:41:00',
  };
  const manifest = {
    id: 1,
    backtest_id: 88,
    strategy_file_name: 'archived_high_win_strategy.py',
    strategy_code_hash: 'archivedhash000000000000000000000000000000000000000000000000',
    strategy_name: task.strategy_name,
    strategy_version: '1.0.0',
    data_frequency: '日K',
    fill_mode: '下一日开盘',
    qmt_mode: 'real_qmt_data',
    qmt_path: 'D:\\MiniQMT\\demo',
    account_id: 'real-account',
    data_coverage_snapshot: JSON.stringify([{ data_type: 'daily_kline', status: 'complete', coverage_rate: 100, start_date: '2026-05-04', end_date: '2026-05-08' }]),
    universe_summary: JSON.stringify({ symbols_total: 320, daily_bar_count: 1600, signal_count: 3, trade_count: 3 }),
    rule_snapshot: JSON.stringify({ lot_size: 100, t_plus_1: true, real_qmt_order: false }),
    engine_version: 'backtest-local-1.2',
    trust_level: 'verified_data_simulation',
    trust_message: '真实 QMT 落库覆盖完整；当前为本地 SQLite 本地撮合。',
    created_at: '2026-05-20 09:41:00',
  };
  const strategySnapshotCheck = {
    status: 'no_run_snapshot',
    message: '尚未找到该策略的运行快照；回测 Manifest 仍可核对，但无法从策略运行记录反查同一份代码。',
    manifest_hash: manifest.strategy_code_hash,
    technical_detail: '{"strategy_id":404}',
  };

  await page.route('**/api/strategies/files**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, message: '获取策略文件成功', data: { items: [], page: 1, page_size: 20, total: 0, has_more: false }, error: null, trace_id: 'archived-strategies-empty' }),
    });
  });
  await page.route('**/api/backtests**', async (route) => {
    const url = new URL(route.request().url());
    let data: unknown;
    if (url.pathname === '/api/backtests') {
      data = { items: [task], page: 1, page_size: 20, total: 1, has_more: false };
    } else if (url.pathname.endsWith('/report')) {
      data = { task, result, manifest, strategy_snapshot_check: strategySnapshotCheck, trades: [], signals: [], equity: [], logs: [] };
    } else if (url.pathname.endsWith('/result')) {
      data = result;
    } else if (url.pathname.endsWith('/equity')) {
      data = [];
    } else if (url.pathname.endsWith('/trades') || url.pathname.endsWith('/signals') || url.pathname.endsWith('/logs')) {
      data = { items: [], page: 1, page_size: 20, total: 0, has_more: false };
    } else {
      data = task;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, message: '历史回测可追溯', data, error: null, trace_id: 'archived-backtest' }),
    });
  });

  await page.goto('/backtest?tab=回测任务');
  await expect(page.getByRole('tab', { name: '回测任务' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('table-backtest-tasks')).toContainText('已归档高胜率策略', { timeout: 15000 });
  await page.getByRole('button', { name: '查看回测结果', exact: true }).click();
  await expect(page.getByRole('tab', { name: '绩效结果' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('回测 Manifest 证据链')).toContainText('archived_high_win_strategy.py');
  await expect(page.getByText('策略运行交叉核对：无运行快照')).toBeVisible();
  await expect(page.getByText('尚未找到该策略的运行快照')).toBeVisible();
});

test('回测自动命名和低覆盖率二次确认保持可用', async ({ page }) => {
  await routeQmtStatus(page, 'real');
  let submittedBacktest: Record<string, unknown> | null = null;

  await page.route('**/api/strategies/files**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取策略文件成功',
        data: {
          items: [{
            id: 7,
            file_name: 'low_coverage_guard_strategy.py',
            file_path: 'C:/LocalQuantConsole/strategies/user/low_coverage_guard_strategy.py',
            strategy_name: '低覆盖率验证策略',
            version: '1.0.0',
            description: '用于验证低覆盖率二次确认，不调用真实 QMT 下单。',
            status: 'enabled',
            created_at: '2026-05-19 10:00:00',
            last_modified_at: '2026-05-19 10:00:00',
            last_run_at: null,
            today_signal_count: 0,
          }],
          page: 1,
          page_size: 20,
          total: 1,
          has_more: false,
        },
        error: null,
        trace_id: 'smoke-backtest-low-coverage-strategies',
      }),
    });
  });
  await page.route('**/api/backtests?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取回测任务成功',
        data: { items: [], page: 1, page_size: 20, total: 0, has_more: false },
        error: null,
        trace_id: 'smoke-backtest-low-coverage-list',
      }),
    });
  });
  await page.route('**/api/backtests/check-data', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '检查回测数据成功',
        data: {
          ok: true,
          message: '日K数据可用，但覆盖率偏低。',
          suggestion: '正式回测前建议先补齐数据。',
          technical_detail: JSON.stringify({
            data_type: 'daily_kline',
            coverage_rate: 59.9,
            status: 'partial',
          }),
          steps: [{
            title: '日K覆盖率',
            status: 'warning',
            message: '覆盖率 59.90%，状态 partial。',
            technical_detail: JSON.stringify({
              data_type: 'daily_kline',
              coverage_rate: 59.9,
              status: 'partial',
            }),
          }],
        },
        error: null,
        trace_id: 'smoke-backtest-low-coverage-check',
      }),
    });
  });
  await page.route('**/api/backtests', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    submittedBacktest = await route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '回测任务已创建',
        data: {
          task_id: 'task_low_coverage_guard',
          task_type: 'backtest_run',
          status: 'running',
          progress: 0,
          message: '低覆盖率二次确认后创建任务。',
        },
        error: null,
        trace_id: 'smoke-backtest-low-coverage-create',
      }),
    });
  });
  await page.route('**/api/tasks/task_low_coverage_guard', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取任务成功',
        data: {
          task_id: 'task_low_coverage_guard',
          task_type: 'backtest_run',
          status: 'running',
          progress: 30,
          message: '低覆盖率二次确认后创建任务。',
          created_at: '2026-05-19 10:00:00',
          started_at: '2026-05-19 10:00:01',
          finished_at: null,
        },
        error: null,
        trace_id: 'smoke-backtest-low-coverage-task',
      }),
    });
  });

  await page.goto('/backtest?tab=新建回测');
  await expect(page.getByRole('heading', { name: '回测研究' })).toBeVisible();
  await expect(page.getByLabel('回测名称')).toHaveValue('低覆盖率验证策略_0504-0508_日K');

  await page.getByRole('button', { name: '创建并启动回测任务' }).click();
  const confirmModal = page.locator('.backtest-confirm-modal');
  await expect(confirmModal).toBeVisible();
  await expect(confirmModal.getByText('日K覆盖率 59.90%，低于 80%，本次结果可能失真。')).toBeVisible();
  await expect(confirmModal.getByText('提交区间')).toBeVisible();
  await expect(confirmModal.getByText('2026-05-04 ~ 2026-05-08')).toBeVisible();

  await confirmModal.getByRole('button', { name: '确认创建' }).click();
  await expect(page.getByText('请先勾选覆盖率不足确认项。')).toBeVisible();
  expect(submittedBacktest, '未勾选低覆盖率确认项时不应创建回测').toBeNull();

  await confirmModal.getByLabel('我了解覆盖率不足，结果可能失真，仍只作为技术验证。').check();
  await confirmModal.getByRole('button', { name: '确认创建' }).click();
  await expect.poll(() => submittedBacktest).not.toBeNull();
  expect(submittedBacktest?.backtest_name).toBe('低覆盖率验证策略_0504-0508_日K');
  expect(submittedBacktest?.start_date).toBe('2026-05-04');
  expect(submittedBacktest?.end_date).toBe('2026-05-08');
});

test('关键页面空状态可读', async ({ page }) => {
  await page.route('**/api/dashboard/bundle', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取总览成功',
        data: emptyDashboardBundle,
        error: null,
        trace_id: 'stage9-empty',
      }),
    });
  });

  await page.goto('/dashboard');

  await expect(page.getByRole('heading', { name: '总览看板' })).toBeVisible();
  await expect(page.getByText('暂无账户数据，请先点击页面右上角“刷新账户交易”，或到数据中心同步账户数据。')).toBeVisible();
});

test('总览看板同步任务重复出现时不产生渲染 key 错误', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  const duplicatedTask = {
    task_id: 'task_dashboard_dup',
    task_type: 'sync_all',
    status: 'success',
    progress: 100,
    message: 'all 同步完成。',
    technical_detail: 'test_isolation=true; real_qmt_readonly=false',
    started_at: '2026-05-10 09:00:00',
    finished_at: '2026-05-10 09:00:01',
    created_at: '2026-05-10 09:00:00',
  };
  await page.route('**/api/dashboard/bundle', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取总览成功',
        data: {
          ...emptyDashboardBundle,
          tasks: [duplicatedTask],
        },
        error: null,
        trace_id: 'dashboard-dup-task',
      }),
    });
  });
  await page.route('**/api/data/sync/all', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '同步任务已创建',
        data: {
          task_id: duplicatedTask.task_id,
          task_type: duplicatedTask.task_type,
          status: duplicatedTask.status,
          progress: duplicatedTask.progress,
          message: duplicatedTask.message,
        },
        error: null,
        trace_id: 'dashboard-dup-task-create',
      }),
    });
  });

  await page.goto('/dashboard');
  await page.getByRole('button', { name: '刷新账户交易' }).click();
  await expect(page.getByText('all 同步完成。').first()).toBeVisible();

  expect(consoleErrors.filter((message) => message.includes('same key'))).toEqual([]);
});

test('非法路由显示中文 404 引导', async ({ page }) => {
  await page.goto('/missing-local-quant-page');

  await expect(page.getByText('页面不存在').first()).toBeVisible();
  await expect(page.getByText('当前地址没有对应的控制台页面，请返回六大菜单中的有效入口。')).toBeVisible();
  await expect(page.getByText('/missing-local-quant-page')).toBeVisible();
  await expect(page.getByTestId('not-found-go-dashboard')).toBeVisible();
  await expect(page.getByTestId('not-found-go-system')).toBeVisible();

  for (const menu of ['总览看板', '数据中心', '策略开发', '回测研究', '交易执行', '系统管理']) {
    await expect(page.getByRole('menuitem', { name: new RegExp(menu) })).toBeVisible();
  }
});

test('核心模块空状态下一步提示可读', async ({ page }) => {
  const emptyPage = { items: [], page: 1, page_size: 20, total: 0, has_more: false };
  await routeQmtStatus(page, 'test_isolation');

  await page.route('**/api/data/account/latest', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取账户成功',
        data: {
          id: 1,
          account_id: 'test_isolation_account',
          total_asset: 0,
          available_cash: 0,
          frozen_cash: 0,
          market_value: 0,
          today_pnl: 0,
          snapshot_time: null,
        },
        error: null,
        trace_id: 'ui-b-empty-account',
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
          success_count: 0,
          warning_count: 0,
          failed_count: 0,
          latest_check_time: '2026-05-09 10:00:00',
          is_stale: false,
          stale_reason: null,
        },
        error: null,
        trace_id: 'ui-button-quality',
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
          target_trade_date: '2026-05-09',
          generated_at: '2026-05-09 10:00:00',
          overall_status: 'ok',
          stale_count: 0,
          warning_count: 0,
          next_actions: [],
          items: [],
        },
        error: null,
        trace_id: 'ui-button-freshness',
      }),
    });
  });
  await page.route('**/api/data/quality/summary**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取数据质量摘要成功',
        data: { success_count: 1, warning_count: 0, failed_count: 0, latest_check_time: '2026-05-09 10:00:00', is_stale: false, stale_reason: null },
        error: null,
        trace_id: 'ui-button-quality-summary',
      }),
    });
  });
  await page.route('**/api/data/freshness/summary**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取数据新鲜度成功',
        data: {
          target_trade_date: '2026-05-09',
          generated_at: '2026-05-09 10:00:00',
          overall_status: 'ok',
          stale_count: 0,
          warning_count: 0,
          items: [],
          next_actions: [],
        },
        error: null,
        trace_id: 'ui-button-freshness',
      }),
    });
  });
  for (const path of ['positions', 'signals', 'orders', 'trades', 'logs']) {
    await page.route(`**/api/trading/${path}**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          message: '获取交易数据成功',
          data: emptyPage,
          error: null,
          trace_id: `ui-b-empty-${path}`,
        }),
      });
    });
  }

  await page.route('**/api/strategies/files**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取策略文件成功',
        data: emptyPage,
        error: null,
        trace_id: 'ui-b-empty-strategy-files',
      }),
    });
  });
  await page.route(/\/api\/backtests(\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取回测任务成功',
        data: emptyPage,
        error: null,
        trace_id: 'ui-b-empty-backtests',
      }),
    });
  });

  await page.route('**/api/system/config', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取系统配置成功',
        data: {
          qmt_path: '',
          account_id: '',
          database_path: '',
          strategy_dir: '',
          backup_dir: '',
          auto_connect: false,
          auto_sync: false,
          default_order_amount: 10000,
          max_order_amount: 100000,
          order_confirm_required: true,
          default_order_type: '限价委托',
          price_offset: 0,
          simulation_mode: true,
          strategy_timeout_seconds: 30,
          strategy_run_interval_seconds: 60,
          intraday_auto_run: false,
          strategy_log_level: 'info',
          strategy_max_log_mb: 50,
          log_retention_days: 30,
          task_retention_days: 30,
        },
        error: null,
        trace_id: 'ui-b-empty-config',
      }),
    });
  });
  await page.route('**/api/system/env/results**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, message: '获取环境检测成功', data: [], error: null, trace_id: 'ui-b-empty-env' }) });
  });
  await page.route('**/api/system/logs**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, message: '获取日志成功', data: emptyPage, error: null, trace_id: 'ui-b-empty-logs' }) });
  });
  await page.route('**/api/system/monitor', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取监控成功',
        data: {
          running_task_count: 0,
          failed_task_count: 0,
          database_size_bytes: 0,
          log_size_bytes: 0,
          backup_count: 0,
          recent_errors: [],
          slow_tasks: [],
        },
        error: null,
        trace_id: 'ui-b-empty-monitor',
      }),
    });
  });
  await page.route('**/api/system/startup-check', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取启动健康检查成功',
        data: {
          app_name: 'LocalQuantConsole',
          version: '0.1.0',
          checked_at: '',
          overall_status: 'warning',
          items: [],
        },
        error: null,
        trace_id: 'ui-b-empty-startup',
      }),
    });
  });
  await page.route('**/api/system/backups**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, message: '获取备份成功', data: emptyPage, error: null, trace_id: 'ui-b-empty-backups' }) });
  });
  await page.route('**/api/system/operations**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, message: '获取操作记录成功', data: emptyPage, error: null, trace_id: 'ui-b-empty-operations' }) });
  });

  await page.goto('/trading');
  await expect(page.getByText('暂无可下单信号。请先到“策略开发”运行策略；已有信号会在这里进入人工确认下单流程，不会自动交易。')).toBeVisible();
  await page.getByRole('tab', { name: '当前持仓' }).click();
  await expect(page.getByText('暂无持仓数据。请先到“数据中心 / 数据同步”同步持仓，或检查当前账户是否已有持仓。')).toBeVisible();
  await page.getByRole('tab', { name: '成交记录' }).click();
  await expect(page.getByText('暂无成交记录。请点击右上“同步成交”；同步完成后会显示成交价、数量、费用和来源。')).toBeVisible();

  await page.goto('/backtest');
  await page.getByRole('tab', { name: '绩效结果' }).click();
  await expect(page.getByText('REPORT EMPTY')).toBeVisible();
  await expect(page.getByText('暂无可分析报告')).toBeVisible();
  await expect(page.getByText('请先选择已完成任务，或新建回测；任务成功后这里会展示收益、回撤、资金曲线、成交明细和日志证据。')).toBeVisible();
  await expect(page.getByTestId('backtest-report-empty-workbench').getByRole('button', { name: /新建回测/ })).toBeVisible();

  await page.goto('/system');
  await page.getByRole('tab', { name: '运行监控' }).click();
  await expect(page.getByText('暂无错误日志。系统当前未记录失败或异常；如页面异常，请先运行环境检测，或到“日志中心”导出日志给 AI 排查。')).toBeVisible();
  await expect(page.getByText('暂无启动健康检查结果。请点击页面右上“刷新”，或重新打开系统后再查看后端、前端、数据库和 xtquant 状态。')).toBeVisible();
});

test('接口失败时显示中文错误详情', async ({ page }) => {
  await page.route('**/api/dashboard/bundle', async (route) => {
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({
        success: false,
        message: '测试错误：无法加载总览看板。',
        data: null,
        error: {
          code: 'STAGE9_TEST_ERROR',
          detail: 'dashboard bundle test isolation failure',
          suggestion: '请检查后端服务或稍后重试',
        },
        trace_id: 'stage9-error',
      }),
    });
  });

  await page.goto('/dashboard');

  await expect(page.getByRole('dialog', { name: '错误详情' })).toBeVisible();
  await expect(page.getByText('测试错误：无法加载总览看板。')).toBeVisible();
  await expect(page.getByText('错误码：STAGE9_TEST_ERROR')).toBeVisible();
  await expect(page.getByText('dashboard bundle test isolation failure')).toBeVisible();
  await expect(page.getByRole('button', { name: '复制给 AI' })).toBeVisible();
});

test('接口返回非 JSON 时仍显示中文错误详情', async ({ page }) => {
  await page.route('**/api/dashboard/bundle', async (route) => {
    await route.fulfill({
      status: 502,
      contentType: 'text/plain',
      body: 'plain backend failure from local proxy',
    });
  });

  await page.goto('/dashboard');

  const dialog = page.getByRole('dialog', { name: '错误详情' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('接口返回格式异常，请复制技术详情给 AI 排查。')).toBeVisible();
  await expect(dialog.getByText('错误码：RESPONSE_PARSE_ERROR')).toBeVisible();
  await expect(dialog.getByText('下一步建议：请检查后端日志、接口地址和本地服务是否返回了非 JSON 内容。')).toBeVisible();
  await expect(dialog.locator('.error-panel__technical')).toContainText('plain backend failure from local proxy');
  await expect(dialog.getByRole('button', { name: '复制给 AI' })).toBeVisible();
});

test('数据中心同步失败详情可打开', async ({ page }) => {
  await routeDataCenterBasics(page);
  await page.route(/.*\/api\/data\/sync\/tasks.*/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取同步任务成功',
        data: {
          items: [
            {
              task_id: 'task_ui_failed_sync',
              sync_type: 'minute_kline',
              status: 'failed',
              total_count: 10,
              success_count: 6,
              failed_count: 4,
              started_at: '2026-05-09 09:30:00',
              finished_at: '2026-05-09 09:31:00',
            },
          ],
          page: 1,
          page_size: 20,
          total: 1,
          has_more: false,
        },
        error: null,
        trace_id: 'ui-b-sync-failed',
      }),
    });
  });
  await page.route('**/api/data/sync/logs**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取同步日志成功',
        data: {
          items: [
            {
              id: 1,
              task_id: 'task_ui_failed_sync',
              sync_type: 'minute_kline',
              level: 'error',
              message: '同步任务存在失败记录。',
              technical_detail: 'minute_kline failed symbols: 4',
              created_at: '2026-05-09 09:31:00',
            },
          ],
          page: 1,
          page_size: 20,
          total: 1,
          has_more: false,
        },
        error: null,
        trace_id: 'ui-b-sync-failed-logs',
      }),
    });
  });
  await page.goto('/data-center');
  await page.getByRole('tab', { name: '数据同步' }).click();

  await expect(page.getByTestId('table-sync-tasks')).toBeVisible();
  await expect(page.getByRole('button', { name: '看失败' })).toBeVisible();

  await page.getByRole('button', { name: '看失败' }).click();

  const syncFailureDrawer = page.locator('.ant-drawer').filter({ hasText: '同步失败详情' });
  await expect(syncFailureDrawer).toBeVisible();
  await expect(syncFailureDrawer.getByTestId('detail-drawer-message-section')).toContainText('同步任务存在失败记录。');
  await expect(syncFailureDrawer.getByText('task_ui_failed_sync', { exact: true }).first()).toBeVisible();
  await expect(syncFailureDrawer.getByRole('button', { name: '复制给 AI' })).toBeVisible();
});

test('数据中心运行中任务进度保持深色终端样式', async ({ page }) => {
  await routeDataCenterBasics(page, 'real');
  const technicalDetail = {
    batch: 19,
    total_batches: 1785,
    full_range: '2026-01-01~2026-05-18',
    window: '2026-05-11~2026-05-15',
    period: '1m',
    rows: 180666,
    success_symbols: 150,
    failed_symbols: 0,
    skipped_symbols: 0,
    no_data_symbols: 0,
    resume_rule: 'minute_coverage_first',
  };
  await page.route('**/api/data/sync/tasks**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取同步任务成功',
        data: {
          items: [
            {
              task_id: 'task_ui_running_sync',
              sync_type: 'sync_2026',
              status: 'running',
              progress: 45,
              total_count: 1785,
              success_count: 150,
              failed_count: 0,
              started_at: '2026-05-19 15:06:15',
              finished_at: null,
              message: '2026 分钟 K 分批补齐：19/1785',
              technical_detail: JSON.stringify(technicalDetail),
            },
          ],
          page: 1,
          page_size: 20,
          total: 1,
          has_more: false,
        },
        error: null,
        trace_id: 'ui-running-sync-list',
      }),
    });
  });
  await page.route('**/api/data/sync/logs**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取同步日志成功',
        data: {
          items: [
            {
              id: 1,
              task_id: 'task_ui_running_sync',
              sync_type: 'sync_2026',
              level: 'info',
              message: '2026 分钟 K 分批补齐：19/1785，当前窗口 2026-05-11~2026-05-15。',
              technical_detail: JSON.stringify(technicalDetail),
              created_at: '2026-05-19 15:06:16',
            },
          ],
          page: 1,
          page_size: 20,
          total: 1,
          has_more: false,
        },
        error: null,
        trace_id: 'ui-running-sync-logs',
      }),
    });
  });
  await page.route('**/api/tasks/task_ui_running_sync', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取任务成功',
        data: {
          task_id: 'task_ui_running_sync',
          task_type: 'sync_2026',
          status: 'running',
          progress: 45,
          message: '2026 分钟 K 分批补齐：19/1785',
          technical_detail: JSON.stringify(technicalDetail),
          created_at: '2026-05-19 15:06:15',
          started_at: '2026-05-19 15:06:15',
          finished_at: null,
        },
        error: null,
        trace_id: 'ui-running-sync-task',
      }),
    });
  });

  await page.goto('/data-center?tab=数据同步', { waitUntil: 'domcontentloaded' });

  const currentTask = page.locator('.data-sync-current-task').first();
  await expect(currentTask).toBeVisible();
  await expect(currentTask.getByText('task_ui_running_sync').first()).toBeVisible();
  await expect(currentTask.getByText('2026 分钟 K 分批补齐：19/1785')).toBeVisible();
  await expect(currentTask.getByText('完整目标范围', { exact: true })).toBeVisible();
  await expect(currentTask.getByText('当前时间窗口', { exact: true })).toBeVisible();
  await expect(currentTask.getByText('续跑规则', { exact: true })).toBeVisible();
  await expect(currentTask.getByText('当前时间窗口只是本批分片，任务会继续推进到完整目标范围。')).toBeVisible();

  const backgroundColor = await currentTask.evaluate((element) => window.getComputedStyle(element).backgroundColor);
  expect(backgroundColor).not.toBe('rgb(255, 255, 255)');

  const syncRow = page.getByRole('row', { name: /task_ui_running_sync/ }).first();
  await expect(syncRow).toBeVisible();
  const syncDetailButton = syncRow.getByRole('button', { name: '详情' });
  await syncDetailButton.click();
  const detailDrawer = page.locator('.ant-drawer').filter({ hasText: '同步任务详情' });
  await expect(detailDrawer).toBeVisible();
  await expect(detailDrawer.getByText('task_ui_running_sync', { exact: true }).first()).toBeVisible();
  await expect(detailDrawer.getByText('同步任务正在运行。请等待任务完成，页面刷新后可查看成功数、失败数和结束时间。')).toBeVisible();
  await expect(detailDrawer.getByText('完整目标范围', { exact: true })).toBeVisible();
  await expect(detailDrawer.getByText('当前时间窗口', { exact: true })).toBeVisible();
  await expect(detailDrawer.getByText('续跑规则', { exact: true })).toBeVisible();
  await expect(detailDrawer.getByRole('button', { name: '复制给 AI' })).toBeVisible();
  await detailDrawer.locator('.ant-drawer-close').click();
  await expect(detailDrawer).toBeHidden();
  await syncRow.getByRole('button', { name: '更多' }).click();
  await expect(page.getByRole('menuitem', { name: '复制任务ID' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '复制任务摘要' })).toBeVisible();
});

test('数据中心重复同步会定位到正在运行的任务进度', async ({ page }) => {
  await routeDataCenterBasics(page, 'real');
  await page.route('**/api/data/sync/tasks**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取同步任务成功',
        data: {
          items: [],
          page: 1,
          page_size: 20,
          total: 0,
          has_more: false,
        },
        error: null,
        trace_id: 'ui-running-guard-empty-tasks',
      }),
    });
  });
  await page.route('**/api/data/sync/latest', async (route) => {
    await route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({
        success: false,
        message: '同类型任务正在执行，请等待完成后重试。',
        data: null,
        error: {
          code: 'TASK_ALREADY_RUNNING',
          detail: 'task_type=sync_latest_data; active_task_id=task_existing_latest_sync; status=running',
          suggestion: '请到数据中心同步任务或系统管理运行监控查看“同步到最新完成交易日”进度，任务结束后再重新发起。',
        },
        trace_id: 'ui-running-guard-latest',
      }),
    });
  });
  await page.route('**/api/tasks/task_existing_latest_sync', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取任务成功',
        data: {
          task_id: 'task_existing_latest_sync',
          task_type: 'sync_latest_data',
          status: 'running',
          progress: 38,
          message: '正在同步到最新完成交易日：账户、委托、成交和全市场日K。',
          technical_detail: JSON.stringify({
            target_trade_date: '2026-05-19',
            rows: 12000,
            failed_symbols: 0,
          }),
          created_at: '2026-05-19 15:08:00',
          started_at: '2026-05-19 15:08:00',
          finished_at: null,
        },
        error: null,
        trace_id: 'ui-running-guard-task',
      }),
    });
  });

  await page.goto('/data-center?tab=数据同步');
  await expect(page.getByRole('button', { name: '同步到最新' }).first()).toBeEnabled({ timeout: 15_000 });
  await page.getByRole('button', { name: '同步到最新' }).first().click();
  await page.getByRole('button', { name: '开始同步' }).click();

  await expect(page.getByRole('tab', { name: '数据同步' })).toHaveAttribute('aria-selected', 'true');
  const currentTask = page.locator('.data-sync-current-task').first();
  await expect(currentTask).toBeVisible();
  await expect(currentTask).toHaveClass(/data-sync-current-task--focused/);
  await expect(currentTask.getByText('task_existing_latest_sync')).toBeVisible();
  await expect(currentTask.getByText('正在同步到最新完成交易日')).toBeVisible();
  await expect(page.getByText('已有同类型任务正在执行，已定位到当前任务进度。')).toBeVisible();
  await expect(page.getByRole('button', { name: '复制任务ID task_existing_latest_sync' })).toBeVisible();
  await expect(page.getByRole('button', { name: '查看任务详情 task_existing_latest_sync' })).toBeVisible();
  await expect(page.getByRole('button', { name: '复制任务详情 task_existing_latest_sync' })).toBeVisible();
  await expect(page.getByRole('button', { name: '跳转任务来源 task_existing_latest_sync' })).toBeVisible();

  await page.getByRole('button', { name: '查看任务详情 task_existing_latest_sync' }).click();
  const taskDrawer = page.locator('.ant-drawer').filter({ hasText: '任务详情' });
  await expect(taskDrawer).toBeVisible();
  await expect(taskDrawer.getByText('数据中心 / 数据同步').first()).toBeVisible();
  await expect(taskDrawer.getByText('target_trade_date').first()).toBeVisible();
});

test('数据中心覆盖率缺失清单导出成功和失败可诊断', async ({ page }) => {
  await routeQmtStatus(page, 'real');
  const pageResult = <T,>(items: T[]) => ({
    items,
    page: 1,
    page_size: 20,
    total: items.length,
    has_more: false,
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
          total_asset: 5381.5,
          available_cash: 0,
          frozen_cash: 0,
          market_value: 5381.5,
          today_pnl: 0,
          snapshot_time: '2026-05-19 15:06:10',
        },
        error: null,
        trace_id: 'ui-coverage-account',
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
          warning_count: 1,
          failed_count: 0,
          latest_check_time: '2026-05-19 15:06:10',
          is_stale: false,
          stale_reason: null,
        },
        error: null,
        trace_id: 'ui-coverage-quality-summary',
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
        data: pageResult([]),
        error: null,
        trace_id: 'ui-coverage-sync-tasks',
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
          target_trade_date: '2026-05-18',
          generated_at: '2026-05-19 15:06:10',
          overall_status: 'warning',
          stale_count: 0,
          warning_count: 1,
          next_actions: ['导出缺失清单前可刷新覆盖率。'],
          items: [
            {
              key: 'minute_kline',
              name: '分钟K',
              table_name: 'minute_kline',
              latest_time: '2026-05-18 14:59:00',
              target_date: '2026-05-18',
              lag_days: 0,
              status: 'warning',
              message: '分钟K覆盖率存在缺口，允许导出缺失清单排障。',
              suggestion: '导出缺失清单后按股票和交易日补齐。',
              coverage_status: 'partial',
              coverage_rate: 99.8,
              actual_rows: 99800121,
            },
          ],
        },
        error: null,
        trace_id: 'ui-coverage-freshness',
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
          limitation_note: '仅覆盖普通股票账户可用数据。',
          unsupported_items: [],
          items: [
            {
              data_type: 'minute_kline',
              name: '1分钟K数据',
              category: '行情数据',
              source_module: 'xtdata',
              official_interface: 'download_history_data2',
              local_table: 'minute_kline',
              enabled: true,
              required_for_backtest: true,
              priority: 'P0',
              account_boundary: '普通股票账户可用',
              sync_frequency: '显式长任务',
              notes: '用于分钟策略和覆盖率检查。',
            },
          ],
        },
        error: null,
        trace_id: 'ui-coverage-catalog',
      }),
    });
  });
  await page.route('**/api/data/sync/coverage-2026?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取 2026 覆盖率成功',
        data: pageResult([
          {
            id: 1,
            data_type: 'minute_kline',
            symbol: 'ALL',
            period: '1m',
            start_date: '2026-01-01',
            end_date: '2026-05-18',
            expected_trading_days: 88,
            actual_trading_days: 87,
            expected_rows: 100000000,
            actual_rows: 99800121,
            missing_days: '["2026-05-04"]',
            duplicate_rows: 0,
            coverage_rate: 99.8,
            status: 'partial',
            checked_at: '2026-05-19 15:06:10',
          },
        ]),
        error: null,
        trace_id: 'ui-coverage-page',
      }),
    });
  });
  let exportRequestCount = 0;
  await page.route('**/api/data/sync/coverage-2026/missing-export**', async (route) => {
    exportRequestCount += 1;
    if (exportRequestCount === 1) {
      await route.fulfill({
        status: 200,
        contentType: 'text/csv; charset=utf-8',
        headers: {
          'content-disposition': 'attachment; filename="data_coverage_missing_guard.csv"',
        },
        body: 'data_type,symbol,missing_days\nminute_kline,600000.SH,2026-05-04',
      });
      return;
    }
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({
        success: false,
        message: '覆盖率缺失清单导出失败',
        error: {
          code: 'COVERAGE_EXPORT_FAILED',
          detail: 'coverage export guard failure',
          suggestion: '请先刷新覆盖率后再导出缺失清单。',
        },
        trace_id: 'ui-coverage-export-failed',
      }),
    });
  });

  await page.goto('/data-center?tab=数据概览');
  await expect(page.getByRole('tab', { name: '数据概览' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('2026 覆盖率检查')).toBeVisible();
  const exportButton = page.getByRole('button', { name: /导出.*缺失清单/ }).first();
  await expect(exportButton).toBeVisible();
  await expect(exportButton).toBeEnabled();

  const downloadPromise = page.waitForEvent('download');
  await exportButton.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('data_coverage_missing_guard.csv');
  await expect(page.getByText('缺失清单已导出：data_coverage_missing_guard.csv')).toBeVisible();

  await exportButton.click();
  const exportError = page.getByRole('dialog', { name: '错误详情' });
  await expect(exportError).toBeVisible();
  await expect(exportError.getByText('覆盖率缺失清单导出失败')).toBeVisible();
  await expect(exportError.getByText('错误码：COVERAGE_EXPORT_FAILED')).toBeVisible();
  await expect(exportError.getByText('下一步建议：请先刷新覆盖率后再导出缺失清单。')).toBeVisible();
  await expect(exportError.getByText('追踪ID：ui-coverage-export-failed')).toBeVisible();
  await expect(exportError.locator('.error-panel__technical')).toContainText('coverage export guard failure');
  await expect(exportError.getByRole('button', { name: '复制给 AI' })).toBeVisible();
});

test('策略运行失败详情可打开', async ({ page }) => {
  await page.route('**/api/strategies/files**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取策略文件成功',
        data: { items: [], page: 1, page_size: 20, total: 0, has_more: false },
        error: null,
        trace_id: 'ui-b-strategy-files',
      }),
    });
  });
  await page.route('**/api/strategies/signals**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取策略信号成功',
        data: { items: [], page: 1, page_size: 20, total: 0, has_more: false },
        error: null,
        trace_id: 'ui-b-strategy-signals',
      }),
    });
  });
  await page.route('**/api/strategies/runs**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取策略运行记录成功',
        data: {
          items: [
            {
              id: 1,
              run_id: 'run_ui_failed_strategy',
              strategy_id: 18,
              task_id: 'task_ui_strategy_failed',
              status: 'failed',
              signal_count: 0,
              started_at: '2026-05-09 10:00:00',
              finished_at: '2026-05-09 10:00:01',
              message: '策略运行失败：信号格式不正确。',
              technical_detail: 'missing required field: signal_time',
            },
          ],
          page: 1,
          page_size: 20,
          total: 1,
          has_more: false,
        },
        error: null,
        trace_id: 'ui-b-strategy-runs',
      }),
    });
  });

  await page.goto('/strategy-dev');
  await page.getByRole('tab', { name: '运行调试' }).click();

  await expect(page.getByTestId('table-strategy-runs')).toBeVisible();
  await expect(page.getByRole('button', { name: '看失败' })).toBeVisible();
  await page.getByRole('button', { name: '更多' }).click();
  await expect(page.getByRole('menuitem', { name: '复制运行摘要' })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: '看失败' }).click();

  await expect(page.getByText('策略运行失败详情')).toBeVisible();
  await expect(page.locator('.ant-drawer').getByText('策略运行失败：信号格式不正确。', { exact: true }).first()).toBeVisible();
  await expect(page.locator('.ant-drawer').getByText('run_ui_failed_strategy', { exact: true }).first()).toBeVisible();
  await expect(page.locator('.ant-drawer').getByRole('button', { name: '复制给 AI' })).toBeVisible();
});

test('诊断复制在剪贴板权限受限时可降级', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error('clipboard blocked in LAN test');
        },
      },
    });
    document.execCommand = (command: string) => command === 'copy';
  });
  await page.route('**/api/strategies/files**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取策略文件成功',
        data: { items: [], page: 1, page_size: 20, total: 0, has_more: false },
        error: null,
        trace_id: 'ui-copy-fallback-files',
      }),
    });
  });
  await page.route('**/api/strategies/signals**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取策略信号成功',
        data: { items: [], page: 1, page_size: 20, total: 0, has_more: false },
        error: null,
        trace_id: 'ui-copy-fallback-signals',
      }),
    });
  });
  await page.route('**/api/strategies/runs**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取策略运行记录成功',
        data: {
          items: [{
            id: 1,
            run_id: 'run_clipboard_fallback',
            strategy_id: 18,
            task_id: 'task_clipboard_fallback',
            status: 'failed',
            signal_count: 0,
            started_at: '2026-05-20 09:00:00',
            finished_at: '2026-05-20 09:00:01',
            message: '策略运行失败：剪贴板降级测试。',
            technical_detail: 'clipboard fallback technical detail',
          }],
          page: 1,
          page_size: 20,
          total: 1,
          has_more: false,
        },
        error: null,
        trace_id: 'ui-copy-fallback-runs',
      }),
    });
  });

  await page.goto('/strategy-dev');
  await page.getByRole('tab', { name: '运行调试' }).click();
  await page.getByRole('button', { name: '看失败' }).click();
  await expect(page.getByText('策略运行失败详情')).toBeVisible();
  await page.locator('.ant-drawer').getByRole('button', { name: '复制给 AI' }).click();
  await expect(page.getByText('已复制')).toBeVisible();
});

test('策略开发代码编辑工作台可选择策略', async ({ page }) => {
  await page.route('**/api/strategies/files?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取策略文件成功',
        data: {
          items: [
            {
              id: 101,
              file_name: 'ma_demo.py',
              file_path: 'strategies/user/ma_demo.py',
              strategy_name: '均线示例策略',
              version: '1.0.0',
              description: '均线示例',
              status: 'enabled',
              last_modified_at: '2026-05-09 10:00:00',
              last_run_at: '2026-05-09 10:10:00',
              created_at: '2026-05-09 09:00:00',
              today_signal_count: 2,
            },
            {
              id: 102,
              file_name: 'momentum_demo.py',
              file_path: 'strategies/user/momentum_demo.py',
              strategy_name: '动量示例策略',
              version: '1.0.0',
              description: '动量示例',
              status: 'disabled',
              last_modified_at: '2026-05-09 10:20:00',
              last_run_at: null,
              created_at: '2026-05-09 09:30:00',
              today_signal_count: 0,
            },
          ],
          page: 1,
          page_size: 20,
          total: 2,
          has_more: false,
        },
        error: null,
        trace_id: 'ui-c-strategy-files',
      }),
    });
  });
  await page.route('**/api/strategies/files/101/content', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, message: '读取代码成功', data: { strategy_id: 101, file_name: 'ma_demo.py', code_content: 'class Strategy:\\n    def run(self):\\n        return []\\n' }, error: null, trace_id: 'ui-c-content-101' }) });
  });
  await page.route('**/api/strategies/files/102/content', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, message: '读取代码成功', data: { strategy_id: 102, file_name: 'momentum_demo.py', code_content: 'class Strategy:\\n    def run(self):\\n        return []\\n' }, error: null, trace_id: 'ui-c-content-102' }) });
  });
  for (const strategyId of [101, 102]) {
    await page.route(`**/api/strategies/${strategyId}/versions**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          message: '获取版本成功',
          data: {
            items: [
              {
                id: strategyId,
                strategy_id: strategyId,
                version_no: `v${strategyId}`,
                code_hash: `hash-${strategyId}`,
                remark: '测试版本',
                created_at: '2026-05-09 10:30:00',
              },
            ],
            page: 1,
            page_size: 20,
            total: 1,
            has_more: false,
          },
          error: null,
          trace_id: `ui-c-versions-${strategyId}`,
        }),
      });
    });
  }
  await page.route('**/api/strategies/runs**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取运行记录成功',
        data: {
          items: [
            {
              id: 1,
              run_id: 'run_ui_c_101',
              strategy_id: 101,
              strategy_name: '均线示例策略',
              strategy_file_name: 'ma_demo.py',
              strategy_version: '1.0.0',
              strategy_code_hash: 'hash-ma-demo-101',
              task_id: 'task_ui_c_101',
              status: 'success',
              signal_count: 2,
              started_at: '2026-05-09 10:10:00',
              finished_at: '2026-05-09 10:10:01',
              message: '运行成功',
              technical_detail: null,
            },
          ],
          page: 1,
          page_size: 20,
          total: 1,
          has_more: false,
        },
        error: null,
        trace_id: 'ui-c-runs',
      }),
    });
  });
  await page.route('**/api/strategies/signals**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取信号成功',
        data: { items: [], page: 1, page_size: 20, total: 0, has_more: false },
        error: null,
        trace_id: 'ui-c-signals',
      }),
    });
  });

  await page.goto('/strategy-dev');
  await page.getByRole('tab', { name: '代码编辑' }).click();

  await expect(page.getByTestId('strategy-editor-workbench')).toBeVisible();
  await expect(page.getByTestId('strategy-file-rail')).toBeVisible();
  await expect(page.getByText('均线示例策略 / ma_demo.py')).toBeVisible();
  await expect(page.getByText('策略安全边界')).toBeVisible();
  await expect(page.getByText('查看运行记录')).toBeVisible();

  await page.getByRole('button', { name: /动量示例策略/ }).click();
  await expect(page.getByText('动量示例策略 / momentum_demo.py')).toBeVisible();
  await expect(page.getByText('v102 / 2026-05-09 10:30:00')).toBeVisible();

  await page.getByRole('tab', { name: '运行调试' }).click();
  await expect(page.getByTestId('table-strategy-runs')).toContainText('均线示例策略');
  await expect(page.getByTestId('table-strategy-runs')).toContainText('ma_demo.py');
  await expect(page.getByTestId('table-strategy-runs')).toContainText('hash-ma-demo');
  await page.getByTestId('table-strategy-runs').getByRole('button', { name: '更多' }).click();
  await page.getByText('定位策略', { exact: true }).click();
  await expect(page.getByRole('tab', { name: '代码编辑' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('strategy-editor-workbench').getByText('均线示例策略 / ma_demo.py')).toBeVisible();
});

test('策略运行调试支持停止运行中的任务', async ({ page }) => {
  let stopped = false;
  await page.route('**/api/strategies/files?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取策略文件成功',
        data: {
          items: [
            {
              id: 201,
              file_name: 'running_demo.py',
              file_path: 'strategies/user/running_demo.py',
              strategy_name: '运行中策略',
              version: '1.0.0',
              description: '运行中示例',
              status: 'enabled',
              last_modified_at: '2026-05-10 10:00:00',
              last_run_at: '2026-05-10 10:00:00',
              created_at: '2026-05-10 09:00:00',
              today_signal_count: 0,
            },
          ],
          page: 1,
          page_size: 20,
          total: 1,
          has_more: false,
        },
        error: null,
        trace_id: 'ui-strategy-stop-files',
      }),
    });
  });
  await page.route('**/api/strategies/files/201/content', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '读取代码成功',
        data: { strategy_id: 201, file_name: 'running_demo.py', code_content: 'class Strategy:\\n    def run(self):\\n        return []\\n' },
        error: null,
        trace_id: 'ui-strategy-stop-content',
      }),
    });
  });
  await page.route('**/api/strategies/201/versions**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取版本成功',
        data: { items: [], page: 1, page_size: 20, total: 0, has_more: false },
        error: null,
        trace_id: 'ui-strategy-stop-versions',
      }),
    });
  });
  await page.route('**/api/strategies/runs?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取运行记录成功',
        data: {
          items: [
            {
              id: 1,
              run_id: 'run_ui_running',
              strategy_id: 201,
              task_id: 'task_ui_running',
              status: stopped ? 'cancelled' : 'running',
              signal_count: 0,
              started_at: '2026-05-10 10:00:00',
              finished_at: stopped ? '2026-05-10 10:00:01' : null,
              message: stopped ? '策略运行任务已取消。' : '策略运行中。',
              technical_detail: stopped ? 'task_cancelled=true' : null,
            },
          ],
          page: 1,
          page_size: 20,
          total: 1,
          has_more: false,
        },
        error: null,
        trace_id: 'ui-strategy-stop-runs',
      }),
    });
  });
  await page.route('**/api/strategies/runs/run_ui_running/stop', async (route) => {
    stopped = true;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '策略停止请求已提交',
        data: {
          id: 1,
          run_id: 'run_ui_running',
          strategy_id: 201,
          task_id: 'task_ui_running',
          status: 'cancelled',
          signal_count: 0,
          started_at: '2026-05-10 10:00:00',
          finished_at: '2026-05-10 10:00:01',
          message: '策略运行任务已取消。',
          technical_detail: 'task_cancelled=true',
        },
        error: null,
        trace_id: 'ui-strategy-stop-submit',
      }),
    });
  });
  await page.route('**/api/strategies/signals?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取信号成功',
        data: { items: [], page: 1, page_size: 20, total: 0, has_more: false },
        error: null,
        trace_id: 'ui-strategy-stop-signals',
      }),
    });
  });

  await page.goto('/strategy-dev?tab=运行调试');

  const runningRow = page.getByText('run_ui_running').locator('xpath=ancestor::tr');
  await runningRow.getByRole('button', { name: '更多' }).click();
  await page.getByRole('menuitem', { name: '停止运行' }).click();
  await expect(page.getByText('已取消').first()).toBeVisible();
});

test('交易危险确认文案可读', async ({ page }) => {
  await routeQmtStatus(page);
  await page.route('**/api/data/account/latest', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取账户成功',
        data: {
          id: 1,
          account_id: 'test_isolation_account',
          total_asset: 1000000,
          available_cash: 500000,
          frozen_cash: 0,
          market_value: 500000,
          today_pnl: 0,
          snapshot_time: '2026-05-09 10:00:00',
        },
        error: null,
        trace_id: 'ui-b-account',
      }),
    });
  });
  for (const path of ['positions', 'signals', 'trades', 'logs']) {
    await page.route(`**/api/trading/${path}**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          message: '获取交易数据成功',
          data: { items: [], page: 1, page_size: 20, total: 0, has_more: false },
          error: null,
          trace_id: `ui-b-${path}`,
        }),
      });
    });
  }
  await page.route('**/api/trading/orders**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取委托成功',
        data: {
          items: [
            {
              id: 1,
              local_order_id: 'LOCAL_UI_CANCEL',
              qmt_order_id: 'QMT_UI_CANCEL',
              account_id: 'test_isolation_account',
              symbol: '600000.SH',
              name: '浦发银行',
              side: 'BUY',
              price: 9.12,
              quantity: 100,
              filled_quantity: 0,
              status: '已报',
              qmt_status: 'submitted',
              source: 'manual',
              order_time: '2026-05-09 10:00:00',
              updated_at: '2026-05-09 10:00:00',
            },
          ],
          page: 1,
          page_size: 20,
          total: 1,
          has_more: false,
        },
        error: null,
        trace_id: 'ui-b-orders',
      }),
    });
  });

  await page.goto('/trading');
  await page.getByRole('tab', { name: '交易面板' }).click();
  await page.getByTestId('btn-submit-order').click();

  await expect(page.getByText('请确认下单信息，人工确认后才会提交委托请求。')).toBeVisible();
  await expect(page.getByText('确认后按钮会进入请求中状态，避免重复点击造成重复提交。')).toBeVisible();
  await page.locator('.ant-modal').getByRole('button', { name: /取\s*消/ }).click();

  await page.getByRole('tab', { name: '委托记录' }).click();
  await expect(page.getByTestId('table-trading-orders')).toBeVisible();
  const orderRow = page.getByText('LOCAL_UI_CANCEL').locator('xpath=ancestor::tr');
  await orderRow.getByRole('button', { name: '更多' }).click();
  await page.getByRole('menuitem', { name: /撤单/ }).click();

  await expect(page.getByText('即将撤销委托：LOCAL_UI_CANCEL')).toBeVisible();
  await expect(page.getByText('撤单请求提交后，最终状态仍以 QMT 同步结果为准。')).toBeVisible();
});

test('交易执行安全视觉可读', async ({ page }) => {
  await routeQmtStatus(page);
  await page.route('**/api/data/account/latest', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取账户成功',
        data: {
          id: 1,
          account_id: 'test_isolation_account',
          total_asset: 1000000,
          available_cash: 500000,
          frozen_cash: 0,
          market_value: 500000,
          today_pnl: 0,
          snapshot_time: '2026-05-09 10:00:00',
        },
        error: null,
        trace_id: 'ui-d-account',
      }),
    });
  });
  for (const path of ['positions', 'signals', 'trades', 'logs']) {
    await page.route(`**/api/trading/${path}**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          message: '获取交易数据成功',
          data: { items: [], page: 1, page_size: 20, total: 0, has_more: false },
          error: null,
          trace_id: `ui-d-${path}`,
        }),
      });
    });
  }
  await page.route('**/api/trading/orders**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取委托成功',
        data: {
          items: [
            {
              id: 1,
              local_order_id: 'LOCAL_UI_D_ACTIVE',
              qmt_order_id: 'QMT_UI_D_ACTIVE',
              account_id: 'test_isolation_account',
              symbol: '600000.SH',
              name: '浦发银行',
              side: 'BUY',
              price: 9.12,
              quantity: 100,
              filled_quantity: 0,
              status: '已报',
              qmt_status: 'submitted',
              source: 'manual',
              order_time: '2026-05-09 10:00:00',
              updated_at: '2026-05-09 10:00:00',
            },
            {
              id: 2,
              local_order_id: 'LOCAL_UI_D_FAILED',
              qmt_order_id: null,
              account_id: 'test_isolation_account',
              symbol: '000001.SZ',
              name: '平安银行',
              side: 'SELL',
              price: 10.3,
              quantity: 100,
              filled_quantity: 0,
              status: '失败',
              qmt_status: 'failed',
              source: 'signal',
              order_time: '2026-05-09 10:01:00',
              updated_at: '2026-05-09 10:01:00',
            },
          ],
          page: 1,
          page_size: 20,
          total: 2,
          has_more: false,
        },
        error: null,
        trace_id: 'ui-d-orders',
      }),
    });
  });

  await page.goto('/trading');

  const safetyPanel = page.getByTestId('trading-safety-panel');
  await expect(safetyPanel).toBeVisible();
  await expect(safetyPanel.getByText('测试隔离交易模式')).toBeVisible();
  await expect(safetyPanel.getByText('人工确认', { exact: true })).toBeVisible();
  await expect(safetyPanel.getByText('同信号仅一单', { exact: true })).toBeVisible();

  await page.getByRole('tab', { name: '交易面板' }).click();
  await expect(page.getByTestId('trading-checklist')).toBeVisible();
  await expect(page.getByText('100股一手')).toBeVisible();
  await expect(page.getByText('可提交')).toBeVisible();

  await page.getByRole('tab', { name: '委托记录' }).click();
  const orderLifecycle = page.getByTestId('order-lifecycle');
  await expect(orderLifecycle).toBeVisible();
  await expect(orderLifecycle.getByText('已报', { exact: true })).toBeVisible();
  await expect(orderLifecycle.getByText('废单/失败', { exact: true })).toBeVisible();
});

test('真实 QMT 只读模式交易按钮保持禁用', async ({ page }) => {
  await routeQmtStatus(page, 'real');
  await page.route('**/api/data/account/latest', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取真实账户成功',
        data: {
          id: 1,
          account_id: 'real-account',
          total_asset: 1000000,
          available_cash: 500000,
          frozen_cash: 0,
          market_value: 500000,
          today_pnl: 0,
          snapshot_time: '2026-05-09 10:00:00',
        },
        error: null,
        trace_id: 'ui-real-account',
      }),
    });
  });
  await page.route('**/api/trading/positions**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取真实持仓成功',
        data: {
          items: [
            {
              id: 1,
              account_id: 'real-account',
              symbol: '871169.BJ',
              name: '真实持仓',
              quantity: 229,
              available_quantity: 229,
              cost_price: 21.7479,
              last_price: 19.25,
              market_value: 4408.25,
              pnl: -572.02,
              pnl_ratio: -11.49,
              snapshot_time: '2026-05-09 10:00:00',
            },
          ],
          page: 1,
          page_size: 20,
          total: 1,
          has_more: false,
        },
        error: null,
        trace_id: 'ui-real-positions',
      }),
    });
  });
  for (const path of ['signals', 'orders', 'trades', 'logs']) {
    await page.route(`**/api/trading/${path}**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          message: '获取交易数据成功',
          data: { items: [], page: 1, page_size: 20, total: 0, has_more: false },
          error: null,
          trace_id: `ui-real-${path}`,
        }),
      });
    });
  }

  await page.goto('/trading');

  const safetyPanel = page.getByTestId('trading-safety-panel');
  await expect(safetyPanel.getByText('真实 QMT 只读验收模式')).toBeVisible();
  await expect(safetyPanel.getByText('测试历史委托、成交和日志已隔离')).toBeVisible();
  await expect(safetyPanel.getByText('真实 / 只读', { exact: true })).toBeVisible();
  await expect(safetyPanel.getByText('暂未启用', { exact: true })).toBeVisible();

  await page.getByRole('tab', { name: '当前持仓' }).click();
  await expect(page.getByText('仅展示当前真实账户的最新持仓快照')).toBeVisible();
  await expect(page.getByText('真实验收中不提供快速卖出填表')).toBeVisible();
  await expect(page.getByTestId('btn-position-sell-871169.BJ')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '查看持仓详情：871169.BJ' })).toBeVisible();
  const positionRow = page.getByText('871169.BJ').locator('xpath=ancestor::tr');
  await positionRow.getByRole('button', { name: '更多' }).click();
  await expect(page.getByRole('menuitem', { name: '填入卖出' })).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Escape');

  await page.getByRole('tab', { name: '交易面板' }).click();
  await expect(page.getByTestId('btn-submit-order')).toBeDisabled();
  await expect(page.getByTestId('btn-submit-order')).toHaveAttribute('title', '真实 QMT 只读验收中，暂不允许提交委托');

  await page.getByRole('tab', { name: '委托记录' }).click();
  await expect(page.getByRole('button', { name: '同步委托订单状态' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '同步委托订单状态' })).toHaveAttribute('title', '真实 QMT 只读订单请到数据中心同步');
  await expect(page.getByText('请到“数据中心”执行委托只读同步')).toBeVisible();

  await page.getByRole('tab', { name: '成交记录' }).click();
  await expect(page.getByRole('button', { name: '同步成交记录' })).toBeDisabled();
  await expect(page.getByText('请到“数据中心”执行成交只读同步')).toBeVisible();

  await page.getByRole('tab', { name: '执行日志' }).click();
  await expect(page.getByText('真实下单、撤单和交易中心同步均不会执行')).toBeVisible();
});

test('系统管理长期使用视觉可读', async ({ page }) => {
  const emptyPage = { items: [], page: 1, page_size: 20, total: 0, has_more: false };
  await page.route('**/api/system/config', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取系统配置成功',
        data: {
          qmt_path: 'C:/QMT',
          account_id: 'test_isolation_account',
          database_path: 'C:/LocalQuantConsole/data/local_quant.db',
          strategy_dir: 'C:/LocalQuantConsole/strategies/user',
          backup_dir: 'C:/LocalQuantConsole/backups',
          auto_connect: false,
          auto_sync: false,
          default_order_amount: 10000,
          max_order_amount: 100000,
          order_confirm_required: true,
          default_order_type: '限价委托',
          price_offset: 0,
          simulation_mode: true,
          strategy_timeout_seconds: 30,
          strategy_run_interval_seconds: 60,
          intraday_auto_run: false,
          strategy_log_level: 'info',
          strategy_max_log_mb: 50,
          log_retention_days: 30,
          task_retention_days: 30,
        },
        error: null,
        trace_id: 'ui-e-config',
      }),
    });
  });
  await page.route('**/api/system/env/results**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取环境检测成功',
        data: [
          {
            id: 1,
            task_id: 'task_ui_e_env',
            check_item: '测试隔离 QMT',
            status: 'success',
            message: '测试隔离模式可用',
            suggestion: null,
            technical_detail: null,
            created_at: '2026-05-09 12:00:00',
          },
        ],
        error: null,
        trace_id: 'ui-e-env',
      }),
    });
  });
  await page.route('**/api/system/logs**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, message: '获取日志成功', data: emptyPage, error: null, trace_id: 'ui-e-logs' }) });
  });
  await page.route('**/api/system/monitor', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取运行监控成功',
        data: {
          running_task_count: 0,
          failed_task_count: 0,
          database_size_bytes: 1024,
          log_size_bytes: 2048,
          backup_count: 1,
          recent_errors: [],
          slow_tasks: [],
        },
        error: null,
        trace_id: 'ui-e-monitor',
      }),
    });
  });
  await page.route('**/api/system/startup-check', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取启动健康检查成功',
        data: {
          app_name: 'LocalQuantConsole',
          version: '0.1.0',
          checked_at: '2026-05-09 12:00:00',
          overall_status: 'success',
          items: [{ check_item: '后端服务', status: 'success', message: '正常', suggestion: null, technical_detail: null }],
        },
        error: null,
        trace_id: 'ui-e-startup',
      }),
    });
  });
  await page.route('**/api/system/backups**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取备份成功',
        data: {
          items: [
            {
              id: 1,
              backup_name: 'backup_ui_e_20260509.zip',
              backup_path: 'C:/LocalQuantConsole/backups/backup_ui_e_20260509.zip',
              backup_size: 4096,
              status: 'success',
              created_at: '2026-05-09 12:00:00',
            },
          ],
          page: 1,
          page_size: 20,
          total: 1,
          has_more: false,
        },
        error: null,
        trace_id: 'ui-e-backups',
      }),
    });
  });
  await page.route('**/api/system/operations**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, message: '获取操作记录成功', data: emptyPage, error: null, trace_id: 'ui-e-operations' }) });
  });

  await page.goto('/system');

  const systemOpsPanel = page.getByTestId('system-ops-panel');
  await expect(systemOpsPanel).toBeVisible();
  await expect(page.getByText('本地长期使用控制中心')).toBeVisible();
  await expect(systemOpsPanel.getByText('最近备份', { exact: true })).toBeVisible();
  const pathSummary = page.getByTestId('system-path-summary');
  await expect(pathSummary).toBeVisible();
  await expect(pathSummary.getByText('策略目录', { exact: true })).toBeVisible();

  await page.getByRole('tab', { name: '备份恢复' }).click();
  const backupGuardPanel = page.getByTestId('backup-guard-panel');
  await expect(backupGuardPanel).toBeVisible();
  await expect(backupGuardPanel.getByText('恢复前快照')).toBeVisible();
  await expect(backupGuardPanel.getByText('策略目录保护')).toBeVisible();
});

test('系统管理运行监控任务可跳转到来源页面', async ({ page }) => {
  const emptyPage = { items: [], page: 1, page_size: 20, total: 0, has_more: false };
  const runningTask = {
    task_id: 'task_system_sync_guard',
    task_type: 'sync_latest_data',
    status: 'running',
    progress: 42,
    message: '同步到最新完成交易日正在执行。',
    technical_detail: 'task_type=sync_latest_data',
    started_at: '2026-05-19 15:00:00',
    finished_at: null,
    created_at: '2026-05-19 15:00:00',
  };
  await routeQmtStatus(page, 'real');
  await page.route('**/api/system/config', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取系统配置成功',
        data: {
          qmt_path: 'D:/QMT',
          account_id: 'real-account',
          database_path: 'C:/LocalQuantConsole/data/local_quant.db',
          strategy_dir: 'C:/LocalQuantConsole/strategies/user',
          backup_dir: 'C:/LocalQuantConsole/backups',
          auto_connect: false,
          auto_sync: false,
          default_order_amount: 10000,
          max_order_amount: 100000,
          order_confirm_required: true,
          default_order_type: '限价委托',
          price_offset: 0,
          simulation_mode: false,
          strategy_timeout_seconds: 30,
          strategy_run_interval_seconds: 60,
          intraday_auto_run: false,
          strategy_log_level: 'info',
          strategy_max_log_mb: 50,
          log_retention_days: 30,
          task_retention_days: 30,
        },
        error: null,
        trace_id: 'ui-monitor-nav-config',
      }),
    });
  });
  await page.route('**/api/system/env/results**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, message: '获取环境检测成功', data: [], error: null, trace_id: 'ui-monitor-nav-env' }) });
  });
  await page.route('**/api/system/logs**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, message: '获取日志成功', data: emptyPage, error: null, trace_id: 'ui-monitor-nav-logs' }) });
  });
  await page.route('**/api/system/operations**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, message: '获取操作记录成功', data: emptyPage, error: null, trace_id: 'ui-monitor-nav-ops' }) });
  });
  await page.route('**/api/system/backups**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, message: '获取备份成功', data: emptyPage, error: null, trace_id: 'ui-monitor-nav-backups' }) });
  });
  await page.route('**/api/system/startup-check', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取启动健康检查成功',
        data: { app_name: 'LocalQuantConsole', version: '0.1.0', checked_at: '2026-05-19 15:00:00', overall_status: 'success', items: [] },
        error: null,
        trace_id: 'ui-monitor-nav-startup',
      }),
    });
  });
  await page.route('**/api/system/monitor', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取运行监控成功',
        data: {
          running_task_count: 1,
          failed_task_count: 0,
          historical_failed_task_count: 0,
          database_size_bytes: 1024,
          log_size_bytes: 2048,
          backup_count: 0,
          recent_errors: [],
          slow_tasks: [runningTask],
        },
        error: null,
        trace_id: 'ui-monitor-nav-monitor',
      }),
    });
  });
  await page.route('**/api/data/account/latest', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, message: '获取账户资金成功', data: null, error: null, trace_id: 'ui-monitor-nav-account' }) });
  });
  await page.route('**/api/data/quality/summary', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, message: '获取质量摘要成功', data: { success_count: 0, warning_count: 0, failed_count: 0, latest_check_time: null }, error: null, trace_id: 'ui-monitor-nav-quality' }) });
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
          next_actions: ['关键数据已到目标日'],
          items: [],
        },
        error: null,
        trace_id: 'ui-monitor-nav-freshness',
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
        data: { items: [{ ...runningTask, sync_type: 'sync_latest_data', total_count: 0, success_count: 0, failed_count: 0 }], page: 1, page_size: 20, total: 1, has_more: false },
        error: null,
        trace_id: 'ui-monitor-nav-sync-tasks',
      }),
    });
  });
  await page.route('**/api/tasks/task_system_sync_guard', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, message: '获取任务成功', data: runningTask, error: null, trace_id: 'ui-monitor-nav-task' }) });
  });

  await page.goto('/system?tab=运行监控');
  await expect(page.getByTestId('table-monitor-tasks')).toBeVisible();
  await expect(page.getByText('task_system_sync_guard')).toBeVisible();
  await page.getByRole('button', { name: '定位任务 task_system_sync_guard' }).click();

  await expect(page).toHaveURL(/\/data-center\?tab=/);
  await expect(page.getByRole('heading', { name: '数据中心' })).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('table-sync-tasks')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('table-sync-tasks').getByText('task_system_sync_guard')).toBeVisible({ timeout: 15000 });
});

test('系统管理备份恢复危险弹窗可读且尺寸统一', async ({ page }) => {
  const emptyPage = { items: [], page: 1, page_size: 20, total: 0, has_more: false };
  await page.route('**/api/system/config', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取系统配置成功',
        data: {
          qmt_path: 'C:/QMT',
          account_id: 'real-account',
          database_path: 'C:/LocalQuantConsole/data/local_quant.db',
          strategy_dir: 'C:/LocalQuantConsole/strategies/user',
          backup_dir: 'C:/LocalQuantConsole/backups',
          auto_connect: false,
          auto_sync: false,
          default_order_amount: 10000,
          max_order_amount: 100000,
          order_confirm_required: true,
          default_order_type: '限价委托',
          price_offset: 0,
          simulation_mode: false,
          strategy_timeout_seconds: 30,
          strategy_run_interval_seconds: 60,
          intraday_auto_run: false,
          strategy_log_level: 'info',
          strategy_max_log_mb: 50,
          log_retention_days: 30,
          task_retention_days: 30,
        },
        error: null,
        trace_id: 'ui-system-guard-config',
      }),
    });
  });
  await page.route('**/api/system/env/results**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, message: '获取环境检测成功', data: [], error: null, trace_id: 'ui-system-guard-env' }) });
  });
  await page.route('**/api/system/logs**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, message: '获取日志成功', data: emptyPage, error: null, trace_id: 'ui-system-guard-logs' }) });
  });
  await page.route('**/api/system/monitor', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取运行监控成功',
        data: {
          running_task_count: 0,
          failed_task_count: 0,
          database_size_bytes: 2048,
          log_size_bytes: 4096,
          backup_count: 1,
          recent_errors: [],
          slow_tasks: [],
        },
        error: null,
        trace_id: 'ui-system-guard-monitor',
      }),
    });
  });
  await page.route('**/api/system/startup-check', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取启动健康检查成功',
        data: { app_name: 'LocalQuantConsole', version: '0.1.0', checked_at: '2026-05-19 15:00:00', overall_status: 'success', items: [] },
        error: null,
        trace_id: 'ui-system-guard-startup',
      }),
    });
  });
  await page.route('**/api/system/operations**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, message: '获取操作记录成功', data: emptyPage, error: null, trace_id: 'ui-system-guard-operations' }) });
  });
  await page.route('**/api/tasks/task_restore_guard', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取恢复任务成功',
        data: {
          task_id: 'task_restore_guard',
          task_type: 'backup_restore',
          status: 'running',
          progress: 10,
          message: '正在恢复备份，恢复前快照已创建。',
          technical_detail: 'snapshot_before_restore=true',
          created_at: '2026-05-19 15:00:00',
          started_at: '2026-05-19 15:00:00',
          finished_at: null,
        },
        error: null,
        trace_id: 'ui-system-guard-task',
      }),
    });
  });
  await page.route('**/api/system/backups**', async (route) => {
    const request = route.request();
    const url = request.url();
    const method = request.method();
    if (method === 'POST' && url.endsWith('/restore')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          message: '备份恢复任务已创建',
          data: { task_id: 'task_restore_guard', task_type: 'backup_restore', status: 'running', progress: 10, message: '正在恢复备份，恢复前快照已创建。' },
          error: null,
          trace_id: 'ui-system-guard-restore',
        }),
      });
      return;
    }
    if (method === 'DELETE') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, message: '备份已删除', data: null, error: null, trace_id: 'ui-system-guard-delete' }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取备份成功',
        data: {
          items: [
            {
              id: 1,
              backup_name: 'backup_guard_20260519.zip',
              backup_path: 'C:/LocalQuantConsole/backups/backup_guard_20260519.zip',
              backup_size: 8192,
              status: 'success',
              created_at: '2026-05-19 15:00:00',
            },
          ],
          page: 1,
          page_size: 20,
          total: 1,
          has_more: false,
        },
        error: null,
        trace_id: 'ui-system-guard-backups',
      }),
    });
  });

  await page.goto('/system?tab=备份恢复');

  await expect(page.getByTestId('table-backups')).toBeVisible();
  const backupRow = page.getByText('backup_guard_20260519.zip').locator('xpath=ancestor::tr');
  await backupRow.getByRole('button', { name: '更多' }).click();
  await page.getByRole('menuitem', { name: '恢复备份' }).click();

  const restoreModal = page.getByRole('dialog', { name: '恢复备份' });
  await expect(restoreModal).toBeVisible();
  await expect(restoreModal.getByText('系统会先自动生成当前快照，再恢复数据库和配置。')).toBeVisible();
  await expect(restoreModal.getByText('用户策略文件只会提取到备份目录，不会覆盖 strategies/user。')).toBeVisible();
  await expect(restoreModal.getByText('恢复期间请不要进行同步、回测或交易操作。')).toBeVisible();
  await expect(restoreModal.locator('.risk-confirm-content__details')).toBeVisible();
  const restoreModalWidth = await page.locator('.ant-modal-root .ant-modal:visible').last().evaluate((element) => Math.round(Number.parseFloat(window.getComputedStyle(element).width)));
  expect(restoreModalWidth).toBeGreaterThanOrEqual(680);
  expect(restoreModalWidth).toBeLessThanOrEqual(760);
  await restoreModal.getByRole('button', { name: /取\s*消/ }).click();

  await backupRow.getByRole('button', { name: '更多' }).click();
  await page.getByRole('menuitem', { name: '删除备份' }).click();
  const deleteModal = page.getByRole('dialog', { name: '删除备份' });
  await expect(deleteModal).toBeVisible();
  await expect(deleteModal.getByText('删除后该备份记录和备份文件将不可在页面恢复。')).toBeVisible();
  await expect(deleteModal.getByText('不会影响当前数据库、配置和用户策略目录。')).toBeVisible();
  await expect(deleteModal.getByText('建议至少保留一个最近可用备份后再删除旧备份。')).toBeVisible();
});

test('系统管理日志和配置导出下载可用', async ({ page }) => {
  const emptyPage = { items: [], page: 1, page_size: 20, total: 0, has_more: false };
  await page.route('**/api/system/config**', async (route) => {
    if (route.request().url().includes('/export')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'content-disposition': "attachment; filename=\"system_config_guard.json\"" },
        body: JSON.stringify({ account_id: 'real-account', simulation_mode: false }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取系统配置成功',
        data: {
          qmt_path: 'C:/QMT',
          account_id: 'real-account',
          database_path: 'C:/LocalQuantConsole/data/local_quant.db',
          strategy_dir: 'C:/LocalQuantConsole/strategies/user',
          backup_dir: 'C:/LocalQuantConsole/backups',
          auto_connect: false,
          auto_sync: false,
          default_order_amount: 10000,
          max_order_amount: 100000,
          order_confirm_required: true,
          default_order_type: '限价委托',
          price_offset: 0,
          simulation_mode: false,
          strategy_timeout_seconds: 30,
          strategy_run_interval_seconds: 60,
          intraday_auto_run: false,
          strategy_log_level: 'info',
          strategy_max_log_mb: 50,
          log_retention_days: 30,
          task_retention_days: 30,
        },
        error: null,
        trace_id: 'ui-system-export-config',
      }),
    });
  });
  await page.route('**/api/system/env/results**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, message: '获取环境检测成功', data: [], error: null, trace_id: 'ui-system-export-env' }) });
  });
  await page.route('**/api/system/logs**', async (route) => {
    if (route.request().url().includes('/export')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/zip',
        headers: { 'content-disposition': "attachment; filename=\"system_logs_guard.zip\"" },
        body: 'test isolation zipped log payload',
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取日志成功',
        data: {
          items: [
            {
              id: 1,
              module: 'system',
              level: 'info',
              message: '导出护栏测试日志',
              related_id: 'trace-export-guard',
              technical_detail: 'export_guard=true',
              created_at: '2026-05-19 16:00:00',
            },
          ],
          page: 1,
          page_size: 20,
          total: 1,
          has_more: false,
        },
        error: null,
        trace_id: 'ui-system-export-logs',
      }),
    });
  });
  await page.route('**/api/system/monitor', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取运行监控成功',
        data: {
          running_task_count: 0,
          failed_task_count: 0,
          database_size_bytes: 2048,
          log_size_bytes: 4096,
          backup_count: 0,
          recent_errors: [],
          slow_tasks: [],
        },
        error: null,
        trace_id: 'ui-system-export-monitor',
      }),
    });
  });
  await page.route('**/api/system/startup-check', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取启动健康检查成功',
        data: { app_name: 'LocalQuantConsole', version: '0.1.0', checked_at: '2026-05-19 16:00:00', overall_status: 'success', items: [] },
        error: null,
        trace_id: 'ui-system-export-startup',
      }),
    });
  });
  await page.route('**/api/system/backups**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, message: '获取备份成功', data: emptyPage, error: null, trace_id: 'ui-system-export-backups' }) });
  });
  await page.route('**/api/system/operations**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, message: '获取操作记录成功', data: emptyPage, error: null, trace_id: 'ui-system-export-operations' }) });
  });

  await page.goto('/system?tab=日志中心');
  await expect(page.getByRole('tab', { name: '日志中心', selected: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('table-system-logs')).toBeVisible({ timeout: 15_000 });

  const logsDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出系统日志' }).click();
  const logsDownload = await logsDownloadPromise;
  expect(logsDownload.suggestedFilename()).toBe('system_logs_guard.zip');

  await page.getByRole('tab', { name: '基础设置' }).click();
  const configDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出系统配置' }).click();
  const configDownload = await configDownloadPromise;
  expect(configDownload.suggestedFilename()).toBe('system_config_guard.json');
});

test('系统管理日志和配置导出失败提示可读', async ({ page }) => {
  const emptyPage = { items: [], page: 1, page_size: 20, total: 0, has_more: false };
  await page.route('**/api/system/config**', async (route) => {
    if (route.request().url().includes('/export')) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, message: '配置导出失败', error: { code: 'CONFIG_EXPORT_FAILED', detail: 'config export guard failure' }, trace_id: 'ui-system-export-config-failed' }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取系统配置成功',
        data: {
          qmt_path: 'C:/QMT',
          account_id: 'real-account',
          database_path: 'C:/LocalQuantConsole/data/local_quant.db',
          strategy_dir: 'C:/LocalQuantConsole/strategies/user',
          backup_dir: 'C:/LocalQuantConsole/backups',
          auto_connect: false,
          auto_sync: false,
          default_order_amount: 10000,
          max_order_amount: 100000,
          order_confirm_required: true,
          default_order_type: '限价委托',
          price_offset: 0,
          simulation_mode: false,
          strategy_timeout_seconds: 30,
          strategy_run_interval_seconds: 60,
          intraday_auto_run: false,
          strategy_log_level: 'info',
          strategy_max_log_mb: 50,
          log_retention_days: 30,
          task_retention_days: 30,
        },
        error: null,
        trace_id: 'ui-system-export-failure-config',
      }),
    });
  });
  await page.route('**/api/system/env/results**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, message: '获取环境检测成功', data: [], error: null, trace_id: 'ui-system-export-failure-env' }) });
  });
  await page.route('**/api/system/logs**', async (route) => {
    if (route.request().url().includes('/export')) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ success: false, message: '日志导出失败', error: { code: 'LOG_EXPORT_FAILED', detail: 'log export guard failure' }, trace_id: 'ui-system-export-logs-failed' }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取日志成功',
        data: {
          items: [
            {
              id: 1,
              module: 'system',
              level: 'error',
              message: '导出失败护栏日志',
              related_id: 'trace-export-failure-guard',
              technical_detail: 'export_failure_guard=true',
              created_at: '2026-05-19 16:30:00',
            },
          ],
          page: 1,
          page_size: 20,
          total: 1,
          has_more: false,
        },
        error: null,
        trace_id: 'ui-system-export-failure-logs',
      }),
    });
  });
  await page.route('**/api/system/monitor', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取运行监控成功',
        data: {
          running_task_count: 0,
          failed_task_count: 0,
          database_size_bytes: 2048,
          log_size_bytes: 4096,
          backup_count: 0,
          recent_errors: [],
          slow_tasks: [],
        },
        error: null,
        trace_id: 'ui-system-export-failure-monitor',
      }),
    });
  });
  await page.route('**/api/system/startup-check', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取启动健康检查成功',
        data: { app_name: 'LocalQuantConsole', version: '0.1.0', checked_at: '2026-05-19 16:30:00', overall_status: 'success', items: [] },
        error: null,
        trace_id: 'ui-system-export-failure-startup',
      }),
    });
  });
  await page.route('**/api/system/backups**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, message: '获取备份成功', data: emptyPage, error: null, trace_id: 'ui-system-export-failure-backups' }) });
  });
  await page.route('**/api/system/operations**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, message: '获取操作记录成功', data: emptyPage, error: null, trace_id: 'ui-system-export-failure-operations' }) });
  });

  await page.goto('/system?tab=日志中心');
  await expect(page.getByTestId('table-system-logs')).toBeVisible();

  await page.getByRole('button', { name: '导出系统日志' }).click();
  const logExportError = page.getByRole('dialog', { name: '错误详情' });
  await expect(logExportError).toBeVisible();
  await expect(logExportError.getByText('日志导出失败')).toBeVisible();
  await expect(logExportError.getByText('错误码：LOG_EXPORT_FAILED')).toBeVisible();
  await expect(logExportError.getByText('下一步建议：请检查后端服务和导出权限。')).toBeVisible();
  await expect(logExportError.getByText('追踪ID：ui-system-export-logs-failed')).toBeVisible();
  await expect(logExportError.locator('.error-panel__technical')).toContainText('log export guard failure');
  await logExportError.locator('.ant-modal-close').click();

  await page.getByRole('tab', { name: '基础设置' }).click();
  await page.getByRole('button', { name: '导出系统配置' }).click();
  const configExportError = page.getByRole('dialog', { name: '错误详情' });
  await expect(configExportError).toBeVisible();
  await expect(configExportError.getByText('配置导出失败')).toBeVisible();
  await expect(configExportError.getByText('错误码：CONFIG_EXPORT_FAILED')).toBeVisible();
  await expect(configExportError.getByText('追踪ID：ui-system-export-config-failed')).toBeVisible();
  await expect(configExportError.locator('.error-panel__technical')).toContainText('config export guard failure');
  await expect(configExportError.getByRole('button', { name: '复制给 AI' })).toBeVisible();
});

test('关键操作按钮提示可读', async ({ page }) => {
  test.setTimeout(60_000);
  await routeDataCenterBasics(page);
  await page.route('**/api/data/sync/tasks**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取同步任务成功',
        data: {
          items: [
            {
              task_id: 'task_ui_button_hint',
              sync_type: 'daily_kline',
              status: 'failed',
              total_count: 3,
              success_count: 1,
              failed_count: 2,
              progress: 100,
              message: '按钮提示测试：2 只股票同步失败，可打开失败详情。',
              technical_detail: JSON.stringify({ failed_symbols: ['600000.SH', '000001.SZ'], reason: 'ui button hint fixture' }),
              started_at: '2026-05-09 10:30:00',
              finished_at: '2026-05-09 10:31:00',
            },
          ],
          page: 1,
          page_size: 20,
          total: 1,
          has_more: false,
        },
        error: null,
        trace_id: 'ui-b-button-hint',
      }),
    });
  });
  await page.route('**/api/data/catalog/official**', async (route) => {
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
          limitation_note: '自动化测试隔离数据目录。',
          unsupported_items: [],
          items: [],
        },
        error: null,
        trace_id: 'ui-button-official-catalog',
      }),
    });
  });
  await page.route('**/api/data/sync/coverage-2026**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取 2026 覆盖率成功',
        data: { items: [], page: 1, page_size: 20, total: 0, has_more: false },
        error: null,
        trace_id: 'ui-button-coverage',
      }),
    });
  });
  await page.route('**/api/data/account/latest', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取账户成功',
        data: {
          id: 1,
          account_id: 'test_isolation_account',
          total_asset: 1000000,
          available_cash: 500000,
          frozen_cash: 0,
          market_value: 500000,
          today_pnl: 0,
          snapshot_time: '2026-05-09 10:00:00',
        },
        error: null,
        trace_id: 'ui-button-account',
      }),
    });
  });
  for (const path of ['positions', 'signals', 'orders', 'trades', 'logs']) {
    await page.route(`**/api/trading/${path}**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          message: '获取交易数据成功',
          data: { items: [], page: 1, page_size: 20, total: 0, has_more: false },
          error: null,
          trace_id: `ui-button-${path}`,
        }),
      });
    });
  }

  const syncTasksResponse = page.waitForResponse((response) =>
    response.url().includes('/api/data/sync/tasks') && response.status() === 200,
  );
  await page.goto('/data-center?tab=数据同步', { waitUntil: 'domcontentloaded' });
  await syncTasksResponse;
  await expect(page.getByRole('tab', { name: '数据同步' })).toHaveAttribute('aria-selected', 'true', { timeout: 15000 });
  await expect(page.getByTestId('table-sync-tasks')).toBeVisible({ timeout: 15000 });
  const syncFailureButton = page.getByTestId('table-sync-tasks').getByRole('button', { name: '看失败' }).first();
  await expect(page.getByTestId('table-sync-tasks')).toContainText('task_ui_button_hint', { timeout: 30000 });
  await expect(syncFailureButton).toBeVisible({ timeout: 30000 });
  await expect(syncFailureButton).toHaveAttribute('title', '查看同步失败详情');

  await page.goto('/trading?tab=交易面板', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: '交易执行' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('tab', { name: '交易面板' })).toHaveAttribute('aria-selected', 'true', { timeout: 30_000 });
  await expect(page.getByTestId('btn-submit-order')).toHaveAttribute(
    'title',
    /提交手动下单并进入确认|真实 QMT 只读验收中，暂不允许提交委托/,
    { timeout: 30_000 },
  );

  await page.goto('/system');
  await expect(page.getByTestId('btn-save-config')).toHaveAttribute('title', '保存系统基础设置');
});

test('DataTable 当前页搜索可用', async ({ page }) => {
  await routeQmtStatus(page, 'real');
  await page.route('**/api/data/account/latest', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取账户成功',
        data: {
          id: 1,
          account_id: 'test_isolation_account',
          total_asset: 1000000,
          available_cash: 500000,
          frozen_cash: 0,
          market_value: 500000,
          today_pnl: 0,
          snapshot_time: '2026-05-09 11:00:00',
        },
        error: null,
        trace_id: 'ui-b-search-account',
      }),
    });
  });
  for (const path of ['positions', 'signals', 'trades', 'logs']) {
    await page.route(`**/api/trading/${path}**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          message: '获取交易数据成功',
          data: { items: [], page: 1, page_size: 20, total: 0, has_more: false },
          error: null,
          trace_id: `ui-b-search-${path}`,
        }),
      });
    });
  }
  await page.route('**/api/trading/orders**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取委托成功',
        data: {
          items: [
            {
              id: 1,
              local_order_id: 'LOCAL_SEARCH_600000',
              qmt_order_id: 'QMT_SEARCH_600000',
              account_id: 'test_isolation_account',
              symbol: '600000.SH',
              name: '浦发银行',
              side: 'BUY',
              price: 9.12,
              quantity: 100,
              filled_quantity: 0,
              status: '已报',
              qmt_status: 'submitted',
              source: 'manual',
              order_time: '2026-05-09 11:00:00',
              updated_at: '2026-05-09 11:00:00',
            },
            {
              id: 2,
              local_order_id: 'LOCAL_SEARCH_000001',
              qmt_order_id: 'QMT_SEARCH_000001',
              account_id: 'test_isolation_account',
              symbol: '000001.SZ',
              name: '平安银行',
              side: 'SELL',
              price: 10.3,
              quantity: 100,
              filled_quantity: 100,
              status: '已撤',
              qmt_status: 'cancelled',
              source: 'signal',
              order_time: '2026-05-09 11:01:00',
              updated_at: '2026-05-09 11:01:00',
            },
          ],
          page: 1,
          page_size: 20,
          total: 2,
          has_more: false,
        },
        error: null,
        trace_id: 'ui-b-search-orders',
      }),
    });
  });

  await page.goto('/trading?tab=委托记录');
  await expect(page.getByRole('tab', { name: '委托记录' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('table-trading-orders')).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId('table-trading-orders').getByText('浦发银行')).toBeVisible();
  await expect(page.getByTestId('table-trading-orders').getByText('平安银行')).toBeVisible();

  await page.getByPlaceholder('当前页搜索订单号/股票').fill('600000');
  await expect(page.getByTestId('table-trading-orders').getByText('浦发银行')).toBeVisible();
  await expect(page.getByTestId('table-trading-orders').getByText('平安银行')).not.toBeVisible();

  await page.getByPlaceholder('当前页搜索订单号/股票').fill('不存在的订单');
  await expect(page.getByText('筛选无结果')).toBeVisible();
  await expect(page.getByText('当前筛选条件下暂无数据')).toBeVisible();
  await expect(page.getByText('请调整筛选条件或刷新重试；清除搜索和筛选后会恢复当前页数据。')).toBeVisible();
});

test('DataTable 空状态显示下一步操作按钮', async ({ page }) => {
  await routeQmtStatus(page, 'real');
  await page.route('**/api/data/account/latest', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取账户成功',
        data: {
          id: 1,
          account_id: 'real-account',
          total_asset: 1000000,
          available_cash: 500000,
          frozen_cash: 0,
          market_value: 500000,
          today_pnl: 0,
          snapshot_time: '2026-05-15 11:00:00',
        },
        error: null,
        trace_id: 'ui-empty-action-account',
      }),
    });
  });
  for (const path of ['positions', 'orders', 'trades', 'logs']) {
    await page.route(`**/api/trading/${path}**`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          message: '获取交易数据成功',
          data: { items: [], page: 1, page_size: 20, total: 0, has_more: false },
          error: null,
          trace_id: `ui-empty-action-${path}`,
        }),
      });
    });
  }
  await page.route('**/api/trading/signals**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        message: '获取交易信号成功',
        data: { items: [], page: 1, page_size: 20, total: 0, has_more: false },
        error: null,
        trace_id: 'ui-empty-action-signals',
      }),
    });
  });

  await page.goto('/trading?tab=信号下单');
  await expect(page.getByText('暂无可下单信号。请先到“策略开发”运行策略；已有信号会在这里进入人工确认下单流程，不会自动交易。')).toBeVisible();
  const emptyStateStrategyButton = page.getByRole('button', { name: '从空状态打开策略开发' });
  await expect(emptyStateStrategyButton).toBeVisible();

  await emptyStateStrategyButton.click();
  await expect(page).toHaveURL(/\/strategy-dev\?tab=/);
  expect(decodeURIComponent(page.url())).toContain('tab=代码编辑');
});

test('页面 Tab 状态支持 URL 深链和点击同步', async ({ page }) => {
  test.setTimeout(60000);
  const checks = [
    { path: '/dashboard?tab=今日交易', tab: '今日交易' },
    { path: '/data-center?tab=数据同步', tab: '数据同步' },
    { path: '/strategy-dev?tab=代码编辑', tab: '代码编辑' },
    { path: '/backtest?tab=回测日志', tab: '回测日志' },
    { path: '/trading?tab=执行日志', tab: '执行日志' },
    { path: '/system?tab=环境检测', tab: '环境检测' },
  ];

  for (const check of checks) {
    await page.goto(check.path, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('tab', { name: check.tab })).toHaveAttribute('aria-selected', 'true', { timeout: 15000 });
  }

  await page.goto('/trading', { waitUntil: 'domcontentloaded' });
  await page.getByRole('tab', { name: '委托记录' }).click();
  expect(decodeURIComponent(page.url())).toContain('tab=委托记录');
});
