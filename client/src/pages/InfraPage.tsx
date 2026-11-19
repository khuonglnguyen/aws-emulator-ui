import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { BookOpen, ChevronDown, ChevronUp, Copy, MoreVertical, Play, Plus, RefreshCw, Search, Terminal, Trash2 } from 'lucide-react';
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
  default?: string;
  hint?: string;
}
interface ActionMeta {
  id: string;
  label: string;
  scope: 'row' | 'resource';
  description?: string;
  fields?: FieldMeta[];
  danger?: boolean;
  cli?: string;
}
interface ResourceMeta {
  id: string;
  label: string;
  description?: string;
  listCli?: string;
  columns: Column[];
  create?: { fields: FieldMeta[]; cli?: string; showResult?: boolean };
  canDelete?: boolean;
  removeCli?: string;
  actions: ActionMeta[];
}
interface ServiceMeta {
  id: string;
  label: string;
  description?: string;
  concepts?: string[];
  resources: ResourceMeta[];
}
type Row = { id: string; raw: unknown; [k: string]: unknown };

/** Thay {id} và {field} trong mẫu lệnh CLI bằng giá trị đang nhập (thiếu → <field>) */
function fillCli(tpl: string, vals: Record<string, string>, id = '') {
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => (k === 'id' ? id || '<id>' : (vals[k] ?? '').replace(/\s*\n\s*/g, ' ') || `<${k}>`));
}

