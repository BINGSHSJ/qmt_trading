import { App, Button, Space, Typography } from 'antd';
import { writeTextToClipboard } from '../../utils/clipboard';
import './ErrorPanel.css';

interface ErrorPanelProps {
  message: string;
  code?: string;
  traceId?: string;
  suggestion?: string;
  technicalDetail?: string;
}

export default function ErrorPanel({
  message,
  code = 'UNKNOWN',
  traceId = '无',
  suggestion = '请稍后重试',
  technicalDetail = '暂无技术详情',
}: ErrorPanelProps) {
  const { message: messageApi } = App.useApp();
  const allText = `中文说明：${message}\n错误码：${code}\n修复建议：${suggestion}\n技术详情：${technicalDetail}\n追踪ID：${traceId}`;

  const copyText = async (text: string) => {
    try {
      await writeTextToClipboard(text);
      messageApi.success('已复制');
    } catch {
      messageApi.error('复制失败，请手动选择文本复制。');
    }
  };

  return (
    <Space direction="vertical" size={12} className="error-panel">
      <div className="error-panel__headline">
        <span className="error-panel__rail" aria-hidden="true" />
        <div>
          <Typography.Text type="secondary" className="error-panel__eyebrow">错误说明</Typography.Text>
          <Typography.Text strong className="error-panel__message">
            {message}
          </Typography.Text>
        </div>
      </div>
      <div className="error-panel__meta">
        <Typography.Text type="secondary">错误码：{code}</Typography.Text>
        <Typography.Text type="secondary">追踪ID：{traceId}</Typography.Text>
      </div>
      <Typography.Text className="error-panel__suggestion">下一步建议：{suggestion}</Typography.Text>
      <Typography.Text type="secondary" className="error-panel__technical-title">技术详情</Typography.Text>
      <Typography.Paragraph code className="error-panel__technical">
        {technicalDetail}
      </Typography.Paragraph>
      <Space wrap className="error-panel__actions">
        <Button title="复制中文说明" onClick={() => copyText(message)}>复制中文说明</Button>
        <Button title="复制技术详情" onClick={() => copyText(technicalDetail)}>复制技术详情</Button>
        <Button title="复制完整错误详情给 AI" type="primary" onClick={() => copyText(allText)}>
          复制给 AI
        </Button>
      </Space>
    </Space>
  );
}
