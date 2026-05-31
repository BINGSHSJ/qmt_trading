export function formatMaybe(value: unknown, fallback = '暂无') {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value);
}

export function formatMoney(value?: number | null, precision = 2) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '暂无';
  return `${value.toLocaleString('zh-CN', {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  })} 元`;
}

export function formatMoneyByUnit(value?: number | null, precision = 2) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '暂无';
  const absValue = Math.abs(value);
  if (absValue >= 10000) {
    const scaled = value / 10000;
    return `${scaled.toLocaleString('zh-CN', {
      minimumFractionDigits: precision,
      maximumFractionDigits: precision,
    })} 万元`;
  }
  return formatMoney(value, precision);
}

export function formatPrice(value?: number | null) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '暂无';
  return value.toFixed(3);
}

export function formatQuantity(value?: number | null, unit = '股') {
  if (typeof value !== 'number' || Number.isNaN(value)) return '暂无';
  return `${value.toLocaleString('zh-CN')} ${unit}`;
}

export function formatPercent(value?: number | null, precision = 2) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '暂无';
  return `${value.toFixed(precision)}%`;
}

export function formatSide(value?: string | null) {
  if (value === 'BUY') return '买入';
  if (value === 'SELL') return '卖出';
  if (value === 'WATCH') return '观察';
  return value || '暂无';
}

export function getSideColor(value?: string | null) {
  if (value === 'BUY') return 'red';
  if (value === 'SELL') return 'green';
  return 'default';
}

export function getPnLTextType(value?: number | null) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 'secondary';
  return value >= 0 ? 'danger' : 'success';
}

export function formatStockLabel(symbol?: string | null, name?: string | null) {
  const stockCode = String(symbol || '').trim();
  const stockName = String(name || '').trim();
  if (!stockCode && !stockName) return '暂无';
  if (!stockName || stockName === stockCode) return `${stockCode} 名称待同步`.trim();
  return `${stockCode} ${stockName}`.trim();
}

const statusLabels: Record<string, string> = {
  pending: '等待中',
  running: '运行中',
  success: '成功',
  failed: '失败',
  cancelled: '已取消',
  enabled: '启用',
  disabled: '停用',
  warning: '警告',
  complete: '完整',
  partial: '部分',
  missing: '缺失',
  fresh: '新鲜',
  stale: '过期',
  filled: '已成交',
  submitted: '已提交',
  unknown: '待同步',
  待提交: '待提交',
  已提交: '已提交',
  已报: '已报',
  部分成交: '部分成交',
  全部成交: '全部成交',
  已撤: '已撤',
  废单: '废单',
  失败: '失败',
  待同步: '待同步',
  未处理: '未处理',
  已下单: '已下单',
  已忽略: '已忽略',
  已成交: '已成交',
  跳过: '跳过',
  未成交: '未成交',
  观察: '观察',
  info: '信息',
  error: '错误',
};

const statusColors: Record<string, string> = {
  pending: 'default',
  running: 'blue',
  success: 'green',
  failed: 'red',
  cancelled: 'orange',
  enabled: 'green',
  disabled: 'default',
  warning: 'orange',
  complete: 'green',
  partial: 'orange',
  missing: 'red',
  fresh: 'green',
  stale: 'red',
  filled: 'green',
  submitted: 'blue',
  unknown: 'gold',
  待提交: 'default',
  已提交: 'blue',
  已报: 'blue',
  部分成交: 'orange',
  全部成交: 'green',
  已撤: 'default',
  废单: 'red',
  失败: 'red',
  待同步: 'gold',
  未处理: 'orange',
  已下单: 'blue',
  已忽略: 'default',
  已成交: 'green',
  跳过: 'orange',
  未成交: 'orange',
  观察: 'blue',
  info: 'blue',
  error: 'red',
};

export function formatStatusLabel(value?: string | null) {
  if (!value) return '暂无';
  return statusLabels[value] ?? value;
}

export function getStatusColor(value?: string | null) {
  if (!value) return 'default';
  return statusColors[value] ?? 'default';
}
