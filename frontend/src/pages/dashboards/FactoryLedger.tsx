import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, Select, Space, Table } from 'antd';
import dayjs from 'dayjs';
import { useFetch } from '../../hooks';
import { PageTitle, Loading } from '../../components/Page';

interface Purchase { booking_item_id: number; date: string; booking_qty: number; pur_rate: number; }
interface Sale { sale_date: string; customer_name: string; sale_rate: number; sale_invoice_no: string | null; purchase_invoice_no: string | null; sale_qty: number; }
interface Sauda { factory: { factory_id: number; name: string } | null; purchases: Purchase[]; sales: Sale[]; totals: { booking_qty: number; sale_qty: number; balance: number }; }

const d = (s?: string | null) => (s ? dayjs(s).format('DD-MMM') : '');
const q = (n?: number | null) => (n == null ? '' : Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const r = (n?: number | null) => (n == null || n === 0 ? '' : Number(n).toLocaleString('en-IN'));

interface Row { key: string; purchase?: Purchase; sale?: Sale; balance: number; }

export default function FactoryLedger() {
  const factories = useFetch<any[]>('/masters/factories');
  const [sp] = useSearchParams();
  const [factory, setFactory] = useState<number | undefined>(() => (sp.get('factory') ? Number(sp.get('factory')) : undefined));

  // Follow the URL: arriving from Executive Summary (?factory=id) selects that factory.
  useEffect(() => {
    const f = sp.get('factory');
    if (f) setFactory(Number(f));
  }, [sp]);

  const url = factory ? `/dashboards/sauda-ledger?factory_id=${factory}` : null;
  const { data, loading, error } = useFetch<Sauda>(url, [factory]);

  // Lay out purchases (left) against sales (right): a purchase lot appears on the
  // sale row where FIFO consumption first reaches it; running balance = purchased − sold so far.
  const rows = useMemo<Row[]>(() => {
    if (!data) return [];
    const { purchases, sales } = data;
    // threshold[j] = qty purchased before lot j starts
    const threshold: number[] = [];
    let cumP = 0;
    for (const p of purchases) { threshold.push(cumP); cumP += Number(p.booking_qty); }

    const out: Row[] = [];
    let ci = 0;            // next purchase to place
    let placedPurchased = 0; // cumulative purchased qty placed so far
    let cumSoldBefore = 0;

    for (const sale of sales) {
      const cumSoldAfter = cumSoldBefore + Number(sale.sale_qty);
      let leftForRow: Purchase | undefined;
      while (ci < purchases.length && threshold[ci] < cumSoldAfter) {
        if (!leftForRow) { leftForRow = purchases[ci]; }
        else { placedPurchased += Number(purchases[ci].booking_qty); out.push({ key: `r${out.length}`, purchase: purchases[ci], balance: placedPurchased - cumSoldBefore }); }
        ci++;
      }
      if (leftForRow) placedPurchased += Number(leftForRow.booking_qty);
      out.push({ key: `r${out.length}`, purchase: leftForRow, sale, balance: placedPurchased - cumSoldAfter });
      cumSoldBefore = cumSoldAfter;
    }
    // any lots not yet consumed → purchase-only rows at the bottom
    while (ci < purchases.length) {
      placedPurchased += Number(purchases[ci].booking_qty);
      out.push({ key: `r${out.length}`, purchase: purchases[ci], balance: placedPurchased - cumSoldBefore });
      ci++;
    }
    return out;
  }, [data]);

  const cellStyle = { borderInlineEnd: '1px solid #f0f0f0' };

  return (
    <>
      <PageTitle title="Sauda — Factory Ledger" subtitle="Purchases (left) vs sales (right), date-wise, with running balance"
        extra={
          <Space>
            <Select showSearch optionFilterProp="label" placeholder="Select factory" style={{ width: 220 }} value={factory} onChange={setFactory}
              options={(factories.data ?? []).map((f) => ({ value: f.factory_id, label: f.name }))} />
          </Space>
        } />
      <Loading loading={loading} error={error}>
        {!factory ? (
          <Card><span style={{ color: '#888' }}>Select a factory to view its Sauda ledger.</span></Card>
        ) : (
          <Card styles={{ body: { padding: 0 } }}>
            <Table<Row>
              rowKey="key" dataSource={rows} pagination={false} size="small" bordered scroll={{ x: 1200 }}
              columns={[
                { title: 'Factory Name', dataIndex: 'fac', width: 130, onCell: () => ({ style: cellStyle }), render: (_: any, __: any, i: number) => (i === 0 ? <b>{data?.factory?.name}</b> : '') },
                { title: 'Date', dataIndex: 'pdate', width: 80, align: 'center', render: (_, row) => d(row.purchase?.date) },
                { title: 'Booking Qty', dataIndex: 'bqty', width: 100, align: 'right', render: (_, row) => q(row.purchase?.booking_qty) },
                { title: 'Pur. Rate', dataIndex: 'prate', width: 90, align: 'right', render: (_, row) => r(row.purchase?.pur_rate) },
                { title: 'Purchase Invoice No', dataIndex: 'pinv', width: 140, onCell: () => ({ style: cellStyle }), render: (_, row) => row.sale?.purchase_invoice_no ?? '' },
                { title: 'Sale Date', dataIndex: 'sdate', width: 80, align: 'center', render: (_, row) => d(row.sale?.sale_date) },
                { title: 'Customer Name', dataIndex: 'cust', render: (_, row) => row.sale?.customer_name ?? '' },
                { title: 'Sale Rate', dataIndex: 'srate', width: 90, align: 'right', render: (_, row) => r(row.sale?.sale_rate) },
                { title: 'Sale Invoice No', dataIndex: 'sinv', width: 110, align: 'center', render: (_, row) => row.sale?.sale_invoice_no ?? '' },
                { title: 'Sale Qty', dataIndex: 'sqty', width: 90, align: 'right', render: (_, row) => q(row.sale?.sale_qty) },
                { title: 'Balance', dataIndex: 'balance', width: 100, align: 'right', render: (v) => <span style={{ color: v > 0 ? '#16a34a' : '#999' }}>{q(v)}</span> },
              ]}
              summary={() => data && (
                <Table.Summary fixed>
                  <Table.Summary.Row style={{ background: '#fafafa', fontWeight: 700 }}>
                    <Table.Summary.Cell index={0} align="right"><b>Total</b></Table.Summary.Cell>
                    <Table.Summary.Cell index={1} />
                    <Table.Summary.Cell index={2} align="right"><b>{q(data.totals.booking_qty)}</b></Table.Summary.Cell>
                    <Table.Summary.Cell index={3} /><Table.Summary.Cell index={4} /><Table.Summary.Cell index={5} />
                    <Table.Summary.Cell index={6} /><Table.Summary.Cell index={7} /><Table.Summary.Cell index={8} />
                    <Table.Summary.Cell index={9} align="right"><b>{q(data.totals.sale_qty)}</b></Table.Summary.Cell>
                    <Table.Summary.Cell index={10} align="right"><b>{q(data.totals.balance)}</b></Table.Summary.Cell>
                  </Table.Summary.Row>
                </Table.Summary>
              )}
            />
          </Card>
        )}
      </Loading>
    </>
  );
}
