import { Link } from 'react-router-dom';
import { Card, Col, Row, Statistic, Table } from 'antd';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useFetch } from '../../hooks';
import { PageTitle, Loading } from '../../components/Page';
import { inr, inrShort, compactINR, mt, PALETTE } from '../../api';

interface Exec {
  pipeline: { factory_id: number; factory_name: string; available_qty: number; under_loading_qty: number; balance_qty: number; pipeline_value: number }[];
  totals: { receivables: number; payables: number; pipeline_value: number; total_sales: number };
}

export default function Executive() {
  const { data, loading, error } = useFetch<Exec>('/dashboards/executive');
  return (
    <>
      <PageTitle title="Executive Summary" subtitle="Pipeline stock, receivables and payables at a glance" />
      <Loading loading={loading} error={error}>
        {data && (
          <>
            <Row gutter={[16, 16]}>
              <Col xs={12} md={6}><Card><Statistic title="Pipeline Stock Value" value={data.totals.pipeline_value} formatter={(v) => inrShort(v as number)} valueStyle={{ color: '#2563eb' }} /></Card></Col>
              <Col xs={12} md={6}><Card><Statistic title="Total Sales" value={data.totals.total_sales} formatter={(v) => inrShort(v as number)} valueStyle={{ color: '#16a34a' }} /></Card></Col>
              <Col xs={12} md={6}><Card><Statistic title="Receivables (from dealers)" value={data.totals.receivables} formatter={(v) => inrShort(v as number)} valueStyle={{ color: '#f59e0b' }} /></Card></Col>
              <Col xs={12} md={6}><Card><Statistic title="Payables (to factories)" value={data.totals.payables} formatter={(v) => inrShort(v as number)} valueStyle={{ color: '#dc2626' }} /></Card></Col>
            </Row>

            <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
              <Col xs={24} lg={14}>
                <Card title="Pipeline stock value by factory (Available + Under-Loading)">
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={data.pipeline} margin={{ left: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="factory_name" />
                      <YAxis tickFormatter={compactINR} />
                      <Tooltip formatter={(v: number) => inr(v)} />
                      <Bar dataKey="pipeline_value" name="Pipeline value" radius={[4, 4, 0, 0]}>
                        {data.pipeline.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </Card>
              </Col>
              <Col xs={24} lg={10}>
                <Card title="Receivables vs Payables">
                  <ResponsiveContainer width="100%" height={300}>
                    <PieChart>
                      <Pie data={[{ name: 'Receivables', value: data.totals.receivables }, { name: 'Payables', value: data.totals.payables }]}
                        dataKey="value" nameKey="name" innerRadius={60} outerRadius={100} label>
                        <Cell fill="#f59e0b" /><Cell fill="#dc2626" />
                      </Pie>
                      <Tooltip formatter={(v: number) => inr(v)} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </Card>
              </Col>
            </Row>

            <Card title="Pipeline by factory" style={{ marginTop: 16 }}>
              <Table rowKey="factory_id" pagination={false} dataSource={data.pipeline} size="middle"
                columns={[
                  { title: 'Factory', dataIndex: 'factory_name', render: (v, r) => <Link to={`/ledger?factory=${r.factory_id}`}>{v}</Link> },
                  { title: 'Available', dataIndex: 'available_qty', align: 'right', render: mt },
                  { title: 'Under-Loading', dataIndex: 'under_loading_qty', align: 'right', render: mt },
                  { title: 'Balance Qty', dataIndex: 'balance_qty', align: 'right', render: (v) => <b style={{ color: v > 0 ? '#16a34a' : '#999' }}>{mt(v)}</b> },
                ]} />
            </Card>
          </>
        )}
      </Loading>
    </>
  );
}
