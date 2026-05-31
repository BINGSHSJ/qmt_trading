import { Input, Select, Space, Table, Typography } from 'antd';
import type { TableProps } from 'antd';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import EmptyGuide from '../EmptyGuide';
import FilterBar from '../FilterBar';
import Toolbar from '../Toolbar';
import './DataTable.css';

type SearchField<T extends object> = keyof T | ((record: T) => unknown);

interface QuickSearch<T extends object> {
  placeholder: string;
  fields: SearchField<T>[];
  width?: number;
  value?: string;
  onChange?: (value: string) => void;
  onSearch?: (value: string) => void;
}

interface QuickFilterOption {
  label: string;
  value: string;
}

interface QuickFilter<T extends object> {
  label: string;
  options: QuickFilterOption[];
  getValue: (record: T) => unknown;
  width?: number;
  value?: string;
  onChange?: (value: string | undefined) => void;
}

interface DataTableProps<T extends object> extends TableProps<T> {
  toolbarTitle?: ReactNode;
  toolbarDescription?: ReactNode;
  updatedAt?: string | null;
  onRefresh?: () => void;
  emptyDescription?: string;
  emptyReason?: string;
  emptyAction?: ReactNode;
  toolbarRight?: ReactNode;
  quickSearch?: QuickSearch<T>;
  quickFilters?: QuickFilter<T>[];
  quickFilterScope?: 'client' | 'server';
  quickFilterHint?: ReactNode;
  disableAutoScroll?: boolean;
  'data-testid'?: string;
}

const defaultPageSizeOptions = ['10', '20', '50', '100', '200'];
const defaultEmptyDescription = '暂无列表数据。请刷新当前页，或确认对应业务数据是否已经同步。';
const filterEmptyTitle = '筛选无结果';
const filterEmptyReason = '当前筛选条件下暂无数据';
const filterEmptyDescription = '请调整筛选条件或刷新重试；清除搜索和筛选后会恢复当前页数据。';

