import { Router } from 'express';
import multer from 'multer';
import { Readable } from 'stream';
import {
  ListBucketsCommand,
  CreateBucketCommand,
  DeleteBucketCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  DeleteObjectCommand,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { s3, wrap } from '../aws';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

// Liệt kê buckets
router.get(
  '/buckets',
  wrap(async (_req, res) => {
    const out = await s3(res).send(new ListBucketsCommand({}));
    res.json((out.Buckets || []).map((b) => ({ name: b.Name, createdAt: b.CreationDate })));
  }),
);

// Tạo bucket
router.post(
  '/buckets',
  wrap(async (req, res) => {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Thiếu tên bucket' });
    await s3(res).send(new CreateBucketCommand({ Bucket: name }));
    res.status(201).json({ name });
  }),
);

// Xóa bucket (xóa sạch objects trước)
router.delete(
  '/buckets/:bucket',
  wrap(async (req, res) => {
    const client = s3(res);
    const Bucket = req.params.bucket;
    let token: string | undefined;
    do {
      const page = await client.send(new ListObjectsV2Command({ Bucket, ContinuationToken: token }));
      const objs = (page.Contents || []).map((o) => ({ Key: o.Key! }));
      if (objs.length) {
        await client.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: objs, Quiet: true } }));
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    await client.send(new DeleteBucketCommand({ Bucket }));
    res.json({ ok: true });
  }),
);

// Liệt kê objects
router.get(
  '/buckets/:bucket/objects',
  wrap(async (req, res) => {
    const Bucket = req.params.bucket;
    const prefix = typeof req.query.prefix === 'string' ? req.query.prefix : undefined;
    const items: any[] = [];
    let token: string | undefined;
    do {
      const page = await s3(res).send(
        new ListObjectsV2Command({ Bucket, Prefix: prefix, ContinuationToken: token }),
      );
      for (const o of page.Contents || []) {
        items.push({ key: o.Key, size: o.Size, lastModified: o.LastModified, etag: o.ETag });
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    res.json(items);
  }),
);

// Upload (multipart, field "file", có thể nhiều file; optional field "prefix")
router.post(
  '/buckets/:bucket/objects',
  upload.array('file'),
  wrap(async (req, res) => {
    const Bucket = req.params.bucket;
    const files = (req.files as Express.Multer.File[]) || [];
    if (!files.length) return res.status(400).json({ error: 'Chưa chọn file nào' });
    const prefix = String(req.body?.prefix || '');
    for (const f of files) {
      // multer đọc tên file theo latin1 -> chuyển lại sang utf8
      const name = Buffer.from(f.originalname, 'latin1').toString('utf8');
      await s3(res).send(
        new PutObjectCommand({
          Bucket,
          Key: prefix + name,
          Body: f.buffer,
          ContentType: f.mimetype,
        }),
      );
    }
    res.status(201).json({ uploaded: files.length });
  }),
);

// Lấy nội dung object (preview hoặc download=1)
router.get(
  '/buckets/:bucket/object',
  wrap(async (req, res) => {
    const Key = String(req.query.key || '');
    if (!Key) return res.status(400).json({ error: 'Thiếu key' });
    const out = await s3(res).send(new GetObjectCommand({ Bucket: req.params.bucket, Key }));
    res.setHeader('Content-Type', out.ContentType || 'application/octet-stream');
    if (out.ContentLength != null) res.setHeader('Content-Length', String(out.ContentLength));
    if (req.query.download === '1') {
      const fname = encodeURIComponent(Key.split('/').pop() || 'file');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${fname}`);
    }
    const body = out.Body as Readable;
    body.on('error', () => res.destroy());
    body.pipe(res);
  }),
);

// Xóa object
router.delete(
  '/buckets/:bucket/object',
  wrap(async (req, res) => {
    const Key = String(req.query.key || '');
    await s3(res).send(new DeleteObjectCommand({ Bucket: req.params.bucket, Key }));
    res.json({ ok: true });
  }),
);

export default router;
