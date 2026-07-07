import { useMemo } from 'react';
import { Card, Table, Typography } from 'antd';
import { useFetch } from '../../hooks';
import { PageTitle, Loading } from '../../components/Page';

interface Factory { factory_id: number; factory_name: string; balance_booking: number; under_loading: number; balance: number; }
interface OpeningStock { factories: Factory[]; totals: { balance_booking: number; under_loading: number; balance: number }; }

// Plain number formatting to match the spreadsheet (2 decimals, no unit noise)
const num = (n: number) => (n ? Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0');

export default function StockSummary() {
  const { data, loading, error } = useFetch<OpeningStock>('/dashboards/opening-stock');

  const rows = useMemo(
    () => (data?.factories ?? []).map((f) => ({
      key: `f${f.factory_id}`,
      factory_name: f.factory_name,
      balance_booking: f.balance_booking,
      under_loading: f.under_loading,
      balance: f.balance,
    })),
    [data],
  );

  const cell = (v: number, opts: { bold?: boolean; color?: string } = {}) => (
    <span style={{ fontWeight: opts.bold ? 600 : 400, color: v ? opts.color : '#bbb' }}>{num(v)}</span>
  );

  return (
    <>
      <PageTitle title="Opening Stock" subtitle="Balance Booking · Under Loading · Balance — per factory" />
      <Loading loading={loading} error={error}>
        <Card styles={{ body: { padding: 0 } }}>
          <Table
            rowKey="key"
            dataSource={rows}
            pagination={false}
            size="middle"
            columns={[
              { title: 'Factory Name', dataIndex: 'factory_name', render: (v) => <b>{v}</b> },
              { title: 'Balance Booking', dataIndex: 'balance_booking', align: 'right', width: 170, render: (v) => cell(v, { bold: true }) },
              { title: 'Under Loading', dataIndex: 'under_loading', align: 'right', width: 160, render: (v) => cell(v, { color: '#f59e0b', bold: true }) },
              { title: 'Balance', dataIndex: 'balance', align: 'right', width: 150, render: (v) => cell(v, { color: '#16a34a', bold: true }) },
            ]}
            summary={() => data && (
              <Table.Summary fixed>
                <Table.Summary.Row style={{ background: '#fafafa', fontWeight: 700 }}>
                  <Table.Summary.Cell index={0}><b>TOTAL</b></Table.Summary.Cell>
                  <Table.Summary.Cell index={1} align="right"><b>{num(data.totals.balance_booking)}</b></Table.Summary.Cell>
                  <Table.Summary.Cell index={2} align="right"><b>{num(data.totals.under_loading)}</b></Table.Summary.Cell>
                  <Table.Summary.Cell index={3} align="right"><b>{num(data.totals.balance)}</b></Table.Summary.Cell>
                </Table.Summary.Row>
              </Table.Summary>
            )}
          />
          <div style={{ padding: '8px 16px' }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Balance Booking = booked/available stock at depot · Under Loading = dispatched by factory, in transit · Balance = total (all quantities in MT).
            </Typography.Text>
          </div>
        </Card>
      </Loading>
    </>
  );
}
