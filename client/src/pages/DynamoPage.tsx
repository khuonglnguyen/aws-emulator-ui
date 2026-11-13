import { useMemo, useState } from 'react';
import { ArrowLeft, Pencil, Plus, RefreshCw, Table2, Trash2 } from 'lucide-react';
import { api } from '../api';
import { useApp, useLoad } from '../context';
import { Badge, Empty, Field, JsonBlock, Modal, PageHeader, Spinner, useConfirm } from '../components/ui';

interface Desc {
  name: string;
  status: string;
  itemCount: number;
  keySchema: { AttributeName: string; KeyType: 'HASH' | 'RANGE' }[];
}

export default function DynamoPage() {
  const [table, setTable] = useState<string | null>(null);
  return table ? <TableView table={table} onBack={() => setTable(null)} /> : <Tables onOpen={setTable} />;
}

function Tables({ onOpen }: { onOpen: (t: string) => void }) {
  const { toast, notifyError } = useApp();
  const { data, loading, reload } = useLoad<string[]>(() => api.get('/dynamodb/tables').then((r) => r.data));
  const [creating, setCreating] = useState(false);
  const [f, setF] = useState({ name: '', partitionKey: '', partitionKeyType: 'S', sortKey: '', sortKeyType: 'S' });
  const [busy, setBusy] = useState(false);
  const { ask, dialog } = useConfirm();

  const create = async () => {
    setBusy(true);
    try {
      await api.post('/dynamodb/tables', { ...f, sortKey: f.sortKey || undefined });
      toast('success', `Đã tạo bảng "${f.name}"`);
      setCreating(false);
      setF({ name: '', partitionKey: '', partitionKeyType: 'S', sortKey: '', sortKeyType: 'S' });
      reload();
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(false);
    }
  };

  const TypeSel = ({ k }: { k: 'partitionKeyType' | 'sortKeyType' }) => (
    <select className="input w-28" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}>
      <option value="S">String</option>
      <option value="N">Number</option>
      <option value="B">Binary</option>
    </select>
  );

  return (
    <>
      <PageHeader
        title="Amazon DynamoDB"
        subtitle="Tables"
        actions={
          <>
            <button className="btn-normal" onClick={reload}><RefreshCw size={14} /> Refresh</button>
            <button className="btn-primary" onClick={() => setCreating(true)}><Plus size={14} /> Create table</button>
          </>
        }
      />
      <div className="card overflow-hidden">
        {loading && !data ? (
          <div className="p-6"><Spinner /></div>
        ) : !data?.length ? (
          <Empty text="Chưa có bảng nào." />
        ) : (
          <table className="w-full">
            <thead><tr><th className="th">Table name</th><th className="th w-20" /></tr></thead>
            <tbody>
              {data.map((t) => (
                <tr key={t} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="td">
                    <button className="flex items-center gap-2 font-semibold text-brand hover:underline dark:text-sky-400" onClick={() => onOpen(t)}>
                      <Table2 size={15} /> {t}
                    </button>
                  </td>
                  <td className="td text-right">
                    <button
                      className="btn-icon text-red-500"
                      onClick={() =>
                        ask(`Xóa bảng "${t}"? Toàn bộ dữ liệu sẽ mất.`, async () => {
                          try {
                            await api.delete(`/dynamodb/tables/${encodeURIComponent(t)}`);
                            toast('success', `Đã xóa bảng "${t}"`);
                            reload();
                          } catch (e) {
                            notifyError(e);
                          }
                        })
                      }
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {creating && (
        <Modal
          title="Create table"
          onClose={() => setCreating(false)}
          footer={
            <>
              <button className="btn-normal" onClick={() => setCreating(false)}>Hủy</button>
              <button className="btn-primary" disabled={!f.name || !f.partitionKey || busy} onClick={create}>
                {busy && <Spinner />} Create
              </button>
            </>
          }
        >
          <Field label="Table name"><input className="input" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value.trim() })} /></Field>
          <Field label="Partition key">
            <div className="flex gap-2">
              <input className="input" value={f.partitionKey} onChange={(e) => setF({ ...f, partitionKey: e.target.value.trim() })} />
              <TypeSel k="partitionKeyType" />
            </div>
          </Field>
          <Field label="Sort key (tùy chọn)">
            <div className="flex gap-2">
              <input className="input" value={f.sortKey} onChange={(e) => setF({ ...f, sortKey: e.target.value.trim() })} />
              <TypeSel k="sortKeyType" />
            </div>
          </Field>
        </Modal>
      )}
      {dialog}
    </>
  );
}

function TableView({ table, onBack }: { table: string; onBack: () => void }) {
  const { toast, notifyError } = useApp();
  const t = encodeURIComponent(table);
  const desc = useLoad<Desc>(() => api.get(`/dynamodb/tables/${t}`).then((r) => r.data), [table]);
  const scan = useLoad<{ items: Record<string, any>[]; truncated: boolean }>(
    () => api.get(`/dynamodb/tables/${t}/items`).then((r) => r.data),
    [table],
  );
  const [view, setView] = useState<'table' | 'json'>('table');
  const [editor, setEditor] = useState<{ original?: Record<string, any>; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const { ask, dialog } = useConfirm();

  const keyNames = desc.data?.keySchema.map((k) => k.AttributeName) ?? [];
  const items = scan.data?.items ?? [];

  const columns = useMemo(() => {
    const set = new Set<string>(keyNames);
    items.forEach((i) => Object.keys(i).forEach((k) => set.add(k)));
    return Array.from(set);
  }, [items, keyNames.join(',')]);

  const keyOf = (item: Record<string, any>) => Object.fromEntries(keyNames.map((k) => [k, item[k]]));

  const save = async () => {
    if (!editor) return;
    let item: any;
    try {
      item = JSON.parse(editor.text);
    } catch (e: any) {
      return toast('error', `JSON không hợp lệ: ${e.message}`);
    }
    if (typeof item !== 'object' || Array.isArray(item) || !item) return toast('error', 'Item phải là một JSON object');
    const missing = keyNames.filter((k) => item[k] === undefined);
    if (missing.length) return toast('error', `Thiếu key attribute: ${missing.join(', ')}`);
    setSaving(true);
    try {
      // Nếu sửa key thì xóa item cũ để không bị nhân đôi
      if (editor.original && keyNames.some((k) => editor.original![k] !== item[k])) {
        await api.post(`/dynamodb/tables/${t}/items/delete`, { key: keyOf(editor.original) });
      }
      await api.put(`/dynamodb/tables/${t}/items`, { item });
      toast('success', 'Đã lưu item');
      setEditor(null);
      scan.reload();
    } catch (e) {
      notifyError(e);
    } finally {
      setSaving(false);
    }
  };

  const cell = (v: any) => (v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

  return (
    <>
      <PageHeader
        title={table}
        subtitle="Items (Scan)"
        actions={
          <>
            <button className="btn-normal" onClick={onBack}><ArrowLeft size={14} /> Tables</button>
            <button className="btn-normal" onClick={() => { desc.reload(); scan.reload(); }}><RefreshCw size={14} /> Refresh</button>
            <button
              className="btn-primary"
              onClick={() => setEditor({ text: JSON.stringify(Object.fromEntries(keyNames.map((k) => [k, ''])), null, 2) })}
            >
              <Plus size={14} /> Create item
            </button>
          </>
        }
      />

      {desc.data && (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={desc.data.status === 'ACTIVE' ? 'green' : 'orange'}>{desc.data.status}</Badge>
          {desc.data.keySchema.map((k) => (
            <Badge key={k.AttributeName} tone="blue">{k.KeyType === 'HASH' ? 'PK' : 'SK'}: {k.AttributeName}</Badge>
          ))}
          <span className="text-slate-500">{items.length} item(s){scan.data?.truncated && ' (đã giới hạn)'}</span>
          <div className="flex-1" />
          <div className="inline-flex overflow-hidden rounded-md border border-slate-300 dark:border-slate-600">
            {(['table', 'json'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1 text-xs font-bold ${view === v ? 'bg-brand text-white' : 'bg-transparent'}`}
              >
                {v === 'table' ? 'Table view' : 'JSON view'}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="card overflow-auto">
        {scan.loading && !scan.data ? (
          <div className="p-6"><Spinner /></div>
        ) : !items.length ? (
          <Empty text="Bảng chưa có item nào." />
        ) : view === 'json' ? (
          <JsonBlock value={items} className="max-h-[70vh] rounded-none" />
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c} className="th whitespace-nowrap">{c}{keyNames.includes(c) && ' 🔑'}</th>
                ))}
                <th className="th w-24" />
              </tr>
            </thead>
            <tbody>
              {items.map((it, idx) => (
                <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  {columns.map((c) => (
                    <td key={c} className="td max-w-xs truncate font-mono text-xs" title={cell(it[c])}>{cell(it[c])}</td>
                  ))}
                  <td className="td whitespace-nowrap text-right">
                    <button className="btn-icon" title="Edit" onClick={() => setEditor({ original: it, text: JSON.stringify(it, null, 2) })}>
                      <Pencil size={15} />
                    </button>
                    <button
                      className="btn-icon text-red-500"
                      title="Delete"
                      onClick={() =>
                        ask('Xóa item này?', async () => {
                          try {
                            await api.post(`/dynamodb/tables/${t}/items/delete`, { key: keyOf(it) });
                            toast('success', 'Đã xóa item');
                            scan.reload();
                          } catch (e) {
                            notifyError(e);
                          }
                        })
                      }
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editor && (
        <Modal
          title={editor.original ? 'Edit item' : 'Create item'}
          wide
          onClose={() => setEditor(null)}
          footer={
            <>
              <button className="btn-normal" onClick={() => setEditor(null)}>Hủy</button>
              <button className="btn-primary" disabled={saving} onClick={save}>{saving && <Spinner />} Save</button>
            </>
          }
        >
          <p className="mb-2 text-xs text-slate-500">
            JSON object dạng thường (DocumentClient tự chuyển kiểu). Bắt buộc có key: {keyNames.join(', ')}
          </p>
          <textarea
            className="input h-80 font-mono text-xs"
            spellCheck={false}
            value={editor.text}
            onChange={(e) => setEditor({ ...editor, text: e.target.value })}
          />
        </Modal>
      )}
      {dialog}
    </>
  );
}