export default function DataTable<T extends object>({
  toolbarTitle,
  toolbarDescription,
  updatedAt,
  onRefresh,
  emptyDescription = defaultEmptyDescription,
  emptyReason,
  emptyAction,
  toolbarRight,
  quickSearch,
  quickFilters = [],
  quickFilterScope = 'client',
  quickFilterHint,
  disableAutoScroll = false,
  loading,
  locale,
  dataSource,
  pagination,
  columns,
  className,
  scroll,
  'data-testid': dataTestId,
  ...tableProps
}: DataTableProps<T>) {
  const [keyword, setKeyword] = useState('');
  const [filterValues, setFilterValues] = useState<Record<string, string | undefined>>({});
  const rows = useMemo(() => (Array.isArray(dataSource) ? dataSource : []), [dataSource]);
  const searchValue = quickSearch?.value ?? keyword;
  const normalizedKeyword = normalizeText(searchValue);
  const activeFilterValues = useMemo(
    () => quickFilters.map((filter) => filter.value ?? filterValues[filter.label]),
    [filterValues, quickFilters],
  );

  const filteredRows = useMemo(() => {
    if (quickFilterScope === 'server') return rows;
    if (!normalizedKeyword && activeFilterValues.every((value) => !value)) return rows;
    return rows.filter((record) => {
      const keywordMatched = !normalizedKeyword || quickSearch?.fields.some((field) => normalizeText(readField(record, field)).includes(normalizedKeyword));
      const filtersMatched = quickFilters.every((filter) => {
        const selected = filter.value ?? filterValues[filter.label];
        if (!selected) return true;
        return normalizeText(filter.getValue(record)) === normalizeText(selected);
      });
      return Boolean(keywordMatched && filtersMatched);
    });
  }, [activeFilterValues, filterValues, normalizedKeyword, quickFilterScope, quickFilters, quickSearch?.fields, rows]);
  const semanticColumns = useMemo(() => withSemanticColumnClasses(columns), [columns]);

  const hasQuickControls = Boolean(quickSearch || quickFilters.length > 0);
  const hasActiveQuickControls = Boolean(normalizedKeyword || activeFilterValues.some(Boolean));
  const isEmpty = filteredRows.length === 0;
  const hasToolbar = toolbarTitle || toolbarDescription || updatedAt !== undefined || onRefresh || toolbarRight || hasQuickControls;
  const tableLoading = rows.length === 0 ? loading : false;
  const updateKeyword = (nextValue: string) => {
    setKeyword(nextValue);
    quickSearch?.onChange?.(nextValue);
  };
  const submitKeyword = (nextValue: string) => {
    setKeyword(nextValue);
    quickSearch?.onSearch?.(nextValue);
  };
  const quickControls = hasQuickControls ? (
    <Space direction="vertical" size={2} className="data-table__quick-stack">
      <FilterBar className="data-table__quick-controls">
        {quickSearch ? (
          <Input.Search
            allowClear
            aria-label={quickSearch.placeholder}
            placeholder={quickSearch.placeholder}
            size="small"
            value={searchValue}
            onChange={(event) => updateKeyword(event.target.value)}
            onSearch={submitKeyword}
            style={{ width: quickSearch.width ?? 220 }}
          />
        ) : null}
        {quickFilters.map((filter) => {
          const selectedValue = filter.value ?? filterValues[filter.label];
          return (
            <Select
              allowClear
              aria-label={filter.label}
              key={filter.label}
              options={filter.options}
              placeholder={filter.label}
              size="small"
              value={selectedValue}
              onChange={(value) => {
                setFilterValues((previous) => ({ ...previous, [filter.label]: value }));
                filter.onChange?.(value);
              }}
              style={{ width: filter.width ?? 132 }}
            />
          );
        })}
      </FilterBar>
      <Typography.Text type="secondary" className="data-table__quick-hint">
        {quickFilterHint ?? (quickFilterScope === 'client' ? '当前页筛选，清除条件后恢复当前页数据。' : '服务端筛选，条件会随刷新请求提交。')}
      </Typography.Text>
    </Space>
  ) : null;
  const normalizedPagination = useMemo(() => {
    if (pagination === false) return false;
    const base = typeof pagination === 'object' ? pagination : {};
    const merged = {
      pageSize: 20,
      size: 'small' as const,
      showSizeChanger: true,
      showQuickJumper: false,
      showLessItems: true,
      pageSizeOptions: defaultPageSizeOptions,
      showTotal: (total: number, range: [number, number]) => `第 ${range[0]}-${range[1]} 条 / 共 ${total} 条`,
      ...base,
    };
    if (quickFilterScope === 'server' || !hasActiveQuickControls) return merged;
    return { ...merged, current: 1, total: filteredRows.length };
  }, [filteredRows.length, hasActiveQuickControls, pagination, quickFilterScope]);
  const tablePagination = isEmpty ? false : normalizedPagination;

  const wrapperClassName = [
    'data-table',
    hasToolbar ? 'data-table--with-toolbar' : '',
    hasQuickControls ? 'data-table--with-quick-controls' : '',
    isEmpty ? 'data-table--empty' : '',
    className,
  ].filter(Boolean).join(' ');
  const normalizedTableLayout = tableProps.tableLayout ?? 'fixed';
  const emptyGuideAction = tableLoading || hasActiveQuickControls ? undefined : emptyAction;

  return (
    <div className={wrapperClassName} data-testid={dataTestId}>
      {hasToolbar ? (
        <Toolbar
          title={toolbarTitle}
          description={toolbarDescription}
          updatedAt={updatedAt}
          loading={Boolean(loading)}
          onRefresh={onRefresh}
          left={quickControls}
          right={toolbarRight}
        />
      ) : null}
      <Table<T>
        size="small"
        className="data-table__table"
        columns={semanticColumns}
        dataSource={filteredRows}
        loading={tableLoading}
        locale={{
          emptyText: (
            <EmptyGuide
              title={hasActiveQuickControls ? filterEmptyTitle : undefined}
              description={hasActiveQuickControls ? filterEmptyDescription : emptyDescription}
              reason={hasActiveQuickControls ? filterEmptyReason : emptyReason}
              action={emptyGuideAction}
            />
          ),
          ...locale,
        }}
        pagination={tablePagination}
        scroll={disableAutoScroll ? scroll : scroll ?? { x: 'max-content' }}
        {...tableProps}
        tableLayout={normalizedTableLayout}
      />
    </div>
  );
}

function normalizeText(value: unknown) {
  return String(value ?? '').trim().toLowerCase();
}

function readField<T extends object>(record: T, field: SearchField<T>) {
  return typeof field === 'function' ? field(record) : record[field];
}

function withSemanticColumnClasses<T extends object>(columns: TableProps<T>['columns']): TableProps<T>['columns'] {
  if (!columns) return columns;
  return columns.map((column) => normalizeColumn(column as Record<string, unknown>)) as TableProps<T>['columns'];
}

