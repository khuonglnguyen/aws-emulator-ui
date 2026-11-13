import { ReactNode, useState } from 'react';
import { X, Loader2 } from 'lucide-react';

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={onClose}>
      <div
        className={`card flex max-h-[90vh] w-full flex-col ${wide ? 'max-w-3xl' : 'max-w-lg'}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 dark:border-slate-700">
          <h3 className="text-lg font-bold">{title}</h3>
          <button className="btn-icon" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-5">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3 dark:border-slate-700">{footer}</div>
        )}
      </div>
    </div>
  );
}

export const Spinner = ({ size = 16 }: { size?: number }) => <Loader2 size={size} className="animate-spin" />;

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-sm font-semibold">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap gap-2">{actions}</div>
    </div>
  );
}

export const Empty = ({ text }: { text: string }) => (
  <div className="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-400">{text}</div>
);

export const Badge = ({ children, tone = 'gray' }: { children: ReactNode; tone?: 'gray' | 'green' | 'blue' | 'orange' }) => {
  const t = {
    gray: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
    green: 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-300',
    blue: 'bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-300',
    orange: 'bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-300',
  }[tone];
  return <span className={`rounded px-2 py-0.5 text-xs font-semibold ${t}`}>{children}</span>;
};

/** Hook xác nhận xóa: trả về [confirm(), dialog] */
export function useConfirm() {
  const [state, setState] = useState<{ text: string; run: () => Promise<void> } | null>(null);
  const [busy, setBusy] = useState(false);
  const ask = (text: string, run: () => Promise<void>) => setState({ text, run });
  const dialog = state && (
    <Modal
      title="Xác nhận"
      onClose={() => setState(null)}
      footer={
        <>
          <button className="btn-normal" onClick={() => setState(null)}>
            Hủy
          </button>
          <button
            className="btn-danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await state.run();
              } finally {
                setBusy(false);
                setState(null);
              }
            }}
          >
            {busy && <Spinner />} Xóa
          </button>
        </>
      }
    >
      <p className="text-sm">{state.text}</p>
    </Modal>
  );
  return { ask, dialog };
}

export const JsonBlock = ({ value, className = '' }: { value: unknown; className?: string }) => (
  <pre
    className={`overflow-auto rounded-md bg-slate-100 p-3 font-mono text-xs dark:bg-[#0d1621] ${className}`}
  >
    {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
  </pre>
);
