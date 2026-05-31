import { App, Button, Descriptions, Drawer, Space, Tag, Typography } from 'antd';
import type { CSSProperties, ReactNode } from 'react';
import { writeTextToClipboard } from '../../utils/clipboard';
import './DetailDrawer.css';

type DetailFieldTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';
type DetailFieldGroup = 'identity' | 'status' | 'money' | 'time' | 'diagnostic' | 'neutral';

export interface DetailDrawerField {
  label: string;
  value?: ReactNode;
  copyValue?: string | number | boolean | null;
  span?: number;
  tone?: DetailFieldTone;
  group?: DetailFieldGroup;
  priority?: boolean;
}

interface DetailDrawerProps {
  open: boolean;
  title: string;
  subtitle?: ReactNode;
  status?: ReactNode;
  statusTone?: string;
  message?: ReactNode;
  messageCopyText?: string;
  technicalDetail?: ReactNode;
  technicalCopyText?: string;
  fields?: DetailDrawerField[];
  width?: number;
  fieldColumns?: number;
  className?: string;
  onClose: () => void;
}

function stringifyDetail(value: ReactNode) {
  if (value === null || value === undefined || value === '') return '暂无';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function stringifyField(field: DetailDrawerField) {
  if (field.copyValue !== undefined) return stringifyDetail(field.copyValue);
  return stringifyDetail(field.value);
}

function hasCustomNode(value: ReactNode) {
  return value !== null
    && value !== undefined
    && value !== ''
    && typeof value !== 'string'
    && typeof value !== 'number'
    && typeof value !== 'boolean';
}

function inferStatusTone(status: ReactNode) {
  const text = stringifyDetail(status).toLowerCase();
  if (['failed', 'error', '失败', '废单'].some((keyword) => text.includes(keyword))) return 'red';
  if (['warning', 'warn', '警告', '部分'].some((keyword) => text.includes(keyword))) return 'orange';
  if (['success', 'done', 'filled', '成功', '正常', '全部成交'].some((keyword) => text.includes(keyword))) return 'green';
  if (['running', 'pending', 'submitted', '运行', '待', '已提交', '已报'].some((keyword) => text.includes(keyword))) return 'blue';
  if (['cancel', '已撤', '取消'].some((keyword) => text.includes(keyword))) return 'default';
  return 'blue';
}

function inferFieldGroup(field: DetailDrawerField): DetailFieldGroup {
  if (field.group) return field.group;
  const label = field.label;
  if (/订单号|任务|回测|账户|策略|信号|股票|代码|表名|字段|ID|id/i.test(label)) return 'identity';
  if (/状态|方向|来源|模式|级别|结果|是否|可用|启用/.test(label)) return 'status';
  if (/金额|资产|资金|市值|盈亏|价格|数量|成交|费用|税|覆盖率|进度|行数|总数|成功|失败|缺失|重复/.test(label)) return 'money';
  if (/时间|日期|开始|结束|更新|创建|完成/.test(label)) return 'time';
  if (/原因|说明|建议|详情|日志|备注|口径|规则|验收|下一步|技术/.test(label)) return 'diagnostic';
  return 'neutral';
}

function isZeroLike(value: string) {
  return /^0(?:\.0+)?(?:\s|$|条|只|笔|元|%|失败|异常|缺失|重复)/.test(value.trim());
}

function inferFieldTone(field: DetailDrawerField): DetailFieldTone {
  if (field.tone) return field.tone;
  const value = stringifyField(field);
  const text = `${field.label} ${value}`.toLowerCase();
  if (/(失败|异常|错误|废单|error|failed|danger)/.test(text) && !isZeroLike(value)) return 'danger';
  if (/(警告|待核对|需核对|partial|warning|warn|过期|缺失)/.test(text) && !isZeroLike(value)) return 'warning';
  if (/(成功|通过|正常|complete|success|filled|已连接|已启用|可用|100%)/.test(text)) return 'success';
  if (/(运行|待|处理中|running|pending|submitted|已报|已提交)/.test(text)) return 'info';
  return 'neutral';
}

function getSummaryFields(fields: DetailDrawerField[]) {
  const keyFieldPattern = /订单号|任务ID|task|回测ID|账户|股票|状态|方向|成交时间|更新时间|覆盖率|数据类型|表名|字段名|日志ID|local_order_id|qmt_order_id/i;
  const picked: DetailDrawerField[] = [];
  const seen = new Set<string>();
  const push = (field: DetailDrawerField) => {
    const key = `${field.label}-${stringifyField(field)}`;
    if (seen.has(key)) return;
    picked.push(field);
    seen.add(key);
  };

  fields.filter((field) => field.priority).forEach(push);
  fields.filter((field) => keyFieldPattern.test(field.label)).forEach(push);
  fields.forEach(push);
  return picked.slice(0, 4);
}

export default function DetailDrawer({
  open,
  title,
  subtitle,
  status,
  statusTone,
  message,
  messageCopyText,
  technicalDetail,
  technicalCopyText,
  fields = [],
  width = 720,
  fieldColumns = 1,
  className,
  onClose,
}: DetailDrawerProps) {
  const { message: messageApi } = App.useApp();
  const drawerStyle = { '--detail-drawer-width': `${width}px` } as CSSProperties;
  const drawerClassName = [
    'detail-drawer',
    `detail-drawer--columns-${fieldColumns}`,
    className,
  ].filter(Boolean).join(' ');
  const messageIsCustomNode = hasCustomNode(message);
  const technicalIsCustomNode = hasCustomNode(technicalDetail);
  const technicalText = (technicalCopyText ?? stringifyDetail(technicalDetail)) || '暂无技术详情';
  const messageText = (messageCopyText ?? stringifyDetail(message)) || '暂无中文说明';
  const messageContent = messageIsCustomNode ? message : messageText;
  const technicalContent = technicalIsCustomNode ? technicalDetail : technicalText;
  const summaryFields = getSummaryFields(fields);
  const getFieldSpan = (field: DetailDrawerField) => {
    if (field.span) return Math.min(field.span, fieldColumns);
    const text = stringifyField(field);
    if (fieldColumns > 1 && (text.length > 28 || hasCustomNode(field.value))) return fieldColumns;
    return 1;
  };
  const allText = [
    `标题：${title}`,
    subtitle ? `摘要：${stringifyDetail(subtitle)}` : '',
    `中文说明：${messageText}`,
    `技术详情：${technicalText}`,
    ...fields.map((field) => `${field.label}：${stringifyField(field)}`),
  ].filter(Boolean).join('\n');

  const copyText = async (text: string) => {
    try {
      await writeTextToClipboard(text);
      messageApi.success('已复制');
    } catch {
      messageApi.error('复制失败，请手动选择文本复制。');
    }
  };

  return (
    <Drawer
      className={drawerClassName}
      data-workbench-role="detail-inspector"
      data-testid="detail-drawer"
      rootStyle={drawerStyle}
      title={
        <Space direction="vertical" size={4} className="detail-drawer__title">
          <Space wrap className="detail-drawer__title-row">
            <Typography.Text strong className="detail-drawer__title-text">{title}</Typography.Text>
            {status ? <Tag color={statusTone ?? inferStatusTone(status)}>{status}</Tag> : null}
          </Space>
          {subtitle ? <Typography.Text type="secondary" className="detail-drawer__subtitle">{subtitle}</Typography.Text> : null}
        </Space>
      }
      width={width}
      open={open}
      onClose={onClose}
      extra={
        <Space wrap>
          <Button aria-label="复制中文说明" title="复制中文说明" onClick={() => copyText(messageText)}>复制中文说明</Button>
          <Button aria-label="复制给 AI" title="复制完整详情给 AI" type="primary" onClick={() => copyText(allText)}>复制给 AI</Button>
        </Space>
      }
    >
      <Space
        direction="vertical"
        size={8}
        className="detail-drawer__content"
        data-workbench-role="detail-inspector"
      >
        {summaryFields.length > 0 ? (
          <section
            className="detail-drawer__section detail-drawer__section--summary"
            data-detail-section="summary"
            data-testid="detail-drawer-summary-section"
          >
            <Typography.Text type="secondary">关键摘要</Typography.Text>
            <div className="detail-drawer__summary-grid">
              {summaryFields.map((field, index) => {
                const group = inferFieldGroup(field);
                const tone = inferFieldTone(field);
                return (
                  <div
                    key={`${field.label}-${index}`}
                    className={`detail-drawer__summary-card detail-drawer__summary-card--${group} detail-drawer__summary-card--tone-${tone}`}
                    data-detail-field-group={group}
                    data-detail-field-tone={tone}
                  >
                    <span className="detail-drawer__summary-label">{field.label}</span>
                    <span className="detail-drawer__summary-value">{field.value ?? '暂无'}</span>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        <section
          className="detail-drawer__section detail-drawer__section--message"
          data-detail-section="message"
          data-testid="detail-drawer-message-section"
        >
          <Typography.Text type="secondary">中文说明</Typography.Text>
          <div className="detail-drawer__message">{messageContent}</div>
        </section>

        {fields.length > 0 ? (
          <section
            className="detail-drawer__section detail-drawer__section--fields"
            data-detail-section="fields"
            data-testid="detail-drawer-fields-section"
          >
            <Typography.Text type="secondary">核对字段</Typography.Text>
            <Descriptions bordered size="small" column={fieldColumns} className="detail-drawer__descriptions">
              {fields.map((field, index) => {
                const group = inferFieldGroup(field);
                const tone = inferFieldTone(field);
                return (
                  <Descriptions.Item
                    key={`${field.label}-${index}`}
                    label={field.label}
                    span={getFieldSpan(field)}
                    className={`detail-drawer__description-item detail-drawer__description-item--${group} detail-drawer__description-item--tone-${tone}`}
                  >
                    <span
                      className="detail-drawer__field-value"
                      data-detail-field-group={group}
                      data-detail-field-tone={tone}
                    >
                      {field.value ?? '暂无'}
                    </span>
                  </Descriptions.Item>
                );
              })}
            </Descriptions>
          </section>
        ) : null}

        <section
          className="detail-drawer__section detail-drawer__section--technical"
          data-detail-section="technical"
          data-testid="detail-drawer-technical-section"
        >
          <Space className="detail-drawer__section-head">
            <Typography.Text type="secondary">技术详情</Typography.Text>
            <Button aria-label="复制技术详情" title="复制技术详情" size="small" onClick={() => copyText(technicalText)}>复制技术详情</Button>
          </Space>
          {technicalIsCustomNode ? (
            <div className="detail-drawer__technical detail-drawer__technical--node">
              {technicalContent}
            </div>
          ) : (
            <Typography.Paragraph code className="detail-drawer__technical">
              {technicalContent}
            </Typography.Paragraph>
          )}
        </section>
      </Space>
    </Drawer>
  );
}
