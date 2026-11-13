import { useState } from 'react';
import { Pencil, Play, Plus, RefreshCw, Trash2, Upload, Zap } from 'lucide-react';
import { api } from '../api';
import { useApp, useLoad } from '../context';
import { Badge, Empty, Field, JsonBlock, Modal, PageHeader, Spinner, useConfirm } from '../components/ui';

interface Fn {
  name: string;
  arn: string;
  runtime?: string;
  handler?: string;
  memory?: number;
  timeout?: number;
  state?: string;
  lastModified?: string;
  codeSize?: number;
  description?: string;
  role?: string;
  environment: Record<string, string>;
}
interface InvokeResult {
  statusCode: number;
  functionError: string | null;
  durationMs: number;
  result: unknown;
  logs: string;
}

export default function LambdaPage() {
  const { data, loading, reload } = useLoad<Fn[]>(() => api.get('/lambda/functions').then((r) => r.data));
  const [selected, setSelected] = useState<string | null>(null);
  const [form, setForm] = useState<{ mode: 'create' } | { mode: 'edit'; fn: Fn } | null>(null);
  const { toast, notifyError } = useApp();
  const { ask, dialog } = useConfirm();
  const fn = data?.find((f) => f.name === selected);

  return (
    <>
      <PageHeader
        title="AWS Lambda"
        subtitle="Functions"
        actions={
          <>
            <button className="btn-normal" onClick={reload}><RefreshCw size={14} /> Refresh</button>
            <button className="btn-primary" onClick={() => setForm({ mode: 'create' })}><Plus size={14} /> Create function</button>
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <div className="card self-start overflow-hidden">
          {loading && !data ? (
            <div className="p-6"><Spinner /></div>
          ) : !data?.length ? (
            <Empty text="Chưa có function nào." />
          ) : (
            <ul>
              {data.map((f) => (
                <li
                  key={f.name}
                  onClick={() => setSelected(f.name)}
                  className={`flex cursor-pointer items-center gap-2 border-b border-slate-100 px-4 py-2.5 text-sm dark:border-slate-800 ${
                    selected === f.name ? 'bg-sky-50 dark:bg-sky-900/30' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }`}
                >
                  <Zap size={15} className="shrink-0 text-orange-500" />
                  <span className="flex-1 truncate font-semibold">{f.name}</span>
                  <Badge tone="blue">{f.runtime ?? 'n/a'}</Badge>
                  <button
                    className="btn-icon text-red-500"
                    title="Delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      ask(`Xóa function "${f.name}"?`, async () => {
                        try {
                          await api.delete(`/lambda/functions/${encodeURIComponent(f.name)}`);
                          toast('success', 'Đã xóa function');
                          if (selected === f.name) setSelected(null);
                          reload();
                        } catch (err) {
                          notifyError(err);
                        }
                      });
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {fn ? (
          <FnPanel key={fn.name + fn.lastModified} fn={fn} onEdit={() => setForm({ mode: 'edit', fn })} />
        ) : (
          <div className="card"><Empty text="Chọn một function để xem cấu hình và chạy thử." /></div>
        )}
      </div>
      {dialog}
      {form && (
        <FnForm
          init={form.mode === 'edit' ? form.fn : undefined}
          onClose={() => setForm(null)}
          onDone={(name) => {
            setForm(null);
            setSelected(name);
            toast('success', form.mode === 'edit' ? 'Đã cập nhật function' : 'Đã tạo function');
            reload();
          }}
        />
      )}
    </>
  );
}

function FnPanel({ fn, onEdit }: { fn: Fn; onEdit: () => void }) {
  const { notifyError } = useApp();
  const [payload, setPayload] = useState('{\n  "key": "value"\n}');
  const [running, setRunning] = useState(false);
  const [res, setRes] = useState<InvokeResult | null>(null);

  const invoke = async () => {
    let parsed: unknown;
    try {
      parsed = payload.trim() ? JSON.parse(payload) : {};
    } catch (e: any) {
      return notifyError({ message: `Payload không phải JSON hợp lệ: ${e.message}` });
    }
    setRunning(true);
    try {
      const { data } = await api.post<InvokeResult>(`/lambda/functions/${encodeURIComponent(fn.name)}/invoke`, { payload: parsed });
      setRes(data);
    } catch (e) {
      notifyError(e);
    } finally {
      setRunning(false);
    }
  };

  const rows: [string, React.ReactNode][] = [
    ['Runtime', fn.runtime],
    ['Handler', fn.handler],
    ['Memory', fn.memory != null ? `${fn.memory} MB` : '-'],
    ['Timeout', fn.timeout != null ? `${fn.timeout} s` : '-'],
    ['State', fn.state],
    ['Role', <span className="break-all font-mono text-xs">{fn.role}</span>],
    ['Last modified', fn.lastModified],
    ['ARN', <span className="break-all font-mono text-xs">{fn.arn}</span>],
  ];

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-bold">{fn.name}</h2>
          <button className="btn-normal" onClick={onEdit}><Pencil size={14} /> Edit</button>
        </div>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-slate-500">{k}</dt>
              <dd className="font-semibold">{v ?? '-'}</dd>
            </div>
          ))}
        </dl>
        {Object.keys(fn.environment).length > 0 && (
          <>
            <h4 className="mb-1 mt-3 text-xs font-bold text-slate-500">Environment variables</h4>
            <JsonBlock value={fn.environment} />
          </>
        )}
      </div>

      <div className="card p-4">
        <h3 className="mb-2 font-bold">Test event (Invoke)</h3>
        <textarea className="input h-36 font-mono text-xs" spellCheck={false} value={payload} onChange={(e) => setPayload(e.target.value)} />
        <button className="btn-primary mt-2" disabled={running} onClick={invoke}>
          {running ? <Spinner /> : <Play size={14} />} Invoke
        </button>
      </div>

      {res && (
        <div className="card space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <h3 className="font-bold">Execution result</h3>
            <Badge tone={res.functionError ? 'orange' : 'green'}>{res.functionError ? `Error: ${res.functionError}` : 'Succeeded'}</Badge>
            <Badge>HTTP {res.statusCode}</Badge>
            <Badge>{res.durationMs} ms</Badge>
          </div>
          <div>
            <h4 className="mb-1 text-xs font-bold text-slate-500">Response</h4>
            <JsonBlock value={res.result as any} className="max-h-72" />
          </div>
          <div>
            <h4 className="mb-1 text-xs font-bold text-slate-500">Execution logs</h4>
            <JsonBlock value={res.logs || '(không có log)'} className="max-h-72 whitespace-pre-wrap" />
          </div>
        </div>
      )}
    </div>
  );
}

