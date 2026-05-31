import { HomeOutlined, SettingOutlined } from '@ant-design/icons';
import { Button, Space, Typography } from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';
import EmptyGuide from '../../components/EmptyGuide';
import SectionCard from '../../components/SectionCard';
import './NotFoundPage.css';

export default function NotFoundPage() {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <div className="module-page not-found-page">
      <SectionCard title="页面不存在" description="当前地址没有对应的控制台页面。">
        <EmptyGuide
          title="页面不存在"
          reason="无效路由"
          description="当前地址没有对应的控制台页面，请返回六大菜单中的有效入口。"
          action={(
            <Space wrap>
              <Button type="primary" icon={<HomeOutlined />} data-testid="not-found-go-dashboard" onClick={() => navigate('/dashboard')}>
                返回总览看板
              </Button>
              <Button icon={<SettingOutlined />} data-testid="not-found-go-system" onClick={() => navigate('/system')}>
                打开系统管理
              </Button>
            </Space>
          )}
        />
        <div className="not-found-page__detail">
          <Typography.Text type="secondary">无效路径：</Typography.Text>
          <Typography.Text code>{location.pathname}</Typography.Text>
        </div>
      </SectionCard>
    </div>
  );
}
