import { useState } from 'react';
import { App, Button, Card, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Table } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api, apiError, inr, mt } from '../../api';
import { useFetch } from '../../hooks';
import { PageTitle, Loading } from '../../components/Page';
import { useAuth } from '../../auth';

export default function BookingEntry() {
  const { message } = App.useApp();
  const { can } = useAuth();
  const canWrite = can('Warehouse', 'Accounts');
  const list = useFetch<any[]>('/bookings');
  const factories = useFetch<any[]>('/masters/factories');
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<any | null>(null);
  const [form] = Form.useForm();

  const submit = async (v: any) => {
    try {
      await api.post('/bookings', {
        factory_id: v.factory_id,
        booking_date: v.booking_date?.format('YYYY-MM-DD'),
        brand: v.brand,
        items: (v.items ?? []).map((it: any) => ({
          booked_qty: it.booked_qty, purchase_rate: it.purchase_rate ?? 0,
        })),
      });
      message.success('Booking created');
      setOpen(false); form.resetFields(); list.reload();
    } catch (e) { message.error(apiError(e)); }
  };

  const openDetail = async (id: number) => {
    const { data } = await api.get(`/bookings/${id}`);
    setDetail(data);
  };

  return (
    <>
      <PageTitle title="Bookings" subtitle="Book stock from a factory — booked stock is instantly available for sale (FIFO by date)"
        extra={canWrite && <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>New Booking</Button>} />
      <Loading loading={list.loading} error={list.error}>
        <Card>
          <Table rowKey="booking_id" dataSource={list.data ?? []} size="middle"
            onRow={(r) => ({ onClick: () => openDetail(r.booking_id), style: { cursor: 'pointer' } })}
            columns={[
              { title: '#', dataIndex: 'booking_id', width: 60 },
              { title: 'Date', dataIndex: 'booking_date', render: (d) => d?.slice(0, 10) },
              { title: 'Factory', dataIndex: 'factory_name' },
              { title: 'Rate', dataIndex: 'avg_rate', align: 'right', render: inr },
              { title: 'Total Booked', dataIndex: 'total_booked', align: 'right', render: mt },
              { title: 'Balance', dataIndex: 'total_balance', align: 'right', render: mt },
            ]} />
        </Card>
      </Loading>

      {/* Create booking */}
      <Modal title="New Booking" open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} width={760} okText="Save booking">
        <Form form={form} layout="vertical" onFinish={submit} initialValues={{ booking_date: dayjs(), items: [{}] }}>
          <Space size="large" wrap>
            <Form.Item name="factory_id" label="Factory" rules={[{ required: true }]} style={{ minWidth: 260 }}>
              <Select placeholder="Select factory" options={(factories.data ?? []).map((f) => ({ value: f.factory_id, label: f.name }))} />
            </Form.Item>
            <Form.Item name="booking_date" label="Booking Date" rules={[{ required: true }]}>
              <DatePicker />
            </Form.Item>
            <Form.Item name="brand" label="Brand" style={{ minWidth: 200 }}>
              <Input placeholder="Brand" />
            </Form.Item>
          </Space>
          <Form.List name="items">
            {(fields, { add, remove }) => (
              <>
                <Table dataSource={fields} pagination={false} size="small" rowKey="key"
                  columns={[
                    { title: 'Qty (MT)', render: (_, f: any) => <Form.Item name={[f.name, 'booked_qty']} rules={[{ required: true }]} noStyle><InputNumber min={0.001} style={{ width: 100 }} /></Form.Item> },
                    { title: 'Rate', render: (_, f: any) => <Form.Item name={[f.name, 'purchase_rate']} noStyle><InputNumber min={0} style={{ width: 110 }} /></Form.Item> },
                    { title: '', render: (_, f: any) => fields.length > 1 && <DeleteOutlined onClick={() => remove(f.name)} style={{ color: '#dc2626' }} /> },
                  ]} />
                <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({})} block style={{ marginTop: 10 }}>Add line</Button>
              </>
            )}
          </Form.List>
        </Form>
      </Modal>

      {/* Booking detail */}
      <Modal title={`Booking #${detail?.booking_id} — ${detail?.factory_name}`} open={!!detail} onCancel={() => setDetail(null)} footer={null} width={640}>
        <Table rowKey="booking_item_id" dataSource={detail?.items ?? []} pagination={false} size="small"
          columns={[
            { title: 'Booked', dataIndex: 'booked_qty', align: 'right', render: mt },
            { title: 'Balance (available)', dataIndex: 'balance_qty', align: 'right', render: mt },
          ]} />
      </Modal>
    </>
  );
}