function normalizeColumn(column: Record<string, unknown>): Record<string, unknown> {
  const semanticClass = getSemanticColumnClass(column);
  const semanticKind = semanticClass.replace('data-table-col--', '');
  const semanticFamily = getSemanticColumnFamily(semanticKind);
  const nextColumn = {
    ...column,
    children: Array.isArray(column.children)
      ? column.children.map((child) => normalizeColumn(child as Record<string, unknown>))
      : column.children,
  };
  if (!semanticClass) return nextColumn;

  const originalOnHeaderCell = column.onHeaderCell;
  const originalOnCell = column.onCell;
  return {
    ...applySemanticColumnDefaults(nextColumn, semanticClass),
    className: mergeClassName(column.className, semanticClass),
    onCell: (...args: unknown[]) => {
      const cellProps = typeof originalOnCell === 'function'
        ? originalOnCell(...args)
        : {};
      const title = semanticClass === 'data-table-col--message'
        ? readCellTitle(args[0], column.dataIndex)
        : undefined;
      return {
        ...cellProps,
        className: mergeClassName((cellProps as { className?: unknown }).className, semanticClass),
        'data-column-kind': semanticKind,
        'data-column-family': semanticFamily,
        ...(title && !(cellProps as { title?: unknown }).title ? { title } : {}),
      };
    },
    onHeaderCell: (...args: unknown[]) => {
      const headerCellProps = typeof originalOnHeaderCell === 'function'
        ? originalOnHeaderCell(...args)
        : {};
      return {
        ...headerCellProps,
        className: mergeClassName((headerCellProps as { className?: unknown }).className, semanticClass),
        'data-column-kind': semanticKind,
        'data-column-family': semanticFamily,
      };
    },
  };
}

function getSemanticColumnFamily(kind: string) {
  if (['id', 'stock', 'name', 'file', 'strategy', 'source', 'type', 'range', 'date', 'time'].includes(kind)) return 'identity';
  if (['status', 'side'].includes(kind)) return 'state';
  if (['number'].includes(kind)) return 'numeric';
  if (['message'].includes(kind)) return 'narrative';
  if (['action'].includes(kind)) return 'action';
  return 'neutral';
}

function applySemanticColumnDefaults(column: Record<string, unknown>, semanticClass: string): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  const hasWidth = column.width !== undefined;

  if (!hasWidth) {
    if (semanticClass === 'data-table-col--action') defaults.width = 'var(--lqc-table-col-action, 112px)';
    if (semanticClass === 'data-table-col--side') defaults.width = 'var(--lqc-table-col-side, 72px)';
    if (semanticClass === 'data-table-col--status') defaults.width = 'var(--lqc-table-col-status, 82px)';
    if (semanticClass === 'data-table-col--time') defaults.width = 'var(--lqc-table-col-time, 156px)';
    if (semanticClass === 'data-table-col--date') defaults.width = 'var(--lqc-table-col-date, 108px)';
    if (semanticClass === 'data-table-col--stock') defaults.width = 'var(--lqc-table-col-stock, 140px)';
    if (semanticClass === 'data-table-col--number') defaults.width = 'var(--lqc-table-col-number, 112px)';
    if (semanticClass === 'data-table-col--id') defaults.width = 'var(--lqc-table-col-id, 160px)';
    if (semanticClass === 'data-table-col--name') defaults.width = 'var(--lqc-table-col-name, 176px)';
    if (semanticClass === 'data-table-col--file') defaults.width = 'var(--lqc-table-col-file, 184px)';
    if (semanticClass === 'data-table-col--strategy') defaults.width = 'var(--lqc-table-col-strategy, 208px)';
    if (semanticClass === 'data-table-col--range') defaults.width = 'var(--lqc-table-col-range, 156px)';
    if (semanticClass === 'data-table-col--source') defaults.width = 'var(--lqc-table-col-source, 92px)';
    if (semanticClass === 'data-table-col--type') defaults.width = 'var(--lqc-table-col-type, 108px)';
    if (semanticClass === 'data-table-col--message') defaults.width = 'var(--lqc-table-col-message, 300px)';
  }

  if (semanticClass === 'data-table-col--number' && column.align === undefined) {
    defaults.align = 'right';
  }

  if (
    (
      semanticClass === 'data-table-col--id'
      || semanticClass === 'data-table-col--stock'
      || semanticClass === 'data-table-col--name'
      || semanticClass === 'data-table-col--file'
      || semanticClass === 'data-table-col--strategy'
      || semanticClass === 'data-table-col--source'
      || semanticClass === 'data-table-col--type'
    )
    && column.ellipsis === undefined
  ) {
    defaults.ellipsis = true;
  }

  return {
    ...defaults,
    ...column,
  };
}

