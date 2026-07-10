import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Form, Input, Typography, Alert } from 'antd';
import { DatabaseOutlined } from '@ant-design/icons';
import { useAuth } from '../auth';
import { apiError } from '../api';

export default function Login() {
  const { user, login } = useAuth();
  const nav = useNavigate();
  const [form] = Form.useForm();
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  if (user) nav('/', { replace: true });

  const submit = async (v: { email: string; password: string }) => {
    setErr(''); setLoading(true);
    try {
      await login(v.email, v.password);
      nav('/', { replace: true });
    } catch (e) {
      setErr(apiError(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'linear-gradient(135deg,#eff6ff,#f8fafc)' }}>
      <Card style={{ width: 400, boxShadow: '0 8px 30px rgba(0,0,0,.08)' }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <DatabaseOutlined style={{ fontSize: 40, color: '#2563eb' }} />
          <Typography.Title level={3} style={{ marginBottom: 0 }}>PSK TMT Monitor</Typography.Title>
          <Typography.Text type="secondary">Sign in to continue</Typography.Text>
        </div>
        {err && <Alert type="error" message={err} style={{ marginBottom: 16 }} showIcon />}
        <Form form={form} layout="vertical" onFinish={submit}>
          <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}>
            <Input placeholder="you@psk.com" size="large" />
          </Form.Item>
          <Form.Item name="password" label="Password" rules={[{ required: true }]}>
            <Input.Password size="large" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block size="large" loading={loading}>Log in</Button>
        </Form>
      </Card>
    </div>
  );
}