function CliBox({ cmd }: { cmd: string }) {
  const { toast } = useApp();
  return (
    <div className="mt-3 rounded-md bg-slate-900 p-3 text-slate-100">
      <div className="mb-1 flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-slate-400">
        <span className="flex items-center gap-1"><Terminal size={12} /> AWS CLI tương đương</span>
        <button
          className="flex items-center gap-1 hover:text-white"
          onClick={() => navigator.clipboard?.writeText(cmd).then(() => toast('success', 'Đã copy lệnh'))}
        >
          <Copy size={12} /> Copy
        </button>
      </div>
      <pre className="whitespace-pre-wrap break-all font-mono text-xs">$ {cmd}</pre>
    </div>
  );
}

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
  const [act, setAct] = useState<{ action: ActionMeta; row?: Row } | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(true);
  const { toast, notifyError } = useApp();
  const { ask, dialog } = useConfirm();

  const rowActions = res.actions.filter((a) => a.scope === 'row');
  const resActions = res.actions.filter((a) => a.scope === 'resource');
  const hasRowMenu = res.canDelete || rowActions.length > 0;

  const rows = (data ?? []).filter((r) =>
    !q.trim() ? true : res.columns.some((c) => String(r[c.key] ?? '').toLowerCase().includes(q.toLowerCase())),
  );

  const remove = (r: Row) =>
    ask(`Xóa "${String(r[res.columns[0].key] ?? r.id)}"?`, async () => {
      try {
        await api.delete(`/infra/${svc.id}/${res.id}`, { params: { id: r.id } });
        toast('success', 'Đã xóa');
        reload();
      } catch (err) {
        notifyError(err);
      }
    });

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
            {resActions.map((a) => (
              <button key={a.id} className="btn-normal" onClick={() => setAct({ action: a })}>
                <Play size={14} /> {a.label}
              </button>
            ))}
            {res.create && (
              <button className="btn-primary" onClick={() => setCreating(true)}>
                <Plus size={14} /> Create
              </button>
            )}
          </>
        }
      />

      {(svc.description || svc.concepts?.length) && (
        <div className="card mb-4 border-l-4 !border-l-sky-500 p-4">
          <button className="flex w-full items-center gap-2 text-left text-sm font-bold" onClick={() => setShowInfo(!showInfo)}>
            <BookOpen size={16} className="text-sky-600" /> Giới thiệu dịch vụ
            <span className="ml-auto text-slate-400">{showInfo ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</span>
          </button>
          {showInfo && (
            <div className="mt-2 text-sm">
              {svc.description && <p className="text-slate-700 dark:text-slate-300">{svc.description}</p>}
              {!!svc.concepts?.length && (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-slate-600 dark:text-slate-400">
                  {svc.concepts.map((c) => <li key={c}>{c}</li>)}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {svc.resources.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-700">
          {svc.resources.map((r) => (
            <button
              key={r.id}
              onClick={() => {
                setTab(r.id);
                setQ('');
                setMenuFor(null);
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

      {res.description && <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">{res.description}</p>}

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
                  {hasRowMenu && <th className="w-10" />}
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
                    {hasRowMenu && (
                      <td className="relative w-10 px-2" onClick={(e) => e.stopPropagation()}>
                        <button className="btn-icon" title="Actions" onClick={() => setMenuFor(menuFor === r.id ? null : r.id)}>
                          <MoreVertical size={15} />
                        </button>
                        {menuFor === r.id && (
                          <>
                            <div className="fixed inset-0 z-10" onClick={() => setMenuFor(null)} />
                            <div className="card absolute right-2 top-9 z-20 w-56 overflow-hidden py-1 shadow-lg">
                              {rowActions.map((a) => (
                                <button
                                  key={a.id}
                                  className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-800 ${a.danger ? 'text-red-600' : ''}`}
                                  onClick={() => {
                                    setMenuFor(null);
                                    setAct({ action: a, row: r });
                                  }}
                                >
                                  {a.label}
                                </button>
                              ))}
                              {res.canDelete && (
                                <>
                                  {rowActions.length > 0 && <div className="my-1 border-t border-slate-200 dark:border-slate-700" />}
                                  <button
                                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-red-600 hover:bg-slate-100 dark:hover:bg-slate-800"
                                    onClick={() => {
                                      setMenuFor(null);
                                      remove(r);
                                    }}
                                  >
                                    <Trash2 size={14} /> Delete
                                  </button>
                                </>
                              )}
                            </div>
                          </>
                        )}
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
        <FormModal
          title={`Create — ${res.label}`}
          submitLabel="Create"
          fields={res.create.fields}
          cli={res.create.cli}
          showResult={res.create.showResult}
          request={(vals) => api.post(`/infra/${svc.id}/${res.id}`, vals).then((r) => r.data)}
          onClose={() => setCreating(false)}
          onDone={() => {
            toast('success', 'Đã tạo');
            reload();
          }}
        />
      )}

      {act && (
        <FormModal
          key={act.action.id + (act.row?.id ?? '')}
          title={`${act.action.label}${act.row ? ` — ${String(act.row[res.columns[0].key] ?? act.row.id)}` : ''}`}
          submitLabel="Run"
          intro={act.action.description}
          fields={act.action.fields ?? []}
          cli={act.action.cli}
          rowId={act.row?.id}
          showResult
          request={(vals) =>
            api.post(`/infra/${svc.id}/${res.id}/action/${act.action.id}`, { ...vals, id: act.row?.id ?? '' }).then((r) => r.data)
          }
          onClose={() => setAct(null)}
          onDone={() => {
            toast('success', `${act.action.label}: thành công`);
            reload();
          }}
        />
      )}

      {detail && (
        <Modal wide title={String(detail[res.columns[0].key] ?? detail.id)} onClose={() => setDetail(null)}>
          <p className="mb-2 break-all font-mono text-xs text-slate-500">{detail.id}</p>
          {(rowActions.length > 0 || res.canDelete) && (
            <div className="mb-3 flex flex-wrap gap-2">
              {rowActions.map((a) => (
                <button
                  key={a.id}
                  className={a.danger ? 'btn-normal !text-red-600' : 'btn-normal'}
                  onClick={() => {
                    const row = detail;
                    setDetail(null);
                    setAct({ action: a, row });
                  }}
                >
                  {a.label}
                </button>
              ))}
            </div>
          )}
          <JsonBlock value={detail.raw} className="max-h-[50vh]" />
          {res.listCli && <CliBox cmd={res.listCli} />}
          {res.removeCli && <CliBox cmd={fillCli(res.removeCli, {}, detail.id)} />}
        </Modal>
      )}
    </>
  );
}

/** Form dùng chung cho Create và các thao tác: điền sẵn payload mẫu, xem lệnh CLI theo giá trị đang nhập, hiện kết quả */
function FormModal({
  title,
  submitLabel,
  intro,
  fields,
  cli,
  rowId,
  showResult,
  request,
  onClose,
  onDone,
}: {
  title: string;
  submitLabel: string;
  intro?: string;
  fields: FieldMeta[];
  cli?: string;
  rowId?: string;
  showResult?: boolean;
  request: (vals: Record<string, string>) => Promise<{ result?: unknown }>;
  onClose: () => void;
  onDone: () => void;
}) {
  const { notifyError } = useApp();
  const [vals, setVals] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, f.default ?? f.options?.[0] ?? ''])),
  );
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ value: unknown } | null>(null);
  const ok = fields.every((f) => !f.required || vals[f.key]?.trim());

  const submit = async () => {
    setBusy(true);
    try {
      const r = await request(vals);
      onDone();
      if (showResult && r.result !== undefined && r.result !== null) setResult({ value: r.result });
      else onClose();
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(false);
    }
  };

  if (result)
    return (
      <Modal wide title={`${title} — kết quả`} onClose={onClose} footer={<button className="btn-primary" onClick={onClose}>Đóng</button>}>
        <JsonBlock value={result.value} className="max-h-[60vh]" />
      </Modal>
    );

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn-normal" onClick={onClose}>Hủy</button>
          <button className="btn-primary" disabled={!ok || busy} onClick={submit}>
            {busy && <Spinner />} {submitLabel}
          </button>
        </>
      }
    >
      {intro && <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">{intro}</p>}
      {!fields.length && !intro && <p className="text-sm text-slate-500">Thao tác không cần tham số.</p>}
      {fields.map((f) => (
        <Field key={f.key} label={f.label + (f.required ? ' *' : '')} hint={f.hint}>
          {f.options ? (
            <select className="input" value={vals[f.key]} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })}>
              {f.options.map((o) => <option key={o}>{o}</option>)}
            </select>
          ) : f.multiline ? (
            <textarea
              className="input h-32 font-mono text-xs"
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
      {cli && <CliBox cmd={fillCli(cli, vals, rowId)} />}
    </Modal>
  );
}
