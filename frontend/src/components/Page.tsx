import { Typography, Spin, Alert } from 'antd';
import type { ReactNode } from 'react';

export function PageTitle({ title, subtitle, extra }: { title: string; subtitle?: string; extra?: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
      <div>
        <Typography.Title level={3} style={{ margin: 0 }}>{title}</Typography.Title>
        {subtitle && <Typography.Text type="secondary">{subtitle}</Typography.Text>}
      </div>
      {extra}
    </div>
  );
}

export function Loading({ loading, error, children }: { loading: boolean; error?: string; children: ReactNode }) {
  if (error) return <Alert type="error" message={error} showIcon />;
  if (loading) return <div style={{ textAlign: 'center', padding: 60 }}><Spin size="large" /></div>;
  return <>{children}</>;
}
