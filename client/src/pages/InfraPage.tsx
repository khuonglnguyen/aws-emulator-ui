import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { api } from '../api';
import { useApp, useLoad } from '../context';
import { Empty, Field, JsonBlock, Modal, PageHeader, Spinner, useConfirm } from '../components/ui';

interface Column {
  key: string;
  label: string;
}
interface FieldMeta {
  key: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  multiline?: boolean;
  options?: string[];
}
interface ResourceMeta {
  id: string;
  label: string;
  columns: Column[];
  create?: { fields: FieldMeta[] };
  canDelete?: boolean;
}
interface ServiceMeta {
  id: string;
  label: string;
  resources: ResourceMeta[];
}
type Row = { id: string; raw: unknown; [k: string]: unknown };

export default function InfraPage() {
  const { service = '' } = useParams();
  const meta = useLoad<ServiceMeta[]>(() => api.get('/infra/meta').then((r) => r.data));
  const svc = meta.data?.find((s) => s.id === service);

  if (!svc) {
    return meta.loading || !meta.data ? (
      <div className="p-6"><Spinner /></div>
    ) : (
      <div className="card"><Empty text="Dịch vụ không tồn tại." /></div>
    );
  }
  // key theo service để reset tab khi chuyển dịch vụ
  return <ServiceView key={svc.id} svc={svc} />;
}

function ServiceView({ svc }: { svc: ServiceMeta }) {
  const [tab, setTab] = useState(svc.resources[0].id);
  const res = svc.resources.find((r) => r.id === tab) ?? svc.resources[0];
  const { data, loading, reload } = useLoad<Row[]>(
    () => api.get(`/infra/${svc.id}/${res.id}`).then((r) => r.data),
    [svc.id, res.id],
  );
  const [q, setQ] = useState('');
  const [detail, setDetail] = useState<Row | null>(null);
  const [creating, setCreating] = useState(false);
  const { toast, notifyError } = useApp();
  const { ask, dialog } = useConfirm();

  const rows = (data ?? []).filter((r) =>
    !q.trim() ? true : res.columns.some((c) => String(r[c.key] ?? '').toLowerCase().includes(q.toLowerCase())),
  );

  return (
    <>
      <PageHeader
        title={svc.label}
        subtitle={res.label}
        actions={
          <>
            <button className="btn-normal" onClick={reload}>
              <RefreshCw size={14} /> Refresh
            </button>
            {res.create && (
              <button className="btn-primary" onClick={() => setCreating(true)}>
                <Plus size={14} /> Create
              </button>
            )}
          </>
        }
      />

      {svc.resources.length > 1 && (
        <div className="mb-4 flex gap-1 border-b border-slate-200 dark:border-slate-700">
          {svc.resources.map((r) => (
            <button
              key={r.id}
              onClick={() => {
                setTab(r.id);
                setQ('');
              }}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${
                r.id === res.id
                  ? 'border-brand text-brand dark:border-sky-300 dark:text-sky-300'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-slate-200 p-3 dark:border-slate-700">
          <Search size={15} className="text-slate-400" />
          <input className="input !w-72" placeholder="Lọc…" value={q} onChange={(e) => setQ(e.target.value)} />
          <span className="ml-auto text-xs text-slate-500">{data ? `${rows.length} / ${data.length}` : ''}</span>
        </div>
        {loading && !data ? (
          <div className="p-6"><Spinner /></div>
        ) : !rows.length ? (
          <Empty text={data?.length ? 'Không có kết quả khớp.' : `Chưa có ${res.label.toLowerCase()} nào.`} />
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500 dark:bg-slate-800/60">
                <tr>
                  {res.columns.map((c) => (
                    <th key={c.key} className="px-4 py-2 font-bold">{c.label}</th>
                  ))}
                  {res.canDelete && <th className="w-10" />}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className="cursor-pointer border-t border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50"
                    onClick={() => setDetail(r)}
                  >
                    {res.columns.map((c, i) => (
                      <td key={c.key} className={`max-w-xs truncate px-4 py-2 ${i === 0 ? 'font-semibold' : ''}`} title={String(r[c.key] ?? '')}>
                        {String(r[c.key] ?? '-')}
                      </td>
                    ))}
                    {res.canDelete && (
                      <td className="w-10 px-2">
                        <button
                          className="btn-icon text-red-500"
                          title="Delete"
                          onClick={(e) => {
                            e.stopPropagation();
                            ask(`Xóa "${String(r[res.columns[0].key] ?? r.id)}"?`, async () => {
                              try {
                                await api.delete(`/infra/${svc.id}/${res.id}`, { params: { id: r.id } });
                                toast('success', 'Đã xóa');
                                reload();
                              } catch (err) {
                                notifyError(err);
                              }
                            });
                          }}
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {dialog}
      {creating && res.create && (
        <CreateModal
          title={`Create — ${res.label}`}
          fields={res.create.fields}
          path={`/infra/${svc.id}/${res.id}`}
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            toast('success', 'Đã tạo');
            reload();
          }}
        />
      )}

      {detail && (
        <Modal wide title={String(detail[res.columns[0].key] ?? detail.id)} onClose={() => setDetail(null)}>
          <p className="mb-2 break-all font-mono text-xs text-slate-500">{detail.id}</p>
          <JsonBlock value={detail.raw} className="max-h-[60vh]" />
        </Modal>
      )}
    </>
  );
}

function CreateModal({
  title,
  fields,
  path,
  onClose,
  onDone,
}: {
  title: string;
  fields: FieldMeta[];
  path: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { notifyError } = useApp();
  const [vals, setVals] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, f.options?.[0] ?? ''])),
  );
  const [busy, setBusy] = useState(false);
  const ok = fields.every((f) => !f.required || vals[f.key]?.trim());

  const submit = async () => {
    setBusy(true);
    try {
      await api.post(path, vals);
      onDone();
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn-normal" onClick={onClose}>Hủy</button>
          <button className="btn-primary" disabled={!ok || busy} onClick={submit}>
            {busy && <Spinner />} Create
          </button>
        </>
      }
    >
      {fields.map((f) => (
        <Field key={f.key} label={f.label + (f.required ? ' *' : '')}>
          {f.options ? (
            <select className="input" value={vals[f.key]} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })}>
              {f.options.map((o) => <option key={o}>{o}</option>)}
            </select>
          ) : f.multiline ? (
            <textarea
              className="input h-28 font-mono text-xs"
              spellCheck={false}
              placeholder={f.placeholder}
              value={vals[f.key]}
              onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })}
            />
          ) : (
            <input
              className="input"
              placeholder={f.placeholder}
              value={vals[f.key]}
              onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })}
            />
          )}
        </Field>
      ))}
    </Modal>
  );
}
