import { Alert, Descriptions, Typography } from 'antd';
import type { ReactNode } from 'react';
import './RiskConfirmContent.css';

interface RiskConfirmDetail {
  label: string;
  value?: ReactNode;
}

interface RiskConfirmContentProps {
  summary: ReactNode;
  riskItems: ReactNode[];
  details?: RiskConfirmDetail[];
  level?: 'warning' | 'error';
  objectLabel?: ReactNode;
  impactTitle?: ReactNode;
  nextStep?: ReactNode;
  children?: ReactNode;
}

export default function RiskConfirmContent({
  summary,
  riskItems,
  details = [],
  level = 'warning',
  objectLabel,
  impactTitle = '影响范围',
  nextStep,
  children,
}: RiskConfirmContentProps) {
  return (
    <div className="risk-confirm-content" data-testid="risk-confirm-content">
      <Alert type={level} showIcon message={summary} />
      {objectLabel ? (
        <div className="risk-confirm-content__object">
          <Typography.Text type="secondary">操作对象</Typography.Text>
          <Typography.Text strong>{objectLabel}</Typography.Text>
        </div>
      ) : null}
      <div className="risk-confirm-content__block">
        <Typography.Text strong>{impactTitle}</Typography.Text>
        <ul className="risk-confirm-content__list">
          {riskItems.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      </div>
      {details.length > 0 ? (
        <div className="risk-confirm-content__details-wrap">
          <Typography.Text strong>关键参数</Typography.Text>
          <Descriptions bordered size="small" column={1} className="risk-confirm-content__details">
            {details.map((detail) => (
              <Descriptions.Item key={detail.label} label={detail.label}>
                {detail.value ?? '暂无'}
              </Descriptions.Item>
            ))}
          </Descriptions>
        </div>
      ) : null}
      {nextStep ? (
        <div className="risk-confirm-content__next">
          <Typography.Text strong>下一步建议</Typography.Text>
          <Typography.Paragraph>{nextStep}</Typography.Paragraph>
        </div>
      ) : null}
      {children ? <div className="risk-confirm-content__extra">{children}</div> : null}
    </div>
  );
}
