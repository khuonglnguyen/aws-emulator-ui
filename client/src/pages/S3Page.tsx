import { useRef, useState } from 'react';
import { ArrowLeft, Download, Eye, Plus, Trash2, Upload, RefreshCw, HardDrive } from 'lucide-react';
import { api, errMsg, fmtBytes, fmtDate } from '../api';
import { useApp, useLoad } from '../context';
import { Empty, Field, Modal, PageHeader, Spinner, useConfirm, JsonBlock } from '../components/ui';

interface Bucket {
  name: string;
  createdAt?: string;
}
interface Obj {
  key: string;
  size: number;
  lastModified?: string;
}

const IMG = /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i;
const TEXT = /\.(txt|json|md|csv|log|xml|html?|css|js|ts|yml|yaml|ini|env|sql|sh|py)$/i;

export default function S3Page() {
  const [bucket, setBucket] = useState<string | null>(null);
  return bucket ? <Objects bucket={bucket} onBack={() => setBucket(null)} /> : <Buckets onOpen={setBucket} />;
}

function Buckets({ onOpen }: { onOpen: (b: string) => void }) {
  const { toast, notifyError } = useApp();
  const { data, loading, reload } = useLoad<Bucket[]>(() => api.get('/s3/buckets').then((r) => r.data));
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const { ask, dialog } = useConfirm();

  const create = async () => {
    setBusy(true);
    try {
      await api.post('/s3/buckets', { name });
      toast('success', `Đã tạo bucket "${name}"`);
      setCreating(false);
      setName('');
      reload();
    } catch (e) {
      notifyError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Amazon S3"
        subtitle="Buckets"
        actions={
          <>
            <button className="btn-normal" onClick={reload}>
              <RefreshCw size={14} /> Refresh
            </button>
            <button className="btn-primary" onClick={() => setCreating(true)}>
              <Plus size={14} /> Create bucket
            </button>
          </>
        }
      />
      <div className="card overflow-hidden">
        {loading && !data ? (
          <div className="p-6"><Spinner /></div>
        ) : !data?.length ? (
          <Empty text="Chưa có bucket nào." />
        ) : (
          <table className="w-full">
            <thead>
              <tr><th className="th">Name</th><th className="th">Created</th><th className="th w-20" /></tr>
            </thead>
            <tbody>
              {data.map((b) => (
                <tr key={b.name} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="td">
                    <button className="flex items-center gap-2 font-semibold text-brand hover:underline dark:text-sky-400" onClick={() => onOpen(b.name)}>
                      <HardDrive size={15} /> {b.name}
                    </button>
                  </td>
                  <td className="td">{fmtDate(b.createdAt)}</td>
                  <td className="td text-right">
                    <button
                      className="btn-icon text-red-500"
                      title="Delete bucket"
                      onClick={() =>
                        ask(`Xóa bucket "${b.name}" và toàn bộ file bên trong?`, async () => {
                          try {
                            await api.delete(`/s3/buckets/${encodeURIComponent(b.name)}`);
                            toast('success', `Đã xóa bucket "${b.name}"`);
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
          title="Create bucket"
          onClose={() => setCreating(false)}
          footer={
            <>
              <button className="btn-normal" onClick={() => setCreating(false)}>Hủy</button>
              <button className="btn-primary" disabled={!name.trim() || busy} onClick={create}>
                {busy && <Spinner />} Create
              </button>
            </>
          }
        >
          <Field label="Bucket name" hint="Chữ thường, số, dấu gạch ngang; 3–63 ký tự">
            <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value.trim())} onKeyDown={(e) => e.key === 'Enter' && name && create()} />
          </Field>
        </Modal>
      )}
      {dialog}
    </>
  );
}

function Objects({ bucket, onBack }: { bucket: string; onBack: () => void }) {
  const { toast, notifyError } = useApp();
  const { data, loading, reload } = useLoad<Obj[]>(
    () => api.get(`/s3/buckets/${encodeURIComponent(bucket)}/objects`).then((r) => r.data),
    [bucket],
  );
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<{ key: string; kind: 'img' | 'text' | 'none'; url?: string; text?: string } | null>(null);
  const { ask, dialog } = useConfirm();
  const base = `/s3/buckets/${encodeURIComponent(bucket)}/object`;

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    const fd = new FormData();
    Array.from(files).forEach((f) => fd.append('file', f));
    setUploading(true);
    try {
      await api.post(`/s3/buckets/${encodeURIComponent(bucket)}/objects`, fd);
      toast('success', `Đã upload ${files.length} file`);
      reload();
    } catch (e) {
      notifyError(e);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const download = async (key: string) => {
    try {
      const { data: blob } = await api.get(base, { params: { key, download: 1 }, responseType: 'blob' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = key.split('/').pop() || 'file';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      notifyError(e);
    }
  };

  const openPreview = async (key: string) => {
    try {
      const { data: blob } = await api.get<Blob>(base, { params: { key }, responseType: 'blob' });
      if (IMG.test(key) || blob.type.startsWith('image/')) {
        setPreview({ key, kind: 'img', url: URL.createObjectURL(blob) });
      } else if (TEXT.test(key) || blob.type.startsWith('text/') || blob.type.includes('json')) {
        let text = await blob.text();
        if (/\.json$/i.test(key) || blob.type.includes('json')) {
          try { text = JSON.stringify(JSON.parse(text), null, 2); } catch { /* giữ nguyên */ }
        }
        setPreview({ key, kind: 'text', text: text.length > 200_000 ? text.slice(0, 200_000) + '\n…(đã cắt bớt)' : text });
      } else {
        setPreview({ key, kind: 'none' });
      }
    } catch (e) {
      notifyError(e);
    }
  };

  const closePreview = () => {
    if (preview?.url) URL.revokeObjectURL(preview.url);
    setPreview(null);
  };

  return (
    <>
      <PageHeader
        title={bucket}
        subtitle="Objects"
        actions={
          <>
            <button className="btn-normal" onClick={onBack}><ArrowLeft size={14} /> Buckets</button>
            <button className="btn-normal" onClick={reload}><RefreshCw size={14} /> Refresh</button>
            <input ref={fileRef} type="file" multiple hidden onChange={(e) => upload(e.target.files)} />
            <button className="btn-primary" disabled={uploading} onClick={() => fileRef.current?.click()}>
              {uploading ? <Spinner /> : <Upload size={14} />} Upload
            </button>
          </>
        }
      />
      <div className="card overflow-hidden">
        {loading && !data ? (
          <div className="p-6"><Spinner /></div>
        ) : !data?.length ? (
          <Empty text="Bucket trống. Hãy upload file." />
        ) : (
          <table className="w-full">
            <thead>
              <tr><th className="th">Key</th><th className="th">Size</th><th className="th">Last modified</th><th className="th w-32" /></tr>
            </thead>
            <tbody>
              {data.map((o) => (
                <tr key={o.key} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <td className="td break-all font-mono text-xs">{o.key}</td>
                  <td className="td whitespace-nowrap">{fmtBytes(o.size)}</td>
                  <td className="td whitespace-nowrap">{fmtDate(o.lastModified)}</td>
                  <td className="td whitespace-nowrap text-right">
                    <button className="btn-icon" title="Preview" onClick={() => openPreview(o.key)}><Eye size={16} /></button>
                    <button className="btn-icon" title="Download" onClick={() => download(o.key)}><Download size={16} /></button>
                    <button
                      className="btn-icon text-red-500"
                      title="Delete"
                      onClick={() =>
                        ask(`Xóa object "${o.key}"?`, async () => {
                          try {
                            await api.delete(base, { params: { key: o.key } });
                            toast('success', 'Đã xóa object');
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

      {preview && (
        <Modal title={preview.key} wide onClose={closePreview}>
          {preview.kind === 'img' && <img src={preview.url} alt={preview.key} className="mx-auto max-h-[65vh]" />}
          {preview.kind === 'text' && <JsonBlock value={preview.text ?? ''} className="max-h-[65vh] whitespace-pre-wrap break-all" />}
          {preview.kind === 'none' && <Empty text="Không hỗ trợ xem trước định dạng này. Hãy tải xuống." />}
        </Modal>
      )}
      {dialog}
    </>
  );
}

// errMsg re-export tránh cảnh báo import không dùng ở một số cấu hình lint
export { errMsg };
