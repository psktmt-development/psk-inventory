import { Card, Table, Tag } from 'antd';
import dayjs from 'dayjs';
import { useFetch } from '../../hooks';
import { PageTitle, Loading } from '../../components/Page';
import { inr } from '../../api';

interface Payments {
  dealerOutstanding: { dealer_id: number; dealer_name: string; total: number; paid: number; due: number; due_date: string | null; overdue: number }[];
  factoryPayable: { factory_id: number; factory_name: string; booked_value: number; paid: number; payable: number; age_0_30: number; age_31_60: number; age_60_plus: number }[];
  trend: { month: string; received: number; paid: number }[];
}

export default function PaymentsDashboard() {
  const { data, loading, error } = useFetch<Payments>('/dashboards/payments');
  return (
    <>
      <PageTitle title="Payments Dashboard" subtitle="Dealer receivables · factory payable" />
      <Loading loading={loading} error={error}>
        {data && (
          <>
            <Card title="Dealer receivables — outstanding to collect">
              <Table rowKey="dealer_id" size="middle" dataSource={data.dealerOutstanding}
                pagination={{ pageSize: 12, hideOnSinglePage: true }} scroll={{ x: 800 }}
                columns={[
                  { title: 'Dealer', dataIndex: 'dealer_name' },
                  { title: 'Total', dataIndex: 'total', align: 'right', render: inr },
                  { title: 'Paid', dataIndex: 'paid', align: 'right', render: (v) => <span style={{ color: '#16a34a' }}>{inr(v)}</span> },
                  { title: 'Due', dataIndex: 'due', align: 'right', render: (v) => <b style={{ color: v > 0 ? '#dc2626' : '#16a34a' }}>{inr(v)}</b> },
                  {
                    title: 'Due Date', dataIndex: 'due_date', align: 'center', width: 150,
                    render: (v: string | null) => {
                      if (!v) return <span style={{ color: '#999' }}>—</span>;
                      const overdue = dayjs(v).isBefore(dayjs(), 'day');
                      return <Tag color={overdue ? 'red' : 'default'}>{dayjs(v).format('DD MMM YYYY')}{overdue ? ' · overdue' : ''}</Tag>;
                    },
                  },
                ]} />
            </Card>

            <Card title="Factory payable" style={{ marginTop: 16 }}>
              <Table rowKey="factory_id" pagination={false} size="middle" dataSource={data.factoryPayable}
                columns={[
                  { title: 'Factory', dataIndex: 'factory_name' },
                  { title: 'Booked Value', dataIndex: 'booked_value', align: 'right', render: inr },
                  { title: 'Paid', dataIndex: 'paid', align: 'right', render: inr },
                  { title: 'Payable', dataIndex: 'payable', align: 'right', render: (v) => <b style={{ color: '#dc2626' }}>{inr(v)}</b> },
                ]} />
            </Card>
          </>
        )}
      </Loading>
    </>
  );
}
