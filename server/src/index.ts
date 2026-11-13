import express from 'express';
import cors from 'cors';
import { ListBucketsCommand } from '@aws-sdk/client-s3';
import { ListTablesCommand } from '@aws-sdk/client-dynamodb';
import { ListQueuesCommand } from '@aws-sdk/client-sqs';
import { ListFunctionsCommand } from '@aws-sdk/client-lambda';
import { awsContext, errorHandler, isUnreachable, s3, dynamo, sqs, lambda, wrap, ctxOf } from './aws';
import s3Routes from './routes/s3.routes';
import dynamoRoutes from './routes/dynamodb.routes';
import sqsRoutes from './routes/sqs.routes';
import lambdaRoutes from './routes/lambda.routes';
import infraRoutes, { infraCounts } from './routes/infra.routes';

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use('/api', awsContext);

// Kiểm tra kết nối: chỉ cần emulator trả lời HTTP (kể cả lỗi dịch vụ) là "connected"
app.get(
  '/api/health',
  wrap(async (_req, res) => {
    const { endpoint, region } = ctxOf(res);
    try {
      await s3(res).send(new ListBucketsCommand({}));
      res.json({ connected: true, endpoint, region });
    } catch (err: any) {
      if (isUnreachable(err)) {
        return res.json({ connected: false, endpoint, region, error: err?.message });
      }
      res.json({ connected: true, endpoint, region, warning: err?.message });
    }
  }),
);

// Tổng quan: đếm tài nguyên (mỗi dịch vụ độc lập)
app.get(
  '/api/overview',
  wrap(async (_req, res) => {
    const count = async (fn: () => Promise<number>) => {
      try {
        return { count: await fn() };
      } catch (e: any) {
        return { count: 0, error: e?.message };
      }
    };
    const [s3c, ddb, sqsc, lam] = await Promise.all([
      count(async () => ((await s3(res).send(new ListBucketsCommand({}))).Buckets || []).length),
      count(async () => ((await dynamo(res).send(new ListTablesCommand({}))).TableNames || []).length),
      count(async () => ((await sqs(res).send(new ListQueuesCommand({}))).QueueUrls || []).length),
      count(async () => ((await lambda(res).send(new ListFunctionsCommand({}))).Functions || []).length),
    ]);
    const all = [s3c, ddb, sqsc, lam];
    if (all.every((r) => r.error) && all.some((r) => /connect|ECONN|ENOTFOUND/i.test(r.error || ''))) {
      return res.status(503).json({
        error: `Không kết nối được tới AWS Emulator (${ctxOf(res).endpoint}). Hãy chắc chắn emulator đang chạy.`,
        unreachable: true,
      });
    }
    res.json({ s3: s3c, dynamodb: ddb, sqs: sqsc, lambda: lam, infra: await infraCounts(res) });
  }),
);

app.use('/api/s3', s3Routes);
app.use('/api/dynamodb', dynamoRoutes);
app.use('/api/sqs', sqsRoutes);
app.use('/api/lambda', lambdaRoutes);
app.use('/api/infra', infraRoutes);

app.use(errorHandler);

const port = Number(process.env.PORT) || 3001;
app.listen(port, () => console.log(`[server] API proxy chạy tại http://127.0.0.1:${port}`));
