import { useMemo, useState } from 'react';
import { App, Button, Card, DatePicker, Form, Input, InputNumber, Modal, Select, Table, Tag } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api, apiError, inr } from '../../api';
import { useFetch } from '../../hooks';
import { PageTitle, Loading } from '../../components/Page';
import { useAuth } from '../../auth';

const MODES = ['Cash', 'Bank Transfer', 'Cheque', 'UPI'];

export default function SupplierPayment() {
  const { message } = App.useApp();
  const { can } = useAuth();
  const canWrite = can('Accounts');
  const list = useFetch<any[]>('/payments/supplier');
  const factories = useFetch<any[]>('/masters/factories');
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();

  // Pending (unpaid) invoices for the chosen factory, oldest first (FIFO).
  const factoryId = Form.useWatch('factory_id', form);
  const selectedIds = Form.useWatch('booking_ids', form) as number[] | undefined;
  const pending = useFetch<any[]>(factoryId ? `/payments/supplier/pending?factory_id=${factoryId}` : null, [factoryId]);

  // Total outstanding across the selected invoices — the max this payment can apply.
  const selectedOutstanding = useMemo(() => {
    const ids = new Set(selectedIds ?? []);
    return (pending.data ?? []).filter((b) => ids.has(b.booking_id)).reduce((s, b) => s + Number(b.outstanding), 0);
  }, [pending.data, selectedIds]);

  const submit = async (v: any) => {
    try {
      await api.post('/payments/supplier', {
        factory_id: v.factory_id, booking_ids: v.booking_ids ?? [], amount: v.amount,
        payment_date: v.payment_date?.format('YYYY-MM-DD'), payment_mode: v.payment_mode, reference_number: v.reference_number,
      });
      message.success('Payment recorded'); setOpen(false); form.resetFields(); list.reload();
    } catch (e) { message.error(apiError(e)); }
  };

  return (
    <>
      <PageTitle title="Supplier Payments" subtitle="Payments made to factories — pick pending invoices, amount applied FIFO by date"
        extra={canWrite && <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>Record Payment</Button>} />
      <Loading loading={list.loading} error={list.error}>
        <Card>
          <Table rowKey="payment_id" dataSource={list.data ?? []} size="middle"
            columns={[
              { title: 'Date', dataIndex: 'payment_date', render: (d) => d?.slice(0, 10) },
              { title: 'Factory', dataIndex: 'factory_name' },
              { title: 'Booking', dataIndex: 'booking_id', render: (v) => v ? `#${v}` : <Tag>General</Tag> },
              { title: 'Amount', dataIndex: 'amount', align: 'right', render: inr },
              { title: 'Mode', dataIndex: 'payment_mode' },
              { title: 'Reference', dataIndex: 'reference_number' },
            ]} />
        </Card>
      </Loading>

      <Modal title="Record Supplier Payment" open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} okText="Save">
        <Form form={form} layout="vertical" onFinish={submit} initialValues={{ payment_date: dayjs(), payment_mode: 'Bank Transfer' }}>
          <Form.Item name="factory_id" label="Factory" rules={[{ required: true }]}>
            <Select placeholder="Select factory"
              onChange={() => form.setFieldsValue({ booking_ids: [] })}
              options={(factories.data ?? []).map((f) => ({ value: f.factory_id, label: f.name }))} />
          </Form.Item>
          <Form.Item name="booking_ids"
            label="Pending invoices (oldest first — leave blank for a general settlement)"
            extra={selectedIds?.length ? `Selected outstanding: ${inr(selectedOutstanding)} — the amount is applied FIFO by date` : undefined}>
            <Select mode="multiple" allowClear placeholder={factoryId ? 'Select invoices to pay' : 'Select a factory first'}
              disabled={!factoryId} loading={pending.loading}
              options={(pending.data ?? []).map((b) => ({
                value: b.booking_id,
                label: `#${b.booking_id}${b.brand ? ` · ${b.brand}` : ''} · ${b.booking_date?.slice(0, 10)} · ${inr(b.outstanding)} due`,
              }))} />
          </Form.Item>
          <Form.Item name="amount" label="Amount" rules={[{ required: true }]}
            extra={selectedIds?.length ? `Max ${inr(selectedOutstanding)} for the selected invoices` : undefined}>
            <InputNumber min={1} max={selectedIds?.length ? selectedOutstanding : undefined} style={{ width: '100%' }} prefix="₹" />
          </Form.Item>
          <Form.Item name="payment_date" label="Date" rules={[{ required: true }]}><DatePicker style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="payment_mode" label="Mode" rules={[{ required: true }]}><Select options={MODES.map((m) => ({ value: m, label: m }))} /></Form.Item>
          <Form.Item name="reference_number" label="Reference number"><Input /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}
