import { Link } from 'react-router-dom';
import { HardDrive, Table2, MessagesSquare, Zap } from 'lucide-react';
import { api } from '../api';
import { useApp, useLoad } from '../context';
import { PageHeader, Spinner } from '../components/ui';
import { INFRA_NAV } from '../nav';

interface Overview {
  s3: { count: number; error?: string };
  dynamodb: { count: number; error?: string };
  sqs: { count: number; error?: string };
  lambda: { count: number; error?: string };
  infra?: Record<string, { count: number; error?: string }>;
}

export default function Overview() {
  const { settings, connected } = useApp();
  const { data, loading } = useLoad<Overview>(() => api.get('/overview').then((r) => r.data));

  const cards = [
    { to: '/s3', label: 'S3 Buckets', icon: HardDrive, d: data?.s3, color: 'text-green-600' },
    { to: '/dynamodb', label: 'DynamoDB Tables', icon: Table2, d: data?.dynamodb, color: 'text-blue-600' },
    { to: '/sqs', label: 'SQS Queues', icon: MessagesSquare, d: data?.sqs, color: 'text-pink-600' },
    { to: '/lambda', label: 'Lambda Functions', icon: Zap, d: data?.lambda, color: 'text-orange-500' },
    ...INFRA_NAV.map((n) => ({
      to: n.to,
      label: `${n.label}`,
      icon: n.icon,
      d: data?.infra?.[n.to.replace('/svc/', '')],
      color: 'text-slate-500',
    })),
  ];

  return (
    <>
      <PageHeader title="Overview" subtitle="Tổng quan tài nguyên đang chạy trên AWS Emulator" />

      <div className="card mb-6 p-5">
        <h2 className="mb-3 text-lg font-bold">Thông tin kết nối</h2>
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-slate-500">Endpoint URL</dt>
            <dd className="font-mono font-semibold">{settings.endpoint}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Region</dt>
            <dd className="font-mono font-semibold">{settings.region}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Trạng thái</dt>
            <dd className={`font-semibold ${connected ? 'text-green-600' : 'text-red-600'}`}>
              {connected === null ? 'Đang kiểm tra…' : connected ? 'Connected' : 'Disconnected'}
            </dd>
          </div>
        </dl>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(({ to, label, icon: Icon, d, color }) => (
          <Link key={to} to={to} className="card p-5 transition hover:shadow-md">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-500 dark:text-slate-400">{label}</span>
              <Icon className={color} size={22} />
            </div>
            <div className="mt-3 text-4xl font-bold">{loading ? <Spinner size={28} /> : (d?.count ?? '-')}</div>
            {d?.error && <div className="mt-2 truncate text-xs text-red-500" title={d.error}>{d.error}</div>}
          </Link>
        ))}
      </div>
    </>
  );
}
