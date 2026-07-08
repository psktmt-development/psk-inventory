import { Card, Col, Row, Statistic, Table, Tag } from 'antd';
import { useFetch } from '../../hooks';
import { PageTitle, Loading } from '../../components/Page';
import { fmtDate, STATUS_COLORS } from '../../api';

interface Dispatch {
  saleStatus: { status: string; orders: number }[];
  deliveryStatus: { delivery_status: string; count: number }[];
  pendingCount: number;
}

export default function DispatchTracking() {
  const { data, loading, error } = useFetch<Dispatch>('/dashboards/dispatch');
  const list = useFetch<any[]>('/dispatch');
  const count = (s: string) => data?.saleStatus.find((x) => x.status === s)?.orders ?? 0;

  return (
    <>
      <PageTitle title="Dispatch Tracking" subtitle="Pending, in-transit and delivered orders" />
      <Loading loading={loading || list.loading} error={error || list.error}>
        {data && (
          <>
            <Row gutter={[16, 16]}>
              <Col xs={12} md={6}><Card><Statistic title="Pending (awaiting dispatch)" value={data.pendingCount} valueStyle={{ color: '#f59e0b' }} /></Card></Col>
              <Col xs={12} md={6}><Card><Statistic title="Dispatched" value={count('Dispatched')} valueStyle={{ color: '#2563eb' }} /></Card></Col>
              <Col xs={12} md={6}><Card><Statistic title="Delivered" value={count('Delivered')} valueStyle={{ color: '#16a34a' }} /></Card></Col>
              <Col xs={12} md={6}><Card><Statistic title="In-Transit trucks" value={data.deliveryStatus.find((d) => d.delivery_status === 'In-Transit')?.count ?? 0} /></Card></Col>
            </Row>
            <Card title="Dispatch records" style={{ marginTop: 16 }}>
              <Table rowKey="dispatch_id" dataSource={list.data ?? []} size="middle" pagination={{ pageSize: 15 }} scroll={{ x: 900 }}
                columns={[
                  { title: 'Truck', dataIndex: 'truck_number' },
                  { title: 'Driver', dataIndex: 'driver_name' },
                  { title: 'Phone', dataIndex: 'driver_phone' },
                  { title: 'Dealer', dataIndex: 'dealer_name' },
                  { title: 'Area', dataIndex: 'area' },
                  { title: 'Destination', dataIndex: 'delivery_location' },
                  { title: 'Dispatch Date', dataIndex: 'dispatch_date', render: fmtDate },
                  { title: 'Delivery', dataIndex: 'delivery_status', render: (s) => <Tag color={s === 'Delivered' ? 'green' : 'orange'}>{s}</Tag> },
                  { title: 'Sale', dataIndex: 'sale_status', render: (s) => <Tag color={STATUS_COLORS[s]}>{s}</Tag> },
                ]} />
            </Card>
          </>
        )}
      </Loading>
    </>
  );
}
