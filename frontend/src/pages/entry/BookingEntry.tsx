import { useState } from 'react';
import { App, Button, Card, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table } from 'antd';
import { PlusOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api, apiError, fmtDate, inr, mt } from '../../api';
import { useFetch } from '../../hooks';
import { PageTitle, Loading } from '../../components/Page';
import { useAuth } from '../../auth';

const SIZES = [8, 10, 12, 16, 20, 25, 32];

export default function BookingEntry() {
  const { message } = App.useApp();
  const { can } = useAuth();
  const canWrite = can('Warehouse', 'Accounts');
  const list = useFetch<any[]>('/bookings');
  const factories = useFetch<any[]>('/masters/factories');
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [detail, setDetail] = useState<any | null>(null);
  const [form] = Form.useForm();

  const submit = async (v: any) => {
    const payload = {
      factory_id: v.factory_id,
      booking_date: v.booking_date?.format('YYYY-MM-DD'),
      brand: v.brand,
      items: (v.items ?? []).map((it: any) => ({
        size_mm: it.size_mm, booked_qty: it.booked_qty, purchase_rate: it.purchase_rate ?? 0,
      })),
    };
    try {
      if (editId) {
        await api.put(`/bookings/${editId}`, payload);
        message.success('Booking updated');
      } else {
        await api.post('/bookings', payload);
        message.success('Booking created');
      }
      setOpen(false); setEditId(null); form.resetFields(); list.reload();
    } catch (e) { message.error(apiError(e)); }
  };

  const openNew = () => { setEditId(null); form.resetFields(); form.setFieldsValue({ booking_date: dayjs(), items: [{}] }); setOpen(true); };

  const openEdit = async (id: number) => {
    try {
      const { data } = await api.get(`/bookings/${id}`);
      form.setFieldsValue({
        factory_id: data.factory_id,
        booking_date: data.booking_date ? dayjs(data.booking_date) : dayjs(),
        brand: data.brand,
        items: (data.items ?? []).map((it: any) => ({ size_mm: it.size_mm, booked_qty: Number(it.booked_qty), purchase_rate: Number(it.purchase_rate) })),
      });
      setEditId(id); setOpen(true);
    } catch (e) { message.error(apiError(e)); }
  };

  const closeModal = () => { setOpen(false); setEditId(null); form.resetFields(); };

  const openDetail = async (id: number) => {
    const { data } = await api.get(`/bookings/${id}`);
    setDetail(data);
  };

  const del = async (id: number) => {
    try {
      await api.delete(`/bookings/${id}`);
      message.success('Booking deleted');
      list.reload();
    } catch (e) { message.error(apiError(e)); }
  };

  return (
    <>
      <PageTitle title="Bookings" subtitle="Book stock from a factory — booked stock is instantly available for sale (FIFO by date)"
        extra={canWrite && <Button type="primary" icon={<PlusOutlined />} onClick={openNew}>New Booking</Button>} />
      <Loading loading={list.loading} error={list.error}>
        <Card>
          <Table rowKey="booking_id" dataSource={list.data ?? []} size="middle"
            onRow={(r) => ({ onClick: () => openDetail(r.booking_id), style: { cursor: 'pointer' } })}
            columns={[
              { title: '#', dataIndex: 'booking_id', width: 60 },
              { title: 'Date', dataIndex: 'booking_date', render: fmtDate },
              { title: 'Factory', dataIndex: 'factory_name' },
              { title: 'Rate', dataIndex: 'avg_rate', align: 'right', render: inr },
              { title: 'Total Booked', dataIndex: 'total_booked', align: 'right', render: mt },
              { title: 'Balance', dataIndex: 'total_balance', align: 'right', render: mt },
              { title: 'Payable', dataIndex: 'payable', align: 'right', render: inr },
              { title: 'Paid', dataIndex: 'paid', align: 'right', render: (v) => <span style={{ color: '#16a34a' }}>{inr(v)}</span> },
              { title: 'Due', align: 'right', render: (_, r: any) => { const due = Number(r.payable) - Number(r.paid); return <b style={{ color: due > 0 ? '#dc2626' : '#16a34a' }}>{inr(due)}</b>; } },
              ...(canWrite ? [{
                title: '', width: 92, align: 'center' as const, render: (_: any, r: any) => (
                  <Space size={0} onClick={(e) => e.stopPropagation()}>
                    <Button type="text" icon={<EditOutlined />} onClick={() => openEdit(r.booking_id)} />
                    <Popconfirm title="Delete this booking?" description="Removes the booking and its lots. Not allowed if any stock was already sold."
                      okText="Delete" okButtonProps={{ danger: true }} onConfirm={() => del(r.booking_id)}>
                      <Button type="text" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                  </Space>
                ),
              }] : []),
            ]} />
        </Card>
      </Loading>

      {/* Create booking */}
      <Modal title={editId ? `Edit Booking #${editId}` : 'New Booking'} open={open} onCancel={closeModal} onOk={() => form.submit()} width={760} okText={editId ? 'Update booking' : 'Save booking'}>
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
                    { title: 'Size', render: (_, f: any) => <Form.Item name={[f.name, 'size_mm']} rules={[{ required: true, message: 'Size' }]} noStyle><Select placeholder="Size" style={{ width: 110 }} options={SIZES.map((s) => ({ value: s, label: `${s} mm` }))} /></Form.Item> },
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
            { title: 'Size', dataIndex: 'size_mm', render: (v) => `${v} mm` },
            { title: 'Booked', dataIndex: 'booked_qty', align: 'right', render: mt },
            { title: 'Balance (available)', dataIndex: 'balance_qty', align: 'right', render: mt },
          ]} />
      </Modal>
    </>
  );
}
