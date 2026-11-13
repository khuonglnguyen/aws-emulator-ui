import { useState } from 'react';
import { Download, Plus, RefreshCw, Send, Trash2, MessagesSquare } from 'lucide-react';
import { api } from '../api';
import { useApp, useLoad } from '../context';
import { Badge, Empty, Field, JsonBlock, Modal, PageHeader, Spinner, useConfirm } from '../components/ui';

interface Queue {
  url: string;
  name: string;
  fifo: boolean;
}
interface Msg {
  messageId: string;
  receiptHandle: string;
  body: string;
  attributes?: Record<string, string>;
}

export default function SqsPage() {
  const { toast, notifyError } = useApp();
  const { data, loading, reload } = useLoad<Queue[]>(() => api.get('/sqs/queues').then((r) => r.data));
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [fifo, setFifo] = useState(false);
  const [busy, setBusy] = useState(false);
  const { ask, dialog } = useConfirm();
  const queue = data?.find((q) => q.url === selected);

  const create = async () => {
    setBusy(true);
    try {
      const { data: r } = await api.post('/sqs/queues', { name, fifo });
      toast('success', 'Đã tạo queue');
      setCreating(false);
      setName('');
      setFifo(false);
      setSelected(r.url);
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
        title="Amazon SQS"
        subtitle="Queues"
        actions={
          <>
            <button className="btn-normal" onClick={reload}><RefreshCw size={14} /> Refresh</button>
            <button className="btn-primary" onClick={() => setCreating(true)}><Plus size={14} /> Create queue</button>
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <div className="card overflow-hidden self-start">
          {loading && !data ? (
            <div className="p-6"><Spinner /></div>
          ) : !data?.length ? (
            <Empty text="Chưa có queue nào." />
          ) : (
            <ul>
              {data.map((q) => (
                <li
                  key={q.url}
                  className={`flex cursor-pointer items-center gap-2 border-b border-slate-100 px-4 py-2.5 text-sm dark:border-slate-800 ${
                    selected === q.url ? 'bg-sky-50 dark:bg-sky-900/30' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }`}
                  onClick={() => setSelected(q.url)}
                >
                  <MessagesSquare size={15} className="shrink-0 text-pink-600" />
                  <span className="flex-1 truncate font-semibold" title={q.url}>{q.name}</span>
                  <Badge tone={q.fifo ? 'orange' : 'gray'}>{q.fifo ? 'FIFO' : 'Standard'}</Badge>
                  <button
                    className="btn-icon text-red-500"
                    onClick={(e) => {
                      e.stopPropagation();
                      ask(`Xóa queue "${q.name}"?`, async () => {
                        try {
                          await api.delete('/sqs/queue', { params: { url: q.url } });
                          toast('success', 'Đã xóa queue');
                          if (selected === q.url) setSelected(null);
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

        {queue ? <QueuePanel key={queue.url} queue={queue} /> : <div className="card"><Empty text="Chọn một queue để gửi / nhận tin nhắn." /></div>}
      </div>

      {creating && (
        <Modal
          title="Create queue"
          onClose={() => setCreating(false)}
          footer={
            <>
              <button className="btn-normal" onClick={() => setCreating(false)}>Hủy</button>
              <button className="btn-primary" disabled={!name.trim() || busy} onClick={create}>{busy && <Spinner />} Create</button>
            </>
          }
        >
          <Field label="Queue name" hint={fifo ? 'Hậu tố .fifo sẽ được tự thêm' : undefined}>
            <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value.trim())} />
          </Field>
          <div className="flex gap-4 text-sm">
            {[false, true].map((v) => (
              <label key={String(v)} className="flex items-center gap-2">
                <input type="radio" checked={fifo === v} onChange={() => setFifo(v)} /> {v ? 'FIFO' : 'Standard'}
              </label>
            ))}
          </div>
        </Modal>
      )}
      {dialog}
    </>
  );
}

function QueuePanel({ queue }: { queue: Queue }) {
  const { toast, notifyError } = useApp();
  const attrs = useLoad<Record<string, string>>(
    () => api.get('/sqs/queue/attributes', { params: { url: queue.url } }).then((r) => r.data),
    [queue.url],
  );
  const [body, setBody] = useState('{\n  "hello": "world"\n}');
  const [groupId, setGroupId] = useState('default');
  const [sending, setSending] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [polling, setPolling] = useState(false);

  const send = async () => {
    setSending(true);
    try {
      const { data } = await api.post('/sqs/queue/send', { url: queue.url, body, groupId });
      toast('success', `Đã gửi message ${data.messageId}`);
      attrs.reload();
    } catch (e) {
      notifyError(e);
    } finally {
      setSending(false);
    }
  };

  const poll = async () => {
    setPolling(true);
    try {
      const { data } = await api.post<Msg[]>('/sqs/queue/receive', { url: queue.url, max: 10, waitSeconds: 1 });
      setMsgs(data);
      if (!data.length) toast('info', 'Không có message nào');
      attrs.reload();
    } catch (e) {
      notifyError(e);
    } finally {
      setPolling(false);
    }
  };

  const del = async (m: Msg) => {
    try {
      await api.post('/sqs/queue/delete-message', { url: queue.url, receiptHandle: m.receiptHandle });
      setMsgs((x) => x.filter((y) => y.messageId !== m.messageId));
      toast('success', 'Đã xóa message');
      attrs.reload();
    } catch (e) {
      notifyError(e);
    }
  };

  const a = attrs.data;

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <h2 className="mb-1 font-bold">{queue.name}</h2>
        <p className="mb-3 break-all font-mono text-xs text-slate-500">{queue.url}</p>
        <div className="grid grid-cols-3 gap-3 text-center text-sm">
          {[
            ['Available', a?.ApproximateNumberOfMessages],
            ['In flight', a?.ApproximateNumberOfMessagesNotVisible],
            ['Delayed', a?.ApproximateNumberOfMessagesDelayed],
          ].map(([l, v]) => (
            <div key={l} className="rounded-md bg-slate-100 py-2 dark:bg-slate-800">
              <div className="text-xl font-bold">{v ?? '-'}</div>
              <div className="text-xs text-slate-500">{l}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card p-4">
        <h3 className="mb-2 font-bold">Send message</h3>
        <textarea className="input h-32 font-mono text-xs" spellCheck={false} value={body} onChange={(e) => setBody(e.target.value)} />
        {queue.fifo && (
          <div className="mt-2">
            <Field label="Message group ID"><input className="input" value={groupId} onChange={(e) => setGroupId(e.target.value)} /></Field>
          </div>
        )}
        <div className="mt-2">
          <button className="btn-primary" disabled={sending || !body} onClick={send}>
            {sending ? <Spinner /> : <Send size={14} />} Send
          </button>
        </div>
      </div>

      <div className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-bold">Receive messages</h3>
          <button className="btn-normal" disabled={polling} onClick={poll}>
            {polling ? <Spinner /> : <Download size={14} />} Poll messages
          </button>
        </div>
        <p className="mb-3 text-xs text-slate-500">
          Message nhận về sẽ ẩn trong 30 giây (visibility timeout); bấm Delete để xóa hẳn khỏi queue.
        </p>
        {!msgs.length ? (
          <Empty text="Chưa nhận message nào." />
        ) : (
          <ul className="space-y-2">
            {msgs.map((m) => (
              <li key={m.messageId} className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-mono text-xs text-slate-500">{m.messageId}</span>
                  <button className="btn-danger !px-3 !py-0.5 text-xs" onClick={() => del(m)}><Trash2 size={12} /> Delete</button>
                </div>
                <JsonBlock value={m.body} className="max-h-48 whitespace-pre-wrap break-all" />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
