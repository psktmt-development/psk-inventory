import { useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Layout, Menu, Avatar, Dropdown, Typography, Tag } from 'antd';
import {
  DashboardOutlined, DatabaseOutlined, FileTextOutlined, ShoppingCartOutlined,
  TruckOutlined, DollarOutlined, BankOutlined, LogoutOutlined, GoldOutlined,
  TeamOutlined, LineChartOutlined, InboxOutlined, UserOutlined,
} from '@ant-design/icons';
import { useAuth, type Role } from '../auth';
import logo from '../assets/logo.png';

const { Sider, Header, Content } = Layout;

interface Item { key: string; label: string; icon: JSX.Element; roles?: Role[]; }

const DASH: Item[] = [
  { key: '/', label: 'Executive Summary', icon: <DashboardOutlined /> },
  { key: '/stock', label: 'Stock Summary', icon: <InboxOutlined /> },
  { key: '/ledger', label: 'Factory Ledger', icon: <FileTextOutlined /> },
  { key: '/sales-dashboard', label: 'Sales', icon: <LineChartOutlined /> },
  { key: '/dispatch-tracking', label: 'Dispatch', icon: <TruckOutlined /> },
  { key: '/payments-dashboard', label: 'Payments', icon: <DollarOutlined /> },
];

const ENTRY: Item[] = [
  { key: '/bookings', label: 'Booking Entry', icon: <GoldOutlined />, roles: ['Warehouse', 'Accounts'] },
  { key: '/sales', label: 'Sale Entry', icon: <ShoppingCartOutlined />, roles: ['Sales', 'Accounts'] },
  { key: '/supplier-payments', label: 'Supplier Payment', icon: <BankOutlined />, roles: ['Accounts'] },
  { key: '/dealer-payments', label: 'Dealer Payment', icon: <DollarOutlined />, roles: ['Accounts'] },
];

const MASTERS: Item[] = [
  { key: '/masters/factories', label: 'Factories', icon: <BankOutlined />, roles: ['Admin'] },
  { key: '/masters/sales-people', label: 'Sales People', icon: <TeamOutlined />, roles: ['Admin'] },
  { key: '/masters/dealers', label: 'Dealers', icon: <TeamOutlined />, roles: ['Admin'] },
  { key: '/masters/users', label: 'Users', icon: <UserOutlined />, roles: ['Admin'] },
];

export default function AppLayout() {
  const { user, logout, can } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  const visible = (items: Item[]) => items.filter((i) => !i.roles || can(...i.roles));
  const toMenu = (items: Item[]) =>
    visible(items).map((i) => ({ key: i.key, icon: i.icon, label: <Link to={i.key}>{i.label}</Link> }));

  const items = [
    { type: 'group' as const, label: 'Dashboards', children: toMenu(DASH) },
    ...(visible(ENTRY).length ? [{ type: 'group' as const, label: 'Data Entry', children: toMenu(ENTRY) }] : []),
    ...(visible(MASTERS).length ? [{ type: 'group' as const, label: 'Master Data', children: toMenu(MASTERS) }] : []),
  ];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider collapsible collapsed={collapsed} onCollapse={setCollapsed} theme="light" width={230}
        style={{ borderRight: '1px solid #f0f0f0', overflow: 'auto', height: '100vh', position: 'sticky', top: 0 }}>
        <div style={{ padding: collapsed ? 12 : 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {collapsed
            ? <DatabaseOutlined style={{ fontSize: 22, color: '#2563eb' }} />
            : <img src={logo} alt="PSK TMT" style={{ maxWidth: '100%', maxHeight: 72, objectFit: 'contain' }} />}
        </div>
        <Menu mode="inline" selectedKeys={[loc.pathname]} items={items} style={{ borderInlineEnd: 0 }} />
      </Sider>
      <Layout>
        <Header style={{ background: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 24px', borderBottom: '1px solid #f0f0f0' }}>
          <Typography.Text type="secondary">TMT Bar Trading — Monitoring Dashboard</Typography.Text>
          <Dropdown
            menu={{ items: [{ key: 'out', icon: <LogoutOutlined />, label: 'Log out', onClick: () => { logout(); nav('/login'); } }] }}>
            <div style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ textAlign: 'right', lineHeight: 1.2 }}>
                <div style={{ fontWeight: 600 }}>{user?.name}</div>
                <Tag color="blue" style={{ margin: 0 }}>{user?.role}</Tag>
              </div>
              <Avatar style={{ background: '#2563eb' }}>{user?.name?.[0]}</Avatar>
            </div>
          </Dropdown>
        </Header>
        <Content style={{ margin: 24 }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
