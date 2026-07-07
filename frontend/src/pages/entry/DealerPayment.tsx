import { useMemo, useState } from 'react';
import { Alert, App, Button, Card, DatePicker, Form, Input, InputNumber, Modal, Select, Table } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api, apiError, inr } from '../../api';
import { useFetch } from '../../hooks';
import { PageTitle, Loading } from '../../components/Page';
import { useAuth } from '../../auth';

const MODES = ['Cash', 'Bank Transfer', 'Cheque', 'UPI'];

export default function DealerPayment() {
  const { message } = App.useApp();
  const { can } = useAuth();
  const canWrite = can('Accounts');
  const list = useFetch<any[]>('/payments/dealer');
  const sales = useFetch<any[]>('/sales');
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const saleId = Form.useWatch('sale_id', form);

  // Only sales with a balance due are payable.
  const payableSales = useMemo(() => (sales.data ?? []).filter((s) => Number(s.balance_due) > 0 && s.status !== 'Cancelled'), [sales.data]);
  const sale = useMemo(() => (sales.data ?? []).find((s) => s.sale_id === saleId), [sales.data, saleId]);

  const submit = async (v: any) => {
    try {
      await api.post('/payments/dealer', {
        dealer_id: sale.dealer_id, sale_id: v.sale_id, amount: v.amount,
        payment_date: v.payment_date?.format('YYYY-MM-DD'), payment_mode: v.payment_mode, reference_number: v.reference_number,
      });
      message.success('Payment recorded'); setOpen(false); form.resetFields();
      list.reload(); sales.reload();
    } catch (e) { message.error(apiError(e)); }
  };

  return (
    <>
      <PageTitle title="Dealer Payments" subtitle="Payments received from dealers — partial payments recompute the sale balance"
        extra={canWrite && <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>Record Payment</Button>} />
      <Loading loading={list.loading} error={list.error}>
        <Card>
          <Table rowKey="payment_id" dataSource={list.data ?? []} size="middle"
            columns={[
              { title: 'Date', dataIndex: 'payment_date', render: (d) => d?.slice(0, 10) },
              { title: 'Dealer', dataIndex: 'dealer_name' },
              { title: 'Sale Inv', dataIndex: 'sale_invoice_no', render: (v, r) => v ?? `#${r.sale_id}` },
              { title: 'Amount', dataIndex: 'amount', align: 'right', render: inr },
              { title: 'Mode', dataIndex: 'payment_mode' },
              { title: 'Reference', dataIndex: 'reference_number' },
            ]} />
        </Card>
      </Loading>

      <Modal title="Record Dealer Payment" open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} okText="Save">
        <Form form={form} layout="vertical" onFinish={submit} initialValues={{ payment_date: dayjs(), payment_mode: 'Bank Transfer' }}>
          <Form.Item name="sale_id" label="Sale (with balance due)" rules={[{ required: true }]}>
            <Select showSearch optionFilterProp="label"
              options={payableSales.map((s) => ({ value: s.sale_id, label: `${s.sale_invoice_no ?? '#' + s.sale_id} · ${s.dealer_name} · due ${inr(s.balance_due)}` }))} />
          </Form.Item>
          {sale && <Alert type="info" showIcon style={{ marginBottom: 12 }} message={`Balance due: ${inr(sale.balance_due)} of ${inr(sale.total_amount)}`} />}
          <Form.Item name="amount" label="Amount" rules={[{ required: true }, { validator: (_, v) => v && sale && v > Number(sale.balance_due) ? Promise.reject('Exceeds balance due') : Promise.resolve() }]}>
            <InputNumber min={1} max={sale ? Number(sale.balance_due) : undefined} style={{ width: '100%' }} prefix="₹" />
          </Form.Item>
          <Form.Item name="payment_date" label="Date" rules={[{ required: true }]}><DatePicker style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="payment_mode" label="Mode" rules={[{ required: true }]}><Select options={MODES.map((m) => ({ value: m, label: m }))} /></Form.Item>
          <Form.Item name="reference_number" label="Reference number"><Input /></Form.Item>
        </Form>
      </Modal>
    </>
  );
}
