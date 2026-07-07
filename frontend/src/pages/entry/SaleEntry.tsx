import { useMemo, useState } from 'react';
import { Alert, App, Button, Card, DatePicker, Descriptions, Divider, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Tag, Typography } from 'antd';
import { PlusOutlined, DeleteOutlined, TruckOutlined, CheckOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api, apiError, inr, mt, STATUS_COLORS } from '../../api';
import { useFetch } from '../../hooks';
import { PageTitle, Loading } from '../../components/Page';
import { useAuth } from '../../auth';

export default function SaleEntry() {
  const { message } = App.useApp();
  const { can } = useAuth();
  const canWrite = can('Sales', 'Accounts');
  const list = useFetch<any[]>('/sales');
  const dealers = useFetch<any[]>('/masters/dealers');
  const factories = useFetch<any[]>('/masters/factories');
  const stock = useFetch<any[]>('/dashboards/stock-summary');
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const [detail, setDetail] = useState<any | null>(null);
  const [withDispatch, setWithDispatch] = useState(false);
  const [addingDispatch, setAddingDispatch] = useState(false);
  const [dform] = Form.useForm();
  const dealerId = Form.useWatch('dealer_id', form);
  const paymentType = Form.useWatch('payment_type', form);

  const dealer = useMemo(() => (dealers.data ?? []).find((d) => d.dealer_id === dealerId), [dealers.data, dealerId]);

  // Live available-stock check per sale line (Available lots only, same factory).
  const items = Form.useWatch('items', form) as any[] | undefined;
  const stockMap = useMemo(() => {
    const m = new Map<number, number>();
    (stock.data ?? []).forEach((r) => m.set(r.factory_id, (m.get(r.factory_id) ?? 0) + Number(r.available_qty)));
    return m;
  }, [stock.data]);
  const stockIssues = useMemo(() => {
    // Aggregate demand per factory across ALL lines (two lines can hit the same lot pool).
    const demand = new Map<number, number>();
    (items ?? []).forEach((l) => {
      if (l?.factory_id && l?.sale_qty) {
        demand.set(l.factory_id, (demand.get(l.factory_id) ?? 0) + Number(l.sale_qty));
      }
    });
    return (items ?? []).map((l) => {
      if (!l?.factory_id) return null;
      const avail = stockMap.get(l.factory_id) ?? 0;
      const dem = demand.get(l.factory_id) ?? 0;
      return { avail, dem, exceeded: dem - avail > 1e-9 };
    });
  }, [items, stockMap]);
  const hasStockError = stockIssues.some((s) => s?.exceeded);

  const openNew = () => { setOpen(true); stock.reload(); };

  const buildPayload = () => {
    const v = form.getFieldsValue();
    return {
      dealer_id: v.dealer_id,
      sale_date: v.sale_date?.format('YYYY-MM-DD'),
      sale_invoice_no: v.sale_invoice_no,
      payment_type: v.payment_type,
      credit_days: v.payment_type === 'Credit' ? v.credit_days : null,
      items: (v.items ?? []).map((it: any) => ({ factory_id: it.factory_id, sale_qty: it.sale_qty, sale_rate: it.sale_rate, purchase_invoice_no: it.purchase_invoice_no })),
    };
  };

  const resetForm = () => { setOpen(false); setWithDispatch(false); form.resetFields(); };

  const save = async () => {
    if (hasStockError) { message.error('Some lines exceed available stock — fix the highlighted quantities before saving.'); return; }
    try {
      await form.validateFields();
      const { data: sale } = await api.post('/sales', buildPayload());
      // Optional dispatch entered during the sale
      const v = form.getFieldsValue();
      if (withDispatch) {
        await api.post('/dispatch', {
          sale_id: sale.sale_id, truck_number: v.truck_number, driver_name: v.driver_name,
          driver_phone: v.driver_phone, dispatch_date: v.dispatch_date?.format('YYYY-MM-DD'), delivery_location: v.delivery_location,
        });
        message.success(`Sale ${sale.sale_invoice_no ?? sale.sale_id} created & dispatched`);
      } else {
        message.success(`Sale created (invoice ${sale.sale_invoice_no ?? sale.sale_id})`);
      }
      resetForm(); list.reload();
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(apiError(e));
    }
  };

  const openDetail = async (id: number) => { setAddingDispatch(false); setDetail((await api.get(`/sales/${id}`)).data); };

  const addDispatchLater = async (v: any) => {
    try {
      await api.post('/dispatch', {
        sale_id: detail.sale_id, truck_number: v.truck_number, driver_name: v.driver_name,
        driver_phone: v.driver_phone, dispatch_date: v.dispatch_date?.format('YYYY-MM-DD'), delivery_location: v.delivery_location,
      });
      message.success('Dispatched'); setAddingDispatch(false); dform.resetFields();
      openDetail(detail.sale_id); list.reload();
    } catch (e) { message.error(apiError(e)); }
  };

  const markDelivered = async (dispatchId: number) => {
    try { await api.patch(`/dispatch/${dispatchId}/deliver`, {}); message.success('Marked delivered'); openDetail(detail.sale_id); list.reload(); }
    catch (e) { message.error(apiError(e)); }
  };

  return (
    <>
      <PageTitle title="Sales" subtitle="Sell to a dealer — FIFO lot allocation (same brand only), with dispatch in one step"
        extra={canWrite && <Button type="primary" icon={<PlusOutlined />} onClick={openNew}>New Sale</Button>} />
      <Loading loading={list.loading} error={list.error}>
        <Card>
          <Table rowKey="sale_id" dataSource={list.data ?? []} size="middle" scroll={{ x: 900 }}
            onRow={(r) => ({ onClick: () => openDetail(r.sale_id), style: { cursor: 'pointer' } })}
            columns={[
              { title: 'Invoice', dataIndex: 'sale_invoice_no', render: (v, r) => v ?? `#${r.sale_id}` },
              { title: 'Date', dataIndex: 'sale_date', render: (d) => d?.slice(0, 10) },
              { title: 'Dealer', dataIndex: 'dealer_name' },
              { title: 'Area', dataIndex: 'area' },
              { title: 'Sales Person', dataIndex: 'sales_person_name' },
              { title: 'Type', dataIndex: 'payment_type', render: (t) => <Tag color={STATUS_COLORS[t]}>{t}</Tag> },
              { title: 'Total', dataIndex: 'total_amount', align: 'right', render: inr },
              { title: 'Due', dataIndex: 'balance_due', align: 'right', render: (v) => <span style={{ color: v > 0 ? '#dc2626' : '#16a34a' }}>{inr(v)}</span> },
              { title: 'Status', dataIndex: 'status', render: (s) => <Tag color={STATUS_COLORS[s]}>{s}</Tag> },
              { title: 'Payment', dataIndex: 'payment_stat', render: (s) => <Tag color={STATUS_COLORS[s]}>{s}</Tag> },
            ]} />
        </Card>
      </Loading>

      {/* New sale */}
      <Modal title="New Sale" open={open} width={880} onCancel={resetForm}
        footer={[
          <Button key="cancel" onClick={resetForm}>Cancel</Button>,
          <Button key="save" type="primary" danger={hasStockError} disabled={hasStockError} onClick={() => save()}>Save sale</Button>,
        ]}>
        <Form form={form} layout="vertical" initialValues={{ sale_date: dayjs(), payment_type: 'Direct', items: [{}] }}>
          <Space size="large" wrap align="start">
            <Form.Item name="dealer_id" label="Dealer" rules={[{ required: true }]} style={{ minWidth: 240 }}>
              <Select showSearch optionFilterProp="label" placeholder="Select dealer"
                options={(dealers.data ?? []).map((d) => ({ value: d.dealer_id, label: d.name }))} />
            </Form.Item>
            <Form.Item name="sale_date" label="Date" rules={[{ required: true }]}><DatePicker /></Form.Item>
            <Form.Item name="sale_invoice_no" label="Invoice No"><Input placeholder="optional" /></Form.Item>
            <Form.Item name="payment_type" label="Payment Type" rules={[{ required: true }]}>
              <Select style={{ width: 130 }} options={['Direct', 'Credit'].map((t) => ({ value: t, label: t }))} />
            </Form.Item>
            {paymentType === 'Credit' && (
              <Form.Item name="credit_days" label="Credit Days" rules={[{ required: true, message: 'Set the credit period' }]}>
                <InputNumber min={0} style={{ width: 160 }} placeholder="e.g. 30 days" />
              </Form.Item>
            )}
          </Space>

          {dealer && (
            <Alert type="info" showIcon style={{ marginBottom: 12 }}
              message={<span>Sales person <b>auto-filled</b>: {dealer.sales_person_name ?? '—'} · Area: {dealer.area ?? '—'}</span>} />
          )}

          <Form.List name="items">
            {(fields, { add, remove }) => (
              <>
                <Table dataSource={fields} pagination={false} size="small" rowKey="key"
                  columns={[
                    { title: 'Factory', render: (_, f: any) => <Form.Item name={[f.name, 'factory_id']} rules={[{ required: true }]} noStyle><Select showSearch optionFilterProp="label" style={{ width: 150 }} placeholder="Factory" options={(factories.data ?? []).map((x) => ({ value: x.factory_id, label: x.name }))} /></Form.Item> },
                    { title: 'Qty (MT)', render: (_, f: any) => <Form.Item name={[f.name, 'sale_qty']} rules={[{ required: true }]} noStyle><InputNumber min={0.001} style={{ width: 100 }} status={stockIssues[f.name]?.exceeded ? 'error' : undefined} /></Form.Item> },
                    { title: 'Rate', render: (_, f: any) => <Form.Item name={[f.name, 'sale_rate']} rules={[{ required: true }]} noStyle><InputNumber min={0} style={{ width: 110 }} /></Form.Item> },
                    { title: 'Purchase Inv', render: (_, f: any) => <Form.Item name={[f.name, 'purchase_invoice_no']} noStyle><Input style={{ width: 130 }} placeholder="brand invoice" /></Form.Item> },
                    {
                      title: 'In stock', width: 150, render: (_, f: any) => {
                        const s = stockIssues[f.name];
                        if (!s) return <Typography.Text type="secondary">—</Typography.Text>;
                        return (
                          <div style={{ lineHeight: 1.25 }}>
                            <span style={{ color: s.exceeded ? '#dc2626' : '#16a34a', fontWeight: 600 }}>{mt(s.avail)} avail</span>
                            {s.exceeded && <div style={{ fontSize: 11, color: '#dc2626' }}><ExclamationCircleOutlined /> short by {mt(s.dem - s.avail)}</div>}
                          </div>
                        );
                      },
                    },
                    { title: '', render: (_, f: any) => fields.length > 1 && <DeleteOutlined onClick={() => remove(f.name)} style={{ color: '#dc2626' }} /> },
                  ]} />
                <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({})} block style={{ marginTop: 10 }}>Add line</Button>
              </>
            )}
          </Form.List>

          {/* Dispatch during sale (optional) */}
          <Divider style={{ margin: '18px 0 12px' }} />
          <Space style={{ marginBottom: withDispatch ? 12 : 0 }}>
            <TruckOutlined />
            <Typography.Text strong>Dispatch now?</Typography.Text>
            <Switch checked={withDispatch} onChange={(c) => { setWithDispatch(c); if (c && !form.getFieldValue('dispatch_date')) form.setFieldsValue({ dispatch_date: dayjs() }); }} />
            <Typography.Text type="secondary">Fill truck details to dispatch immediately, or leave off and dispatch later.</Typography.Text>
          </Space>
          {withDispatch && (
            <Space wrap align="start">
              <Form.Item name="truck_number" label="Truck number"><Input placeholder="MH12AB1234" /></Form.Item>
              <Form.Item name="driver_name" label="Driver name"><Input /></Form.Item>
              <Form.Item name="driver_phone" label="Driver phone"><Input /></Form.Item>
              <Form.Item name="dispatch_date" label="Dispatch date"><DatePicker /></Form.Item>
              <Form.Item name="delivery_location" label="Delivery location" extra="Blank = dealer address" style={{ minWidth: 220 }}><Input /></Form.Item>
            </Space>
          )}
        </Form>
      </Modal>

      {/* Sale detail */}
      <Modal title={`Sale ${detail?.sale_invoice_no ?? '#' + detail?.sale_id}`} open={!!detail} onCancel={() => setDetail(null)} width={840}
        footer={detail && detail.status !== 'Cancelled' && detail.status !== 'Delivered' && canWrite ?
          [<Button key="c" danger onClick={async () => { try { await api.patch(`/sales/${detail.sale_id}/cancel`); message.success('Sale cancelled, stock released'); setDetail(null); list.reload(); } catch (e) { message.error(apiError(e)); } }}>Cancel sale</Button>] : null}>
        {detail && (
          <>
            <Descriptions size="small" column={2} bordered style={{ marginBottom: 12 }}>
              <Descriptions.Item label="Dealer">{detail.dealer_name}</Descriptions.Item>
              <Descriptions.Item label="Sales Person">{detail.sales_person_name}</Descriptions.Item>
              <Descriptions.Item label="Type"><Tag color={STATUS_COLORS[detail.payment_type]}>{detail.payment_type}</Tag>{detail.payment_type === 'Credit' && detail.credit_date ? <span style={{ marginLeft: 8, color: '#888' }}>due {detail.credit_date.slice(0, 10)}{detail.credit_days != null ? ` (${detail.credit_days}d)` : ''}</span> : null}</Descriptions.Item>
              <Descriptions.Item label="Status"><Tag color={STATUS_COLORS[detail.status]}>{detail.status}</Tag></Descriptions.Item>
              <Descriptions.Item label="Total">{inr(detail.total_amount)}</Descriptions.Item>
              <Descriptions.Item label="Balance Due">{inr(detail.balance_due)}</Descriptions.Item>
            </Descriptions>
            <Table title={() => 'Line items'} rowKey="sale_item_id" dataSource={detail.items} pagination={false} size="small"
              columns={[
                { title: 'Factory', dataIndex: 'factory_name' },
                { title: 'Qty', dataIndex: 'sale_qty', align: 'right', render: mt },
                { title: 'Rate', dataIndex: 'sale_rate', align: 'right', render: inr },
                { title: 'Total', dataIndex: 'line_total', align: 'right', render: inr },
                { title: 'Purchase Inv', dataIndex: 'purchase_invoice_no', render: (v) => v ?? '—' },
              ]} />
            <Table style={{ marginTop: 12 }} title={() => 'Lots drawn (FIFO)'} rowKey="allocation_id" dataSource={detail.allocations} pagination={false} size="small"
              columns={[
                { title: 'Lot #', dataIndex: 'booking_item_id' },
                { title: 'Booking', dataIndex: 'booking_id' },
                { title: 'Qty', dataIndex: 'allocated_qty', align: 'right', render: mt },
              ]} />

            {/* Dispatch section */}
            <Divider orientation="left" style={{ marginTop: 18 }}><TruckOutlined /> Dispatch</Divider>
            {detail.dispatch?.length ? (
              detail.dispatch.map((dd: any) => (
                <Descriptions key={dd.dispatch_id} size="small" column={2} bordered style={{ marginBottom: 8 }}
                  extra={dd.delivery_status === 'In-Transit' && canWrite && <Button size="small" icon={<CheckOutlined />} onClick={() => markDelivered(dd.dispatch_id)}>Mark delivered</Button>}>
                  <Descriptions.Item label="Truck">{dd.truck_number}</Descriptions.Item>
                  <Descriptions.Item label="Driver">{dd.driver_name ?? '—'} {dd.driver_phone ? `(${dd.driver_phone})` : ''}</Descriptions.Item>
                  <Descriptions.Item label="Dispatch date">{dd.dispatch_date?.slice(0, 10)}</Descriptions.Item>
                  <Descriptions.Item label="Destination">{dd.delivery_location ?? '—'}</Descriptions.Item>
                  <Descriptions.Item label="Delivery"><Tag color={dd.delivery_status === 'Delivered' ? 'green' : 'orange'}>{dd.delivery_status}</Tag></Descriptions.Item>
                  <Descriptions.Item label="Delivered on">{dd.delivered_date?.slice(0, 10) ?? '—'}</Descriptions.Item>
                </Descriptions>
              ))
            ) : detail.status === 'Cancelled' ? (
              <Typography.Text type="secondary">Sale cancelled — no dispatch.</Typography.Text>
            ) : addingDispatch ? (
              <Form form={dform} layout="vertical" onFinish={addDispatchLater} initialValues={{ dispatch_date: dayjs() }}>
                <Space wrap align="start">
                  <Form.Item name="truck_number" label="Truck number"><Input placeholder="MH12AB1234" /></Form.Item>
                  <Form.Item name="driver_name" label="Driver name"><Input /></Form.Item>
                  <Form.Item name="driver_phone" label="Driver phone"><Input /></Form.Item>
                  <Form.Item name="dispatch_date" label="Dispatch date"><DatePicker /></Form.Item>
                  <Form.Item name="delivery_location" label="Delivery location" extra="Blank = dealer address"><Input /></Form.Item>
                </Space>
                <Space><Button type="primary" onClick={() => dform.submit()}>Dispatch</Button><Button onClick={() => setAddingDispatch(false)}>Cancel</Button></Space>
              </Form>
            ) : (
              <Space direction="vertical">
                <Typography.Text type="secondary">Not dispatched yet.</Typography.Text>
                {canWrite && <Button type="primary" icon={<TruckOutlined />} onClick={() => setAddingDispatch(true)}>Add dispatch</Button>}
              </Space>
            )}
          </>
        )}
      </Modal>
    </>
  );
}
