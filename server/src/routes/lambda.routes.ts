import { Router } from 'express';
import type { Request, Response } from 'express';
import multer from 'multer';
import AdmZip from 'adm-zip';
import {
  ListFunctionsCommand,
  GetFunctionCommand,
  InvokeCommand,
  CreateFunctionCommand,
  UpdateFunctionCodeCommand,
  UpdateFunctionConfigurationCommand,
  DeleteFunctionCommand,
  waitUntilFunctionActiveV2,
  waitUntilFunctionUpdatedV2,
} from '@aws-sdk/client-lambda';
import { lambda, wrap } from '../aws';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

/** Function mới tạo/cập nhật ở trạng thái Pending/InProgress — chờ sẵn sàng như AWS thật */
async function waitReady(res: Response, name: string) {
  const input = { FunctionName: name };
  try {
    await waitUntilFunctionActiveV2({ client: lambda(res), maxWaitTime: 60 }, input);
    await waitUntilFunctionUpdatedV2({ client: lambda(res), maxWaitTime: 60 }, input);
  } catch {
    /* hết thời gian/thất bại: để thao tác kế tiếp báo lỗi thật */
  }
}

const DEFAULT_ROLE = 'arn:aws:iam::000000000000:role/lambda-role';

const bad = (msg: string) => Object.assign(new Error(msg), { statusCode: 400 });

function extOf(runtime: string): string {
  if (runtime.startsWith('python')) return '.py';
  if (runtime.startsWith('ruby')) return '.rb';
  if (runtime.startsWith('nodejs')) return '.js';
  throw bad(`Runtime "${runtime}" không hỗ trợ code inline — hãy tải lên file .zip`);
}

/** Lấy zip: ưu tiên file .zip tải lên, nếu không thì đóng gói code inline thành <handler-file>.<ext> */
function buildZip(req: Request, runtime: string, handler: string): Buffer | undefined {
  const file = (req as any).file as { buffer: Buffer } | undefined;
  if (file) return file.buffer;
  const code = String(req.body?.code ?? '');
  if (!code.trim()) return undefined;
  const zip = new AdmZip();
  zip.addFile(`${handler.split('.')[0] || 'index'}${extOf(runtime)}`, Buffer.from(code, 'utf8'));
  return zip.toBuffer();
}

function parseEnv(raw: unknown): Record<string, string> | undefined {
  if (raw == null || String(raw).trim() === '') return undefined;
  try {
    const o = JSON.parse(String(raw));
    if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error();
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)]));
  } catch {
    throw bad('Environment variables phải là JSON object, ví dụ {"KEY":"value"}');
  }
}

const summarize = (f: any) => ({
  name: f.FunctionName,
  arn: f.FunctionArn,
  runtime: f.Runtime,
  handler: f.Handler,
  memory: f.MemorySize,
  timeout: f.Timeout,
  state: f.State,
  lastModified: f.LastModified,
  codeSize: f.CodeSize,
  description: f.Description,
  role: f.Role,
  environment: f.Environment?.Variables || {},
});

router.get(
  '/functions',
  wrap(async (_req, res) => {
    const list: any[] = [];
    let marker: string | undefined;
    do {
      const out = await lambda(res).send(new ListFunctionsCommand({ Marker: marker }));
      list.push(...(out.Functions || []).map(summarize));
      marker = out.NextMarker;
    } while (marker);
    res.json(list);
  }),
);

router.get(
  '/functions/:name',
  wrap(async (req, res) => {
    const out = await lambda(res).send(new GetFunctionCommand({ FunctionName: req.params.name }));
    res.json(summarize(out.Configuration));
  }),
);

router.post(
  '/functions',
  upload.single('zip'),
  wrap(async (req, res) => {
    const b = req.body || {};
    const name = String(b.name ?? '').trim();
    const runtime = String(b.runtime ?? '').trim();
    const handler = String(b.handler ?? '').trim();
    if (!name || !runtime || !handler) throw bad('Cần nhập Function name, Runtime và Handler');
    const zip = buildZip(req, runtime, handler);
    if (!zip) throw bad('Cần nhập code hoặc tải lên file .zip');
    const out = await lambda(res).send(
      new CreateFunctionCommand({
        FunctionName: name,
        Runtime: runtime as any,
        Handler: handler,
        Role: String(b.role || '').trim() || DEFAULT_ROLE,
        Code: { ZipFile: zip },
        MemorySize: Number(b.memory) || 128,
        Timeout: Number(b.timeout) || 3,
        Description: String(b.description ?? '') || undefined,
        Environment: parseEnv(b.env) ? { Variables: parseEnv(b.env) } : undefined,
      }),
    );
    await waitReady(res, name);
    const fresh = await lambda(res).send(new GetFunctionCommand({ FunctionName: name }));
    res.json(summarize(fresh.Configuration ?? out));
  }),
);

/** Cập nhật cấu hình và (tuỳ chọn) code — chỉ gửi những gì được cung cấp */
router.put(
  '/functions/:name',
  upload.single('zip'),
  wrap(async (req, res) => {
    const b = req.body || {};
    const name = req.params.name;
    const runtime = String(b.runtime ?? '').trim();
    const handler = String(b.handler ?? '').trim();
    const zip = runtime && handler ? buildZip(req, runtime, handler) : (req as any).file?.buffer;
    await waitReady(res, name);
    if (zip) {
      await lambda(res).send(new UpdateFunctionCodeCommand({ FunctionName: name, ZipFile: zip }));
      await waitReady(res, name);
    }
    const env = parseEnv(b.env);
    const out = await lambda(res).send(
      new UpdateFunctionConfigurationCommand({
        FunctionName: name,
        Runtime: runtime ? (runtime as any) : undefined,
        Handler: handler || undefined,
        Role: String(b.role ?? '').trim() || undefined,
        MemorySize: b.memory ? Number(b.memory) : undefined,
        Timeout: b.timeout ? Number(b.timeout) : undefined,
        Description: b.description != null ? String(b.description) : undefined,
        Environment: env ? { Variables: env } : undefined,
      }),
    );
    await waitReady(res, name);
    res.json(summarize(out));
  }),
);

router.delete(
  '/functions/:name',
  wrap(async (req, res) => {
    await lambda(res).send(new DeleteFunctionCommand({ FunctionName: req.params.name }));
    res.json({ ok: true });
  }),
);

router.post(
  '/functions/:name/invoke',
  wrap(async (req, res) => {
    const payload = req.body?.payload;
    await waitReady(res, req.params.name);
    const started = Date.now();
    const out = await lambda(res).send(
      new InvokeCommand({
        FunctionName: req.params.name,
        Payload: Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload ?? {})),
        LogType: 'Tail',
      }),
    );
    const raw = out.Payload ? Buffer.from(out.Payload).toString('utf8') : '';
    let result: unknown = raw;
    try {
      result = raw ? JSON.parse(raw) : null;
    } catch {
      /* giữ nguyên chuỗi */
    }
    res.json({
      statusCode: out.StatusCode,
      functionError: out.FunctionError || null,
      executedVersion: out.ExecutedVersion,
      durationMs: Date.now() - started,
      result,
      logs: out.LogResult ? Buffer.from(out.LogResult, 'base64').toString('utf8') : '',
    });
  }),
);

export default router;
