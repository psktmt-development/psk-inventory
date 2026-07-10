import { useMemo } from 'react';
import { Card, Table, Typography } from 'antd';
import { useFetch } from '../../hooks';
import { PageTitle, Loading } from '../../components/Page';

interface Size { size_mm: number | null; sold_qty: number; under_loading_qty: number; }
interface Factory { factory_id: number; factory_name: string; booked_qty: number; sold_qty: number; under_loading_qty: number; balance_qty: number; sizes: Size[]; }
interface OpeningStock { factories: Factory[]; totals: { booked_qty: number; sold_qty: number; under_loading_qty: number; balance_qty: number }; }

// Plain number formatting to match the spreadsheet (2 decimals, no unit noise)
const num = (n: number) => (n ? Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0');

export default function StockSummary() {
  const { data, loading, error } = useFetch<OpeningStock>('/dashboards/opening-stock');

  const rows = useMemo(() => data?.factories ?? [], [data]);

  const cell = (v: number, opts: { bold?: boolean; color?: string } = {}) => (
    <span style={{ fontWeight: opts.bold ? 600 : 400, color: v ? opts.color : '#bbb' }}>{num(v)}</span>
  );

  // Nested table: size-wise breakup of what has been SOLD for one factory.
  // (Stock/booking is sizeless now, so only the sold side has a size breakdown.)
  const sizeBreakup = (f: Factory) => (
    <Table<Size>
      rowKey={(s) => String(s.size_mm ?? 'na')}
      dataSource={f.sizes}
      pagination={false}
      size="small"
      style={{ margin: '0 8px' }}
      locale={{ emptyText: 'No sales for this factory yet' }}
      columns={[
        { title: 'Size', dataIndex: 'size_mm', render: (v) => <span>{v ? `${v} mm` : '—'}</span> },
        { title: 'Order (sold)', dataIndex: 'sold_qty', align: 'right', width: 200, render: (v) => cell(v, { color: '#2563eb' }) },
        { title: 'Under Loading', dataIndex: 'under_loading_qty', align: 'right', width: 200, render: (v) => cell(v, { color: '#f59e0b' }) },
      ]}
    />
  );

  return (
    <>
      <PageTitle title="Stock Summary" subtitle="Booking · Order · Under Loading · Balance — per factory (click a factory for the size-wise sold breakup)" />
      <Loading loading={loading} error={error}>
        <Card styles={{ body: { padding: 0 } }}>
          <Table<Factory>
            rowKey="factory_id"
            dataSource={rows}
            pagination={false}
            size="middle"
            expandable={{
              expandRowByClick: true,
              rowExpandable: (f) => f.sizes.length > 0,
              expandedRowRender: sizeBreakup,
            }}
            columns={[
              { title: 'Factory Name', dataIndex: 'factory_name', render: (v) => <b>{v}</b> },
              { title: 'Booking', dataIndex: 'booked_qty', align: 'right', width: 170, render: (v) => cell(v, { bold: true }) },
              { title: 'Order', dataIndex: 'sold_qty', align: 'right', width: 160, render: (v) => cell(v, { color: '#2563eb', bold: true }) },
              { title: 'Under Loading', dataIndex: 'under_loading_qty', align: 'right', width: 160, render: (v) => cell(v, { color: '#f59e0b', bold: true }) },
              { title: 'Balance', dataIndex: 'balance_qty', align: 'right', width: 150, render: (v) => cell(v, { color: '#16a34a', bold: true }) },
            ]}
            summary={() => data && (
              <Table.Summary fixed>
                <Table.Summary.Row style={{ background: '#fafafa', fontWeight: 700 }}>
                  <Table.Summary.Cell index={0}><b>TOTAL</b></Table.Summary.Cell>
                  <Table.Summary.Cell index={1} align="right"><b>{num(data.totals.booked_qty)}</b></Table.Summary.Cell>
                  <Table.Summary.Cell index={2} align="right"><b>{num(data.totals.sold_qty)}</b></Table.Summary.Cell>
                  <Table.Summary.Cell index={3} align="right"><b>{num(data.totals.under_loading_qty)}</b></Table.Summary.Cell>
                  <Table.Summary.Cell index={4} align="right"><b>{num(data.totals.balance_qty)}</b></Table.Summary.Cell>
                </Table.Summary.Row>
              </Table.Summary>
            )}
          />
          <div style={{ padding: '8px 16px' }}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Booking = total MT booked · Order = actual sales · Under Loading = dispatched by factory, in transit · Balance = stock remaining (all quantities in MT). Click a factory row to see the size-wise breakup.
            </Typography.Text>
          </div>
        </Card>
      </Loading>
    </>
  );
}