const RUNTIMES = ['nodejs22.x', 'nodejs20.x', 'python3.13', 'python3.12', 'python3.11', 'ruby3.3', 'java21', 'dotnet8', 'provided.al2023'];
const INLINE = (rt: string) => /^(nodejs|python|ruby)/.test(rt);

function template(runtime: string, handler: string): string {
  const fnName = handler.split('.').pop() || 'handler';
  if (runtime.startsWith('python'))
    return `def ${fnName}(event, context):\n    print(event)\n    return {"statusCode": 200, "body": "Hello from Lambda"}\n`;
  if (runtime.startsWith('ruby'))
    return `def ${fnName}(event:, context:)\n  { statusCode: 200, body: 'Hello from Lambda' }\nend\n`;
  return `exports.${fnName} = async (event) => {\n  console.log('event', JSON.stringify(event));\n  return { statusCode: 200, body: JSON.stringify({ message: 'Hello from Lambda', event }) };\n};\n`;
}
const defaultHandler = (rt: string) =>
  rt.startsWith('python') ? 'lambda_function.lambda_handler' : rt.startsWith('ruby') ? 'lambda_function.handler' : 'index.handler';

function FnForm({ init, onClose, onDone }: { init?: Fn; onClose: () => void; onDone: (name: string) => void }) {
  const { notifyError } = useApp();
  const edit = !!init;
  const [name, setName] = useState(init?.name ?? '');
  const [runtime, setRuntime] = useState(init?.runtime ?? 'nodejs20.x');
  const [handler, setHandler] = useState(init?.handler ?? 'index.handler');
  const [memory, setMemory] = useState(String(init?.memory ?? 128));
  const [timeout, setTimeout_] = useState(String(init?.timeout ?? 3));
  const [role, setRole] = useState(init?.role ?? '');
  const [description, setDescription] = useState(init?.description ?? '');
  const [env, setEnv] = useState(init && Object.keys(init.environment).length ? JSON.stringify(init.environment, null, 2) : '');
  const [source, setSource] = useState<'inline' | 'zip'>('inline');
  const [code, setCode] = useState(edit ? '' : template('nodejs20.x', 'index.handler'));
  const [zip, setZip] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const inlineOk = INLINE(runtime);
  const useZip = source === 'zip' || !inlineOk;
  const hasCode = useZip ? !!zip : !!code.trim();
  const valid = !!name.trim() && !!handler.trim() && (edit || hasCode);

  const changeRuntime = (rt: string) => {
    const pristine = !edit && (code === template(runtime, handler) || !code.trim());
    const newHandler = !edit && handler === defaultHandler(runtime) ? defaultHandler(rt) : handler;
    setRuntime(rt);
    setHandler(newHandler);
    if (pristine) setCode(template(rt, newHandler));
  };

  const submit = async () => {
    const fd = new FormData();
    fd.append('name', name.trim());
    fd.append('runtime', runtime);
    fd.append('handler', handler.trim());
    fd.append('memory', memory);
    fd.append('timeout', timeout);
    fd.append('role', role.trim());
    fd.append('description', description);
    fd.append('env', env.trim());
    if (useZip) {
      if (zip) fd.append('zip', zip);
    } else if (code.trim()) {
      fd.append('code', code);
    }
    setBusy(true);
    try {
      if (edit) await api.put(`/lambda/functions/${encodeURIComponent(name)}`, fd);
      else await api.post('/lambda/functions', fd);
      onDone(name.trim());
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      wide
      title={edit ? `Edit function — ${name}` : 'Create function'}
      onClose={onClose}
      footer={
        <>
          <button className="btn-normal" onClick={onClose}>Hủy</button>
          <button className="btn-primary" disabled={!valid || busy} onClick={submit}>
            {busy && <Spinner />} {edit ? 'Save' : 'Create'}
          </button>
        </>
      }
    >
      <div className="grid gap-x-4 sm:grid-cols-2">
        <Field label="Function name *">
          <input className="input" disabled={edit} autoFocus={!edit} value={name} onChange={(e) => setName(e.target.value.trim())} />
        </Field>
        <Field label="Runtime *">
          <select className="input" value={runtime} onChange={(e) => changeRuntime(e.target.value)}>
            {RUNTIMES.map((r) => <option key={r}>{r}</option>)}
          </select>
        </Field>
        <Field label="Handler *" hint="file.hàm — ví dụ index.handler">
          <input className="input" value={handler} onChange={(e) => setHandler(e.target.value.trim())} />
        </Field>
        <Field label="Execution role ARN" hint="Để trống để dùng role mặc định của emulator">
          <input className="input" placeholder="arn:aws:iam::000000000000:role/lambda-role" value={role} onChange={(e) => setRole(e.target.value.trim())} />
        </Field>
        <Field label="Memory (MB)">
          <input className="input" type="number" min={128} max={10240} value={memory} onChange={(e) => setMemory(e.target.value)} />
        </Field>
        <Field label="Timeout (giây)">
          <input className="input" type="number" min={1} max={900} value={timeout} onChange={(e) => setTimeout_(e.target.value)} />
        </Field>
      </div>
      <Field label="Description">
        <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field label="Environment variables (JSON)" hint='Ví dụ {"STAGE":"dev"}'>
        <textarea className="input h-20 font-mono text-xs" spellCheck={false} value={env} onChange={(e) => setEnv(e.target.value)} />
      </Field>

      <div className="mb-2 flex items-center gap-4 text-sm">
        <span className="font-semibold">Code{edit ? ' (bỏ trống nếu không đổi)' : ' *'}</span>
        {inlineOk &&
          (['inline', 'zip'] as const).map((v) => (
            <label key={v} className="flex items-center gap-1.5">
              <input type="radio" checked={source === v} onChange={() => setSource(v)} /> {v === 'inline' ? 'Soạn trực tiếp' : 'Tải lên .zip'}
            </label>
          ))}
      </div>
      {useZip ? (
        <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-slate-400 p-4 text-sm">
          <Upload size={16} />
          <span>{zip ? `${zip.name} (${Math.round(zip.size / 1024)} KB)` : 'Chọn file .zip chứa code'}</span>
          <input type="file" accept=".zip" className="hidden" onChange={(e) => setZip(e.target.files?.[0] ?? null)} />
        </label>
      ) : (
        <textarea
          className="input h-56 font-mono text-xs"
          spellCheck={false}
          placeholder={edit ? 'Dán code mới để thay thế code hiện tại…' : ''}
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
      )}
      {!inlineOk && <p className="mt-1 text-xs text-slate-500">Runtime này chỉ hỗ trợ tải lên file .zip.</p>}
    </Modal>
  );
}
