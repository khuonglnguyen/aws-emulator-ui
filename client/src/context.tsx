import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { CheckCircle2, XCircle, Info, X } from 'lucide-react';
import { api, errMsg, loadSettings, saveSettings, EmulatorSettings } from './api';

type ToastKind = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

interface Ctx {
  settings: EmulatorSettings;
  updateSettings: (s: EmulatorSettings) => void;
  connected: boolean | null; // null = đang kiểm tra
  checkHealth: () => Promise<void>;
  refreshKey: number;
  refreshAll: () => void;
  toast: (kind: ToastKind, text: string) => void;
  notifyError: (e: unknown) => Promise<void>;
  dark: boolean;
  toggleDark: () => void;
}

const AppCtx = createContext<Ctx>(null as any);
export const useApp = () => useContext(AppCtx);

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<EmulatorSettings>(loadSettings);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const lastErr = useRef({ text: '', at: 0 });
  const seq = useRef(0);

  const toast = useCallback((kind: ToastKind, text: string) => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3500);
  }, []);

  // Tránh spam cùng một lỗi nhiều lần (nhiều request song song cùng lỗi kết nối)
  const notifyError = useCallback(
    async (e: unknown) => {
      const text = await errMsg(e);
      const now = Date.now();
      if (lastErr.current.text === text && now - lastErr.current.at < 3000) return;
      lastErr.current = { text, at: now };
      toast('error', text);
    },
    [toast],
  );

  const checkHealth = useCallback(async () => {
    try {
      const { data } = await api.get('/health', { timeout: 8000 });
      setConnected(!!data.connected);
    } catch {
      setConnected(false);
    }
  }, []);

  const updateSettings = (s: EmulatorSettings) => {
    saveSettings(s);
    setSettings(s);
    setConnected(null);
    // header mới có hiệu lực ngay (interceptor đọc localStorage), sau đó tải lại dữ liệu
    setTimeout(() => {
      checkHealth();
      setRefreshKey((k) => k + 1);
    }, 0);
  };

  const refreshAll = () => {
    checkHealth();
    setRefreshKey((k) => k + 1);
  };

  const toggleDark = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('theme', next ? 'dark' : 'light');
    } catch {
      /* ignore */
    }
  };

  // Poll trạng thái kết nối định kỳ
  useEffect(() => {
    checkHealth();
    const t = setInterval(checkHealth, 10000);
    return () => clearInterval(t);
  }, [checkHealth]);

  // Khi chuyển từ mất kết nối -> kết nối lại thì tự động tải lại dữ liệu
  const prev = useRef<boolean | null>(null);
  useEffect(() => {
    if (prev.current === false && connected === true) {
      toast('info', 'Đã kết nối lại AWS Emulator — đang đồng bộ dữ liệu');
      setRefreshKey((k) => k + 1);
    }
    if (connected !== null) prev.current = connected;
  }, [connected, toast]);

  const icon = { success: CheckCircle2, error: XCircle, info: Info };
  const color = {
    success: 'border-green-500 text-green-700 dark:text-green-400',
    error: 'border-red-500 text-red-700 dark:text-red-400',
    info: 'border-sky-500 text-sky-700 dark:text-sky-400',
  };

  return (
    <AppCtx.Provider
      value={{ settings, updateSettings, connected, checkHealth, refreshKey, refreshAll, toast, notifyError, dark, toggleDark }}
    >
      {children}
      <div className="fixed right-4 top-16 z-[100] flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2">
        {toasts.map((t) => {
          const Icon = icon[t.kind];
          return (
            <div
              key={t.id}
              className={`flex items-start gap-2 rounded-md border-l-4 bg-white p-3 text-sm shadow-lg dark:bg-[#1d2b3c] ${color[t.kind]}`}
            >
              <Icon size={18} className="mt-0.5 shrink-0" />
              <span className="flex-1 break-words text-slate-800 dark:text-slate-100">{t.text}</span>
              <button onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </AppCtx.Provider>
  );
}

/** Hook tải dữ liệu, tự tải lại khi bấm "Refresh All" hoặc khi deps đổi */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = [], enabled = true) {
  const { refreshKey, notifyError } = useApp();
  const [data, setData] = useState<T | undefined>();
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setLoading(true);
    fnRef
      .current()
      .then((d) => alive && setData(d))
      .catch((e) => {
        if (alive) {
          setData(undefined);
          notifyError(e);
        }
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, tick, enabled, ...deps]);

  return { data, loading, reload: () => setTick((t) => t + 1) };
}
