import { useState } from 'react';
import { App, Button, Tag, Typography } from 'antd';
import type { TablePaginationConfig } from 'antd/es/table';
import type { ColumnsType } from 'antd/es/table';
import DataTable from '../DataTable';
import LogDrawer from '../LogDrawer';
import type { StrategySignalRecord } from '../../types/strategyDev';
import { formatMoneyByUnit, formatPrice, formatSide, formatStatusLabel, formatStockLabel, getSideColor, getStatusColor } from '../../utils/format';
import { TABLE_COL } from '../../utils/tableColumns';
import TableActionGroup from '../TableActionGroup';
import { writeTextToClipboard } from '../../utils/clipboard';
import './SignalTable.css';

interface SignalTableProps {
  rows: StrategySignalRecord[];
  loading: boolean;
  pagination?: TablePaginationConfig;
  onPageChange?(page: number, pageSize: number): void;
  onIgnore(signalId: number): void;
}

function renderSignalAuditText(value?: string | null) {
  const text = value || '暂无';
  return (
    <Typography.Text className="signal-audit-cell-text" title={text}>
      {text}
    </Typography.Text>
  );
}

export default function SignalTable({ rows, loading, pagination, onPageChange, onIgnore }: SignalTableProps) {
  const { message } = App.useApp();
  const [selectedSignal, setSelectedSignal] = useState<StrategySignalRecord | null>(null);
  const selectedSignalTechnicalDetail = selectedSignal ? JSON.stringify(
    {
      qa_type: 'strategy_signal_detail',
      ai_copy_version: '1.0',
      module: '策略开发',
      constraints: {
        signal_only: true,
        direct_order_forbidden: true,
        qmt_direct_call_forbidden: true,
        trade_execution_requires_manual_confirm: true,
      },
      signal: {
        id: selectedSignal.id,
        strategy_id: selectedSignal.strategy_id,
        strategy_name: selectedSignal.strategy_name,
        run_id: selectedSignal.run_id,
        symbol: selectedSignal.symbol,
        name: selectedSignal.name,
        action_raw: selectedSignal.action,
        action_text: formatSide(selectedSignal.action),
        price: selectedSignal.price,
        amount: selectedSignal.amount,
        reason: selectedSignal.reason,
        status_raw: selectedSignal.status,
        status_text: formatStatusLabel(selectedSignal.status),
        signal_time: selectedSignal.signal_time,
        created_at: selectedSignal.created_at,
      },
      next_steps: ['如需下单，请进入交易执行中心查看信号并人工确认', '核对 signal_time 是否在策略运行区间和数据覆盖范围内'],
      raw: selectedSignal,
    },
    null,
    2,
  ) : null;
  const copyReason = async (reason?: string | null) => {
    try {
      await writeTextToClipboard(reason || '暂无触发原因');
      message.success('触发原因已复制');
    } catch {
      message.error('复制失败，请手动选择文本复制。');
    }
  };

  const columns: ColumnsType<StrategySignalRecord> = [
    { title: '信号时间', dataIndex: 'signal_time', width: TABLE_COL.time, fixed: 'left' },
    { title: '策略名称', dataIndex: 'strategy_name', width: TABLE_COL.strategyWide, responsive: ['xxl'], render: renderSignalAuditText },
    { title: '股票', width: TABLE_COL.stockWide, fixed: 'left', render: (_, record) => renderSignalAuditText(formatStockLabel(record.symbol, record.name)) },
    { title: '方向', dataIndex: 'action', width: TABLE_COL.side, render: (v: string) => <Tag color={getSideColor(v)}>{formatSide(v)}</Tag> },
    { title: '参考价', dataIndex: 'price', width: TABLE_COL.price, align: 'right', render: (value: number) => formatPrice(value) },
    { title: '建议金额', dataIndex: 'amount', width: TABLE_COL.amount, align: 'right', render: (value: number | null) => formatMoneyByUnit(value) },
    {
      title: '触发原因',
      dataIndex: 'reason',
      width: TABLE_COL.messageWide,
      render: (reason: string, record) => (
        <button className="signal-reason" type="button" title={reason || '查看完整触发原因'} onClick={() => setSelectedSignal(record)}>
          <span>{reason || '暂无触发原因'}</span>
        </button>
      ),
    },
    { title: '状态', dataIndex: 'status', width: TABLE_COL.status, render: (value: string) => <Tag color={getStatusColor(value)}>{formatStatusLabel(value)}</Tag> },
    {
      title: '操作',
      width: TABLE_COL.detailAction,
      fixed: 'right',
      render: (_, record) => (
        <TableActionGroup
          primary={<Button aria-label="查看信号触发原因详情" title="查看信号触发原因详情" size="small" onClick={() => setSelectedSignal(record)}>详情</Button>}
          actions={[
            { key: 'copy', label: '复制原因', onClick: () => { void copyReason(record.reason); } },
            { key: 'ignore', label: '忽略信号', disabled: record.status === '已忽略', onClick: () => onIgnore(record.id) },
          ]}
        />
      ),
    },
  ];

  return (
    <>
      <DataTable<StrategySignalRecord>
        rowKey="id"
        columns={columns}
        dataSource={rows}
        loading={loading}
        pagination={pagination ?? { pageSize: 20 }}
        onChange={(nextPagination) => onPageChange?.(nextPagination.current ?? 1, nextPagination.pageSize ?? 20)}
        data-testid="table-strategy-signals"
        className="strategy-signals-table data-table--strategy-signals"
        tableLayout="fixed"
        scroll={{ x: 'max-content' }}
        quickSearch={{ placeholder: '当前页搜索策略/股票/原因', fields: ['strategy_name', 'symbol', 'name', 'reason'], width: 260 }}
        quickFilters={[
          { label: '信号状态', options: [{ label: '未处理', value: '未处理' }, { label: '已下单', value: '已下单' }, { label: '已忽略', value: '已忽略' }], getValue: (record) => record.status },
          { label: '方向', options: [{ label: '买入', value: 'BUY' }, { label: '卖出', value: 'SELL' }], getValue: (record) => record.action },
        ]}
        emptyDescription="暂无策略信号。请先运行策略，或检查策略是否按接口返回信号。"
      />
      <LogDrawer
        open={Boolean(selectedSignal)}
        title="策略信号触发原因"
        subtitle={selectedSignal ? formatStockLabel(selectedSignal.symbol, selectedSignal.name) : undefined}
        status={selectedSignal ? formatStatusLabel(selectedSignal.status) : undefined}
        statusTone={selectedSignal ? getStatusColor(selectedSignal.status) : undefined}
        message={selectedSignal?.reason || '暂无触发原因'}
        technicalDetail={selectedSignalTechnicalDetail}
        width={720}
        fieldColumns={2}
        className="strategy-signal-detail-drawer"
        fields={selectedSignal ? [
          { label: '策略名称', value: selectedSignal.strategy_name },
          { label: '信号时间', value: selectedSignal.signal_time },
          { label: '方向', value: <Tag color={getSideColor(selectedSignal.action)}>{formatSide(selectedSignal.action)}</Tag>, copyValue: formatSide(selectedSignal.action) },
          { label: '状态', value: <Tag color={getStatusColor(selectedSignal.status)}>{formatStatusLabel(selectedSignal.status)}</Tag>, copyValue: formatStatusLabel(selectedSignal.status) },
          { label: '参考价', value: formatPrice(selectedSignal.price) },
          { label: '建议金额', value: formatMoneyByUnit(selectedSignal.amount) },
        ] : []}
        onClose={() => setSelectedSignal(null)}
      />
    </>
  );
}
