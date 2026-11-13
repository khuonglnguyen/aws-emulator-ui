import https from 'https';
import http from 'http';
import path from 'path';
import os from 'os';
import fs from 'fs';
import dotenv from 'dotenv';
import type { Request, Response, NextFunction } from 'express';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { S3Client } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { SQSClient } from '@aws-sdk/client-sqs';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { CloudWatchLogsClient } from '@aws-sdk/client-cloudwatch-logs';
import { SFNClient } from '@aws-sdk/client-sfn';
import { APIGatewayClient } from '@aws-sdk/client-api-gateway';
import { ApiGatewayV2Client } from '@aws-sdk/client-apigatewayv2';
import { EventBridgeClient } from '@aws-sdk/client-eventbridge';
import { SNSClient } from '@aws-sdk/client-sns';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { SSMClient } from '@aws-sdk/client-ssm';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { KMSClient } from '@aws-sdk/client-kms';
import { CodeBuildClient } from '@aws-sdk/client-codebuild';
import { CodePipelineClient } from '@aws-sdk/client-codepipeline';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Chấp nhận chứng chỉ self-signed của AWS Emulator
const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const httpAgent = new http.Agent();

export interface AwsCtx {
  endpoint: string;
  region: string;
}

/** Đọc cấu hình động từ header x-aws-endpoint / x-aws-region (fallback về .env) */
export function awsContext(req: Request, res: Response, next: NextFunction) {
  const endpoint =
    (req.header('x-aws-endpoint') || process.env.AWS_ENDPOINT_URL || 'https://127.0.0.1:9297').trim();
  const region = (req.header('x-aws-region') || process.env.AWS_REGION || 'us-east-1').trim();
  res.locals.aws = { endpoint, region } as AwsCtx;
  next();
}

const cache = new Map<string, unknown>();

/**
 * Emulator bật "request authentication" và tự sinh credential vào
 * ~/.aws/emulator/<port>/emulator_credentials. Đọc file này mỗi request (có cache theo mtime)
 * nên khi emulator restart và sinh key mới thì không cần restart server.
 * Ghi đè đường dẫn bằng EMULATOR_CREDENTIALS_FILE; nếu không có file thì dùng AWS_* trong .env.
 */
function credentialsFile(endpoint: string): string {
  if (process.env.EMULATOR_CREDENTIALS_FILE) return process.env.EMULATOR_CREDENTIALS_FILE;
  let port = '';
  try {
    port = new URL(endpoint).port;
  } catch {
    /* ignore */
  }
  return path.join(os.homedir(), '.aws', 'emulator', port, 'emulator_credentials');
}

interface Creds {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

const credCache = new Map<string, { mtime: number; creds: Creds }>();

/** Chấp nhận JSON hoặc dạng key=value / key: value (INI kiểu AWS credentials) */
function parseCredentials(text: string): Creds | null {
  const map: Record<string, string> = {};
  try {
    const j = JSON.parse(text);
    for (const [k, v] of Object.entries(j.Credentials ?? j)) if (typeof v === 'string') map[k.toLowerCase().replace(/[^a-z]/g, '')] = v;
  } catch {
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_ ]+?)\s*[=:]\s*"?([^"\r\n]*?)"?\s*$/);
      if (m) map[m[1].toLowerCase().replace(/[^a-z]/g, '')] = m[2];
    }
  }
  const accessKeyId = map.awsaccesskeyid || map.accesskeyid || map.accesskey;
  const secretAccessKey = map.awssecretaccesskey || map.secretaccesskey || map.secretkey;
  if (!accessKeyId || !secretAccessKey) return null;
  return { accessKeyId, secretAccessKey, sessionToken: map.awssessiontoken || map.sessiontoken || undefined };
}

function loadCredentials(endpoint: string): Creds {
  const file = credentialsFile(endpoint);
  try {
    const mtime = fs.statSync(file).mtimeMs;
    const hit = credCache.get(file);
    if (hit && hit.mtime === mtime) return hit.creds;
    const creds = parseCredentials(fs.readFileSync(file, 'utf8'));
    if (creds) {
      credCache.set(file, { mtime, creds });
      return creds;
    }
    console.warn(`[server] Không đọc được access key từ ${file} (định dạng lạ) — dùng AWS_* trong .env`);
  } catch {
    /* không có file -> fallback */
  }
  return {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
    sessionToken: process.env.AWS_SESSION_TOKEN || undefined,
  };
}

