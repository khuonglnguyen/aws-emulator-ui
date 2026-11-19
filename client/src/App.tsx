import { useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import {
  LayoutDashboard,
  HardDrive,
  Table2,
  MessagesSquare,
  Zap,
  Settings,
  RefreshCw,
  Moon,
  Sun,
  Cloud,
} from 'lucide-react';
import { useApp } from './context';
import { Field, Modal } from './components/ui';
import Overview from './pages/Overview';
import S3Page from './pages/S3Page';
import DynamoPage from './pages/DynamoPage';
import SqsPage from './pages/SqsPage';
import LambdaPage from './pages/LambdaPage';
import InfraPage from './pages/InfraPage';
import { INFRA_NAV } from './nav';

const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/s3', label: 'Amazon S3', icon: HardDrive },
  { to: '/dynamodb', label: 'Amazon DynamoDB', icon: Table2 },
  { to: '/sqs', label: 'Amazon SQS', icon: MessagesSquare },
  { to: '/lambda', label: 'AWS Lambda', icon: Zap },
];


function SettingsModal({ onClose }: { onClose: () => void }) {
  const { settings, updateSettings, toast } = useApp();
  const [endpoint, setEndpoint] = useState(settings.endpoint);
  const [region, setRegion] = useState(settings.region);
  return (
    <Modal
      title="Emulator Settings"
      onClose={onClose}
      footer={
        <>
          <button className="btn-normal" onClick={onClose}>
            Hủy
          </button>
          <button
            className="btn-primary"
            onClick={() => {
              if (!/^https?:\/\//i.test(endpoint.trim())) return toast('error', 'Endpoint URL phải bắt đầu bằng http:// hoặc https://');
              updateSettings({ endpoint: endpoint.trim().replace(/\/+$/, ''), region: region.trim() || 'us-east-1' });
              toast('success', 'Đã lưu cấu hình emulator');
              onClose();
            }}
          >
            Lưu
          </button>
        </>
      }
    >
      <Field label="Endpoint URL" hint="Ví dụ: https://127.0.0.1:9297 (chứng chỉ self-signed được chấp nhận)">
        <input className="input" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} />
      </Field>
      <Field label="Region">
        <input className="input" value={region} onChange={(e) => setRegion(e.target.value)} />
      </Field>
      <p className="text-xs text-slate-500">
        Cấu hình được lưu trong localStorage và gửi kèm header <code>x-aws-endpoint</code>, <code>x-aws-region</code> ở
        mỗi request — backend không cần khởi động lại.
      </p>
    </Modal>
  );
}

export default function App() {
  const { connected, refreshAll, settings, dark, toggleDark } = useApp();
  const [showSettings, setShowSettings] = useState(false);

  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 bg-aws-navy px-4 text-white">
        <Cloud className="text-aws" />
        <span className="text-lg font-bold">
          AWS <span className="text-aws">Local Console</span>
        </span>
        <div className="flex-1" />
        <span
          title={settings.endpoint}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${
            connected === null
              ? 'bg-slate-600'
              : connected
                ? 'bg-green-600'
                : 'bg-red-600'
          }`}
        >
          <span className={`h-2 w-2 rounded-full bg-white ${connected === null ? 'animate-pulse' : ''}`} />
          {connected === null ? 'Checking…' : connected ? 'Connected' : 'Disconnected'}
        </span>
        <span className="hidden text-xs text-slate-300 md:inline">{settings.region}</span>
        <button
          className="inline-flex items-center gap-1.5 rounded-full border border-slate-400 px-3 py-1 text-sm font-semibold hover:bg-white/10"
          onClick={refreshAll}
        >
          <RefreshCw size={14} /> Refresh All
        </button>
        <button
          className="inline-flex items-center gap-1.5 rounded-full border border-slate-400 px-3 py-1 text-sm font-semibold hover:bg-white/10"
          onClick={() => setShowSettings(true)}
        >
          <Settings size={14} /> Emulator Settings
        </button>
        <button className="rounded-md p-1.5 hover:bg-white/10" onClick={toggleDark} title="Dark / Light">
          {dark ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav className="w-60 shrink-0 overflow-y-auto border-r border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-[#121c29]">
          <div className="mb-2 px-3 text-xs font-bold uppercase tracking-wider text-slate-500">Services</div>
          {[
            { title: '', items: NAV },
            ...Array.from(new Set(INFRA_NAV.map((n) => n.group))).map((g) => ({
              title: g,
              items: INFRA_NAV.filter((n) => n.group === g),
            })),
          ].map((group, gi) => (
            <div key={gi}>
              {group.title && (
                <div className="mb-2 mt-4 px-3 text-xs font-bold uppercase tracking-wider text-slate-500">
                  {group.title}
                </div>
              )}
              {group.items.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === '/'}
                  className={({ isActive }) =>
                    `mb-1 flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-semibold ${
                      isActive
                        ? 'bg-sky-50 text-brand dark:bg-sky-900/30 dark:text-sky-300'
                        : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                    }`
                  }
                >
                  <Icon size={17} /> {label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <main className="min-w-0 flex-1 overflow-y-auto p-6">
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/s3" element={<S3Page />} />
            <Route path="/dynamodb" element={<DynamoPage />} />
            <Route path="/sqs" element={<SqsPage />} />
            <Route path="/lambda" element={<LambdaPage />} />
            <Route path="/svc/:service" element={<InfraPage />} />
          </Routes>
        </main>
      </div>

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  );
}
