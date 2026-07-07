import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { App, Button, Card, Form, Input, InputNumber, Modal, Popconfirm, Select, Table } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { api, apiError } from '../../api';
import { useFetch } from '../../hooks';
import { PageTitle, Loading } from '../../components/Page';
import { useAuth } from '../../auth';

type Field = { name: string; label: string; type?: 'text' | 'number' | 'select' | 'money' | 'multiselect'; required?: boolean; optionsFrom?: string; optionLabel?: (o: any) => string; optionValue?: string; options?: { value: any; label: string }[]; editValue?: (row: any) => any };
type Col = { title: string; dataIndex: string; width?: number; render?: (v: any, r: any) => any };
type Cfg = { title: string; pk: string; path: string; columns: Col[]; fields: Field[]; expandable?: (row: any) => any };

const CONFIG: Record<string, Cfg> = {
  factories: {
    title: 'Factories', pk: 'factory_id', path: '/masters/factories',
    columns: [{ title: 'Name', dataIndex: 'name' }, { title: 'Contact', dataIndex: 'contact_person' }, { title: 'Phone', dataIndex: 'phone' }, { title: 'GST', dataIndex: 'gst_number' }, { title: 'Address', dataIndex: 'address' }],
    fields: [{ name: 'name', label: 'Name', required: true }, { name: 'contact_person', label: 'Contact person' }, { name: 'phone', label: 'Phone' }, { name: 'gst_number', label: 'GST number' }, { name: 'address', label: 'Address' }],
  },
  dealers: {
    title: 'Dealers', pk: 'dealer_id', path: '/masters/dealers',
    columns: [{ title: 'Name', dataIndex: 'name' }, { title: 'Area', dataIndex: 'area' }, { title: 'Sales Person', dataIndex: 'sales_person_name' }],
    fields: [
      { name: 'name', label: 'Name', required: true }, { name: 'contact_person', label: 'Contact person' },
      { name: 'phone', label: 'Phone' }, { name: 'area', label: 'Area' }, { name: 'address', label: 'Address' },
      { name: 'sales_person_id', label: 'Sales Person', type: 'select', required: true, optionsFrom: '/masters/sales-people', optionLabel: (o) => o.name, optionValue: 'sales_person_id' },
    ],
  },
  users: {
    title: 'Users', pk: 'user_id', path: '/masters/users',
    columns: [{ title: 'Name', dataIndex: 'name' }, { title: 'Email', dataIndex: 'email' }, { title: 'Role', dataIndex: 'role' }],
    fields: [
      { name: 'name', label: 'Name', required: true }, { name: 'email', label: 'Email', required: true },
      { name: 'password', label: 'Password (leave blank to keep)', },
      { name: 'role', label: 'Role', type: 'select', options: ['Admin', 'Accounts', 'Sales', 'Warehouse', 'Viewer'].map((r) => ({ value: r, label: r })), required: true },
      { name: 'linked_sales_person_id', label: 'Linked Sales Person', type: 'select', optionsFrom: '/masters/sales-people', optionLabel: (o) => o.name, optionValue: 'sales_person_id' },
    ],
  },
};

export default function Masters() {
  const { entity } = useParams();
  const cfg = CONFIG[entity ?? ''];
  const { message } = App.useApp();
  const { can } = useAuth();
  const canWrite = can('Admin');
  const list = useFetch<any[]>(cfg ? cfg.path : null, [entity]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form] = Form.useForm();

  // Load option sources for select fields.
  const [opts, setOpts] = useState<Record<string, any[]>>({});
  useEffect(() => {
    if (!cfg) return;
    cfg.fields.filter((f) => f.optionsFrom).forEach(async (f) => {
      const { data } = await api.get(f.optionsFrom!);
      setOpts((o) => ({ ...o, [f.name]: data }));
    });
  }, [entity]);

  const openForm = (row?: any) => {
    setEditing(row ?? null);
    form.resetFields();
    if (row) {
      const initial: any = { ...row, password: undefined };
      cfg.fields.forEach((f) => { if (f.editValue) initial[f.name] = f.editValue(row); });
      form.setFieldsValue(initial);
    }
    setOpen(true);
  };

  const submit = async (v: any) => {
    try {
      if (editing) await api.put(`${cfg.path}/${editing[cfg.pk]}`, v);
      else await api.post(cfg.path, v);
      message.success('Saved'); setOpen(false); list.reload();
    } catch (e) { message.error(apiError(e)); }
  };

  const remove = async (row: any) => {
    try { await api.delete(`${cfg.path}/${row[cfg.pk]}`); message.success('Deleted'); list.reload(); }
    catch (e) { message.error(apiError(e)); }
  };

  const columns = useMemo(() => {
    if (!cfg) return [];
    const base = cfg.columns.map((c) => ({ ...c }));
    if (canWrite) base.push({
      title: 'Actions', dataIndex: '_a',
      render: (_: any, r: any) => (
        <>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openForm(r)} />
          <Popconfirm title="Delete this record?" onConfirm={() => remove(r)}><Button type="link" size="small" danger icon={<DeleteOutlined />} /></Popconfirm>
        </>
      ),
    });
    return base;
  }, [cfg, canWrite]);

  if (!cfg) return <PageTitle title="Unknown master" />;

  return (
    <>
      <PageTitle title={cfg.title} subtitle="Master data"
        extra={canWrite && <Button type="primary" icon={<PlusOutlined />} onClick={() => openForm()}>Add {cfg.title.replace(/s$/, '')}</Button>} />
      <Loading loading={list.loading} error={list.error}>
        <Card>
          <Table rowKey={cfg.pk} dataSource={list.data ?? []} columns={columns as any} size="middle"
            pagination={{ pageSize: 12, showSizeChanger: false, hideOnSinglePage: true }}
            expandable={cfg.expandable ? { expandedRowRender: cfg.expandable, rowExpandable: () => true } : undefined} />
        </Card>
      </Loading>

      <Modal title={editing ? `Edit ${cfg.title}` : `Add ${cfg.title}`} open={open} onCancel={() => setOpen(false)} onOk={() => form.submit()} okText="Save">
        <Form form={form} layout="vertical" onFinish={submit}>
          {cfg.fields.map((f) => (
            <Form.Item key={f.name} name={f.name} label={f.label} rules={f.required ? [{ required: true }] : undefined}>
              {f.type === 'select' ? (
                <Select allowClear showSearch optionFilterProp="label" options={f.options ?? (opts[f.name] ?? []).map((o) => ({ value: o[f.optionValue!], label: f.optionLabel!(o) }))} />
              ) : f.type === 'multiselect' ? (
                <Select mode="multiple" allowClear showSearch optionFilterProp="label" options={(opts[f.name] ?? []).map((o) => ({ value: o[f.optionValue!], label: f.optionLabel!(o) }))} />
              ) : f.type === 'number' ? <InputNumber style={{ width: '100%' }} />
                : f.type === 'money' ? <InputNumber style={{ width: '100%' }} prefix="₹" min={0} />
                  : f.name === 'password' ? <Input.Password />
                    : <Input />}
            </Form.Item>
          ))}
        </Form>
      </Modal>
    </>
  );
}
