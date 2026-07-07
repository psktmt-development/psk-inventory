import { Card, Col, Row, Table } from 'antd';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useFetch } from '../../hooks';
import { PageTitle, Loading } from '../../components/Page';
import { inr, compactINR, PALETTE, STATUS_COLORS } from '../../api';

interface Sales {
  byArea: { area: string; orders: number; amount: number }[];
  bySalesPerson: { sales_person: string; orders: number; amount: number }[];
  byPaymentType: { payment_type: string; orders: number; amount: number }[];
  funnel: { status: string; orders: number; amount: number }[];
  trend: { month: string; amount: number }[];
}

export default function SalesDashboard() {
  const { data, loading, error } = useFetch<Sales>('/dashboards/sales');
  return (
    <>
      <PageTitle title="Sales Dashboard" subtitle="By area, sales person, payment type and status" />
      <Loading loading={loading} error={error}>
        {data && (
          <>
            <Row gutter={[16, 16]}>
              <Col xs={24} lg={12}>
                <Card title="Sales by area">
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={data.byArea}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="area" /><YAxis tickFormatter={compactINR} />
                      <Tooltip formatter={(v: number) => inr(v)} />
                      <Bar dataKey="amount" name="Amount" radius={[4, 4, 0, 0]}>
                        {data.byArea.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </Card>
              </Col>
              <Col xs={24} lg={12}>
                <Card title="Direct vs Credit">
                  <ResponsiveContainer width="100%" height={280}>
                    <PieChart>
                      <Pie data={data.byPaymentType} dataKey="amount" nameKey="payment_type" innerRadius={55} outerRadius={95} label={(e) => e.payment_type}>
                        {data.byPaymentType.map((d, i) => <Cell key={i} fill={STATUS_COLORS[d.payment_type] ?? PALETTE[i]} />)}
                      </Pie>
                      <Tooltip formatter={(v: number) => inr(v)} /><Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </Card>
              </Col>
              <Col xs={24} lg={12}>
                <Card title="Monthly sales trend">
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart data={data.trend}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="month" /><YAxis tickFormatter={compactINR} />
                      <Tooltip formatter={(v: number) => inr(v)} />
                      <Line type="monotone" dataKey="amount" stroke="#16a34a" strokeWidth={2} dot />
                    </LineChart>
                  </ResponsiveContainer>
                </Card>
              </Col>
            </Row>
            <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
              <Col xs={24} lg={12}>
                <Card title="By sales person">
                  <Table rowKey="sales_person" pagination={false} size="small" dataSource={data.bySalesPerson}
                    columns={[{ title: 'Sales Person', dataIndex: 'sales_person' }, { title: 'Orders', dataIndex: 'orders', align: 'right' }, { title: 'Amount', dataIndex: 'amount', align: 'right', render: inr }]} />
                </Card>
              </Col>
              <Col xs={24} lg={12}>
                <Card title="Order status funnel">
                  <Table rowKey="status" pagination={false} size="small" dataSource={data.funnel}
                    columns={[{ title: 'Status', dataIndex: 'status' }, { title: 'Orders', dataIndex: 'orders', align: 'right' }, { title: 'Amount', dataIndex: 'amount', align: 'right', render: inr }]} />
                </Card>
              </Col>
            </Row>
          </>
        )}
      </Loading>
    </>
  );
}