function baseConfig(ctx: AwsCtx) {
  return {
    endpoint: ctx.endpoint,
    region: ctx.region,
    credentials: async () => loadCredentials(ctx.endpoint),
    requestHandler: new NodeHttpHandler({
      httpsAgent,
      httpAgent,
      connectionTimeout: 4000,
      requestTimeout: 60000,
    }) as any,
  };
}

function memo<T>(kind: string, ctx: AwsCtx, make: () => T): T {
  const key = `${kind}|${ctx.endpoint}|${ctx.region}`;
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key) as T;
}

export const ctxOf = (res: Response): AwsCtx => res.locals.aws;

export const s3 = (res: Response) =>
  memo('s3', ctxOf(res), () => new S3Client({ ...baseConfig(ctxOf(res)), forcePathStyle: true }));

export const dynamo = (res: Response) =>
  memo('ddb', ctxOf(res), () => new DynamoDBClient(baseConfig(ctxOf(res))));

export const docClient = (res: Response) =>
  memo('ddbdoc', ctxOf(res), () =>
    DynamoDBDocumentClient.from(dynamo(res), {
      marshallOptions: { removeUndefinedValues: true, convertEmptyValues: false },
    }),
  );

export const sqs = (res: Response) =>
  memo('sqs', ctxOf(res), () => new SQSClient(baseConfig(ctxOf(res))));

export const lambda = (res: Response) =>
  memo('lambda', ctxOf(res), () => new LambdaClient(baseConfig(ctxOf(res))));

export const codebuild = (res: Response) =>
  memo('cb', ctxOf(res), () => new CodeBuildClient(baseConfig(ctxOf(res))));
export const codepipeline = (res: Response) =>
  memo('cp', ctxOf(res), () => new CodePipelineClient(baseConfig(ctxOf(res))));

export const cloudwatch = (res: Response) =>
  memo('cw', ctxOf(res), () => new CloudWatchClient(baseConfig(ctxOf(res))));
export const logs = (res: Response) =>
  memo('logs', ctxOf(res), () => new CloudWatchLogsClient(baseConfig(ctxOf(res))));
export const sfn = (res: Response) => memo('sfn', ctxOf(res), () => new SFNClient(baseConfig(ctxOf(res))));

const mk = <T,>(kind: string, C: new (cfg: any) => T) => (res: Response) =>
  memo(kind, ctxOf(res), () => new C(baseConfig(ctxOf(res))));
export const apigw = mk('apigw', APIGatewayClient);
export const apigw2 = mk('apigw2', ApiGatewayV2Client);
export const events = mk('events', EventBridgeClient);
export const sns = mk('sns', SNSClient);
export const secrets = mk('secrets', SecretsManagerClient);
export const ssm = mk('ssm', SSMClient);
export const cognito = mk('cognito', CognitoIdentityProviderClient);
export const kms = mk('kms', KMSClient);

/** Bọc async handler để lỗi đi vào error middleware */
export const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const NETWORK_CODES = ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'EHOSTUNREACH', 'EAI_AGAIN'];

export function isUnreachable(err: any): boolean {
  const code = err?.code || err?.cause?.code || err?.name;
  return (
    NETWORK_CODES.includes(code) ||
    err?.name === 'TimeoutError' ||
    (!err?.$metadata?.httpStatusCode && /connect|ECONNREFUSED|socket hang up|getaddrinfo/i.test(String(err?.message)))
  );
}

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  const unreachable = isUnreachable(err);
  const status = unreachable ? 503 : err?.$metadata?.httpStatusCode || err?.statusCode || 500;
  const ctx = res.locals.aws as AwsCtx | undefined;
  res.status(status >= 400 ? status : 500).json({
    error: unreachable
      ? `Không kết nối được tới AWS Emulator (${ctx?.endpoint ?? 'n/a'}). Hãy chắc chắn emulator đang chạy.`
      : err?.message || 'Unknown error',
    code: err?.name || err?.code,
    unreachable,
  });
}
