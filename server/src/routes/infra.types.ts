import type { Response } from 'express';

/** Một hàng phẳng của bảng: `{ id, ...cột, raw }` */
export type Row = { id: string; raw: unknown; [k: string]: unknown };

export interface Field {
  key: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  multiline?: boolean;
  options?: string[];
  /** Giá trị mẫu điền sẵn (payload mẫu hợp lệ) */
  default?: string;
  /** Gợi ý ngắn hiện dưới ô nhập */
  hint?: string;
}

/**
 * Thao tác đặc trưng của dịch vụ (ngoài tạo / xóa).
 * scope 'row': chạy trên 1 dòng (id = row.id); scope 'resource': chạy ở mức resource (id = '').
 */
export interface Action {
  id: string;
  label: string;
  scope?: 'row' | 'resource';
  description?: string;
  fields?: Field[];
  danger?: boolean;
  /** Mẫu lệnh AWS CLI tương đương. {id} = row.id, {tênField} = giá trị đang nhập */
  cli?: string;
  run: (res: Response, id: string, body: Record<string, string>) => Promise<unknown>;
}

export interface Resource {
  id: string;
  label: string;
  /** Giải thích: resource này là gì, dùng khi nào */
  description?: string;
  /** Lệnh AWS CLI tương đương cho thao tác liệt kê */
  listCli?: string;
  columns: { key: string; label: string }[];
  list: (res: Response) => Promise<Row[]>;
  create?: {
    fields: Field[];
    cli?: string;
    /** true: hiển thị kết quả trả về (vd: key pair, access key) */
    showResult?: boolean;
    run: (res: Response, body: Record<string, string>) => Promise<unknown>;
  };
  remove?: (res: Response, id: string) => Promise<unknown>;
  removeCli?: string;
  actions?: Action[];
}

export interface Service {
  id: string;
  label: string;
  /** Dịch vụ này dùng để làm gì (1–2 câu) */
  description?: string;
  /** Khái niệm chính developer cần biết */
  concepts?: string[];
  resources: Resource[];
}

export const bad = (message: string) => Object.assign(new Error(message), { statusCode: 400 });
export const date = (d?: Date | string) => (d ? new Date(d).toISOString() : '');
export const chunk = <T,>(a: T[], n: number) =>
  Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
export const tail = (s?: string) => (s ? s.split(/[/:]/).pop() : s);
export const num = (s: string | undefined, def: number) => {
  const n = Number(s);
  return Number.isFinite(n) && s !== undefined && s !== '' ? n : def;
};
export const csv = (s?: string) =>
  (s ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
export const json = (s: string, what: string) => {
  try {
    return JSON.parse(s);
  } catch {
    throw bad(`${what} không phải JSON hợp lệ`);
  }
};
