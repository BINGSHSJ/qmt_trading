import { ClockCircleOutlined } from '@ant-design/icons';
import { Tag } from 'antd';
import './DataFreshnessTag.css';

interface DataFreshnessTagProps {
  label?: string;
  updatedAt?: string | null;
  loading?: boolean;
}

export default function DataFreshnessTag({ label = '更新', updatedAt, loading = false }: DataFreshnessTagProps) {
  const text = loading ? '刷新中' : updatedAt || '暂无时间';
  const className = updatedAt ? 'data-freshness-tag data-freshness-tag--fresh' : 'data-freshness-tag';
  const displayText = `${label}：${text}`;

  return (
    <Tag className={className} icon={<ClockCircleOutlined />} title={displayText}>
      <span className="data-freshness-tag__text">{displayText}</span>
    </Tag>
  );
}
