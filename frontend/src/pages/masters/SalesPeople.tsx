import { useMemo, useState } from 'react';
import { App, Button, Card, Descriptions, Divider, Drawer, Form, Input, List, Modal, Popconfirm, Select, Space, Table, Tag, Typography } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, UserOutlined } from '@ant-design/icons';
import { api, apiError } from '../../api';
import { useFetch } from '../../hooks';
import { PageTitle, Loading } from '../../components/Page';
import { useAuth } from '../../auth';

export default function SalesPeople() {
  const { message } = App.useApp();
  const { can } = useAuth();
  const canWrite = can('Admin');
  const list = useFetch<any[]>('/masters/sales-people');
  const dealers = useFetch<any[]>('/masters/dealers');

  const [profileId, setProfileId] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form] = Form.useForm();
  const [addIds, setAddIds] = useState<number[]>([]);

  const profile = useMemo(() => (list.data ?? []).find((s) => s.sales_person_id === profileId) ?? null, [list.data, profileId]);

  const refresh = async () => { await Promise.all([list.reload(), dealers.reload()]); };
  const currentIds = (sp: any): number[] => (sp?.dealers ?? []).map((d: any) => d.dealer_id);

  const openForm = (row?: any) => { setEditing(row ?? null); form.resetFields(); if (row) form.setFieldsValue(row); setFormOpen(true); };
  const saveForm = async (v: any) => {
    try {
      if (editing) await api.put(`/masters/sales-people/${editing.sales_person_id}`, v);
      else await api.post('/masters/sales-people', v);
      message.success('Saved'); setFormOpen(false); await refresh();
    } catch (e) { message.error(apiError(e)); }
  };
  const removeSalesperson = async (row: any) => {
    try {
      await api.delete(`/masters/sales-people/${row.sales_person_id}`);
      message.success('Deleted'); if (profileId === row.sales_person_id) setProfileId(null); await refresh();
    } catch (e) { message.error(apiError(e)); }
  };

  const putDealers = (sp: any, ids: number[]) => api.put(`/masters/sales-people/${sp.sales_person_id}`, { dealer_ids: ids });
  const addDealers = async () => {
    if (!profile || !addIds.length) return;
    try { await putDealers(profile, [...new Set([...currentIds(profile), ...addIds])]); setAddIds([]); message.success('Dealers added'); await refresh(); }
    catch (e) { message.error(apiError(e)); }
  };
  const removeDealer = async (dealerId: number) => {
    if (!profile) return;
    try { await putDealers(profile, currentIds(profile).filter((id) => id !== dealerId)); message.success('Dealer removed'); await refresh(); }
    catch (e) { message.error(apiError(e)); }
  };

  // Dealers offered in "add" = those not already mapped to this salesperson.
  const availableDealers = useMemo(() => {
    const assigned = new Set(currentIds(profile));
    return (dealers.data ?? []).filter((d) => !assigned.has(d.dealer_id));
  }, [dealers.data, profile]);

  return (
    <>
      <PageTitle title="Sales People" subtitle="Each salesperson and the dealers mapped to them — open a profile to manage dealers"
        extra={canWrite && <Button type="primary" icon={<PlusOutlined />} onClick={() => openForm()}>Add Salesperson</Button>} />
      <Loading loading={list.loading} error={list.error}>
        <Card>
          <Table rowKey="sales_person_id" dataSource={list.data ?? []} size="middle"
            pagination={{ pageSize: 12, hideOnSinglePage: true }}
            onRow={(r) => ({ onClick: () => setProfileId(r.sales_person_id), style: { cursor: 'pointer' } })}
            columns={[
              { title: 'Name', dataIndex: 'name', render: (v) => <b>{v}</b> },
              { title: 'Phone', dataIndex: 'phone', render: (v) => v || '—' },
              { title: 'Area', dataIndex: 'area', render: (v) => v || '—' },
              {
                title: 'Dealers', dataIndex: 'dealers', width: 130,
                render: (v: any[]) => (v?.length
                  ? <Tag color="blue">{v.length} dealer{v.length > 1 ? 's' : ''}</Tag>
                  : <Typography.Text type="secondary">None</Typography.Text>),
              },
              {
                title: 'Actions', key: 'a', width: 280,
                render: (_, r) => (
                  <Space onClick={(e) => e.stopPropagation()}>
                    <Button size="small" type="primary" ghost onClick={() => setProfileId(r.sales_person_id)}>Open profile</Button>
                    {canWrite && <Button size="small" icon={<EditOutlined />} onClick={() => openForm(r)}>Edit</Button>}
                    {canWrite && (
                      <Popconfirm title="Delete this salesperson?" description="Their dealers will become unassigned." okText="Delete" okButtonProps={{ danger: true }} onConfirm={() => removeSalesperson(r)}>
                        <Button size="small" danger icon={<DeleteOutlined />}>Delete</Button>
                      </Popconfirm>
                    )}
                  </Space>
                ),
              },
            ]} />
        </Card>
      </Loading>

      {/* Add / edit basic details */}
      <Modal title={editing ? 'Edit Salesperson' : 'Add Salesperson'} open={formOpen} onCancel={() => setFormOpen(false)} onOk={() => form.submit()} okText="Save">
        <Form form={form} layout="vertical" onFinish={saveForm}>
          <Form.Item name="name" label="Name" rules={[{ required: true }]}><Input placeholder="Salesperson name" /></Form.Item>
          <Form.Item name="phone" label="Phone"><Input /></Form.Item>
          <Form.Item name="area" label="Area"><Input /></Form.Item>
        </Form>
      </Modal>

      {/* Salesperson profile — view details & manage dealers */}
      <Drawer width={540} open={!!profile} onClose={() => setProfileId(null)}
        title={profile ? <Space><UserOutlined />{profile.name}</Space> : ''}
        extra={profile && canWrite && <Button icon={<EditOutlined />} onClick={() => openForm(profile)}>Edit details</Button>}>
        {profile && (
          <>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="Phone">{profile.phone || '—'}</Descriptions.Item>
              <Descriptions.Item label="Area">{profile.area || '—'}</Descriptions.Item>
              <Descriptions.Item label="Dealers assigned">{(profile.dealers ?? []).length}</Descriptions.Item>
            </Descriptions>

            <Divider orientation="left" style={{ marginTop: 20 }}>Dealers</Divider>

            {canWrite && (
              <Space.Compact style={{ width: '100%', marginBottom: 12 }}>
                <Select mode="multiple" style={{ width: '100%' }} showSearch optionFilterProp="label"
                  value={addIds} onChange={setAddIds} placeholder="Search dealers to add…" maxTagCount="responsive"
                  options={availableDealers.map((d) => ({
                    value: d.dealer_id,
                    label: d.sales_person_name && d.sales_person_id !== profile.sales_person_id ? `${d.name} · now with ${d.sales_person_name}` : d.name,
                  }))} />
                <Button type="primary" onClick={addDealers} disabled={!addIds.length}>Add</Button>
              </Space.Compact>
            )}

            <List size="small" bordered dataSource={profile.dealers ?? []} style={{ maxHeight: 460, overflow: 'auto' }}
              locale={{ emptyText: 'No dealers assigned yet' }}
              renderItem={(d: any) => (
                <List.Item actions={canWrite ? [
                  <Popconfirm key="r" title="Remove this dealer?" okText="Remove" okButtonProps={{ danger: true }} onConfirm={() => removeDealer(d.dealer_id)}>
                    <Button type="link" danger size="small">Remove</Button>
                  </Popconfirm>,
                ] : []}>
                  {d.name}
                </List.Item>
              )} />
          </>
        )}
      </Drawer>
    </>
  );
}
