import { Descriptions, Modal, Space, Tag, Typography } from 'antd';
import RiskConfirmContent from '../RiskConfirmContent';
import { formatMoney, formatPrice, formatQuantity, formatSide, getSideColor } from '../../utils/format';
import './OrderConfirmModal.css';

export interface OrderConfirmData {
  title: string;
  strategyName?: string | null;
  tradingMode?: string;
  source?: string;
  symbol: string;
  name: string;
  side: string;
  price: number;
  quantity: number;
  reason?: string | null;
}

interface OrderConfirmModalProps {
  open: boolean;
  loading?: boolean;
  data?: OrderConfirmData | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function OrderConfirmModal({ open, loading = false, data, onCancel, onConfirm }: OrderConfirmModalProps) {
  const amount = data ? data.price * data.quantity : 0;
  const tradingMode = data?.tradingMode ?? '交易模式未检测';
  const tradingModeUnknown = !data?.tradingMode || tradingMode.includes('未检测');
  const tradingModeRisk = tradingMode.includes('真实')
    ? '当前为真实 QMT 只读验收模式，页面会保留人工确认语义；真实下单能力未开启时后端会阻断提交。'
    : tradingMode.includes('测试隔离')
      ? '当前为测试隔离交易模式，不会提交真实委托；实盘接入前仍应按真实交易标准核对。'
      : '当前交易模式未检测，确认按钮已锁定。请先刷新页面或到系统管理执行环境检测，再重新进入下单确认。';
  const orderSource = data?.source ?? (data?.strategyName ? '策略信号人工确认' : '手动下单');

  return (
    <Modal
      className="order-confirm-modal"
      open={open}
      title={data?.title ?? '确认下单'}
      okText="确认下单"
      cancelText="取消"
      width={720}
      centered
      maskClosable={false}
      confirmLoading={loading}
      okButtonProps={{ danger: data?.side === 'SELL', disabled: tradingModeUnknown }}
      onOk={onConfirm}
      onCancel={onCancel}
      data-testid="modal-order-confirm"
    >
      {data ? (
        <Space direction="vertical" size={10} className="order-confirm-modal__stack">
          <RiskConfirmContent
            summary="请确认下单信息，人工确认后才会提交委托请求。"
            objectLabel={`${data.symbol} ${data.name}`}
            riskItems={[
              tradingModeRisk,
              '请核对股票代码、买卖方向、委托价格、委托数量和委托金额。',
              '确认后按钮会进入请求中状态，避免重复点击造成重复提交。',
            ]}
            details={[
              { label: '交易模式', value: tradingMode },
              { label: '委托金额', value: formatMoney(amount) },
              { label: '交易来源', value: orderSource },
            ]}
            nextStep="提交后请在委托记录中核对 local_order_id、qmt_order_id、订单状态和成交同步结果。"
          />
          <Descriptions bordered size="small" column={1} className="order-confirm-descriptions">
            <Descriptions.Item label="交易模式">{tradingMode}</Descriptions.Item>
            <Descriptions.Item label="来源">{orderSource}</Descriptions.Item>
            {data.strategyName ? <Descriptions.Item label="策略名称">{data.strategyName}</Descriptions.Item> : null}
            <Descriptions.Item label="股票代码">{data.symbol}</Descriptions.Item>
            <Descriptions.Item label="股票名称">{data.name}</Descriptions.Item>
            <Descriptions.Item label="买卖方向">
              <Tag color={getSideColor(data.side)}>{formatSide(data.side)}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="委托价格">{formatPrice(data.price)}</Descriptions.Item>
            <Descriptions.Item label="委托数量">{formatQuantity(data.quantity)}</Descriptions.Item>
            <Descriptions.Item label="委托金额">
              <Typography.Text strong>{formatMoney(amount)}</Typography.Text>
            </Descriptions.Item>
            {data.reason ? <Descriptions.Item label="信号原因">{data.reason}</Descriptions.Item> : null}
          </Descriptions>
        </Space>
      ) : null}
    </Modal>
  );
}