function getSemanticColumnClass(column: Record<string, unknown>) {
  const titleText = readColumnText(column.title).toLowerCase();
  const dataIndexText = readColumnText(column.dataIndex).toLowerCase();
  const keyTextOnly = readColumnText(column.key).toLowerCase();
  const keyText = [
    titleText,
    dataIndexText,
    keyTextOnly,
  ].join(' ').toLowerCase();
  const hasDataIndex = column.dataIndex !== undefined;

  if (/(操作|详情|诊断|更多|撤单|下单|导出|查看)/i.test(titleText) && !hasDataIndex) return 'data-table-col--action';
  if (/(actions?|operation|operate|buttons?)/i.test(keyTextOnly) && !hasDataIndex) return 'data-table-col--action';
  if (hasDataIndex && /(操作|operation)/i.test(titleText)) return 'data-table-col--type';
  if (/(方向|动作|买卖|side)/i.test(keyText) || dataIndexText === 'action') return 'data-table-col--side';
  if (/(状态|status|进度|progress|结果|是否|级别|level|防重复)/i.test(keyText)) return 'data-table-col--status';
  if (/(时间|创建|开始|结束|修改|保存|运行|成交时间|委托时间|快照|time|created|started|finished|modified|run_at|last_run)/i.test(keyText)) return 'data-table-col--time';
  if (/(日期|交易日|上市日期|到期日期|date|trade_date|open_date|expire_date)/i.test(keyText)) return 'data-table-col--date';
  if (/(id|编号|订单|委托|任务|run_id|task_id|order_id|local_order_id|qmt_order_id)/i.test(keyText)) return 'data-table-col--id';
  if (/(策略|strategy)/i.test(keyText)) return 'data-table-col--strategy';
  if (/(文件|file|filename|file_name)/i.test(keyText)) return 'data-table-col--file';
  if (/(名称|name|标题|title)/i.test(keyText)) return 'data-table-col--name';
  if (/(区间|范围|range|scope|窗口|window)/i.test(keyText)) return 'data-table-col--range';
  if (/(来源|数据源|模块|source|模式|mode|module)/i.test(keyText)) return 'data-table-col--source';
  if (/(类型|分类|市场|优先级|版本|频率|category|type|market|priority|version|frequency)/i.test(keyText)) return 'data-table-col--type';
  if (/(股票|证券|代码|标的|symbol|stock)/i.test(keyText)) return 'data-table-col--stock';
  if (/(价格|金额|资金|资产|市值|现金|数量|成交量|成交额|费用|盈亏|比率|比例|覆盖率|缺口|滞后|延迟|今日信号|信号数|price|amount|cash|asset|market|quantity|volume|fee|pnl|ratio|percent|rate|lag|delay|signal_count)/i.test(keyText)) return 'data-table-col--number';
  if (/(说明|原因|详情|错误|日志|建议|技术|摘要|message|reason|detail|error|log|summary)/i.test(keyText)) return 'data-table-col--message';
  if (/(操作|action)/i.test(keyText)) return 'data-table-col--type';
  return '';
}

function readCellTitle(record: unknown, dataIndex: unknown): string | undefined {
  const value = readDataIndexValue(record, dataIndex);
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return value.trim() || undefined;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

function readDataIndexValue(record: unknown, dataIndex: unknown): unknown {
  if (!dataIndex) return undefined;
  const path = Array.isArray(dataIndex) ? dataIndex : [dataIndex];
  return path.reduce<unknown>((current, key) => {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object' && typeof current !== 'function') return undefined;
    return (current as Record<string, unknown>)[String(key)];
  }, record);
}

function readColumnText(value: unknown): string {
  if (Array.isArray(value)) return value.map(readColumnText).join(' ');
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (typeof value === 'symbol') return String(value.description ?? '');
  return '';
}

function mergeClassName(...values: unknown[]) {
  return values
    .flatMap((value) => String(value ?? '').split(/\s+/))
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index)
    .join(' ');
}
