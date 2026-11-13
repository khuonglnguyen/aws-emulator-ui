import axios from 'axios';

export interface EmulatorSettings {
  endpoint: string;
  region: string;
}

export const DEFAULT_SETTINGS: EmulatorSettings = {
  endpoint: 'https://127.0.0.1:9297',
  region: 'us-east-1',
};

const KEY = 'emulator-settings';

export function loadSettings(): EmulatorSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return DEFAULT_SETTINGS;
}

export function saveSettings(s: EmulatorSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export const api = axios.create({ baseURL: '/api' });

// Gửi kèm cấu hình emulator trong mỗi request
api.interceptors.request.use((cfg) => {
  const s = loadSettings();
  cfg.headers.set('x-aws-endpoint', s.endpoint);
  cfg.headers.set('x-aws-region', s.region);
  return cfg;
});

/** Trích thông điệp lỗi dễ đọc từ lỗi axios (kể cả khi response là Blob) */
export async function errMsg(e: any): Promise<string> {
  let data = e?.response?.data;
  if (data instanceof Blob) {
    try {
      data = JSON.parse(await data.text());
    } catch {
      data = undefined;
    }
  }
  if (data?.error) return data.error;
  if (e?.code === 'ERR_NETWORK') return 'Không kết nối được tới backend (http://127.0.0.1:3001). Hãy chạy `npm run dev`.';
  return e?.message || 'Đã xảy ra lỗi không xác định';
}

export const fmtBytes = (n?: number) => {
  if (n == null) return '-';
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB'];
  let i = -1;
  do {
    n /= 1024;
    i++;
  } while (n >= 1024 && i < u.length - 1);
  return `${n.toFixed(1)} ${u[i]}`;
};

export const fmtDate = (d?: string) => (d ? new Date(d).toLocaleString() : '-');
