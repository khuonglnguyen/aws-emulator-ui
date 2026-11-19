import { Router } from 'express';
import type { Response } from 'express';
import { ListProjectsCommand, BatchGetProjectsCommand } from '@aws-sdk/client-codebuild';
import { ListPipelinesCommand } from '@aws-sdk/client-codepipeline';
import { DescribeAlarmsCommand } from '@aws-sdk/client-cloudwatch';
import { DescribeLogGroupsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { ListStateMachinesCommand, ListExecutionsCommand } from '@aws-sdk/client-sfn';
import { CreateLogGroupCommand, DeleteLogGroupCommand } from '@aws-sdk/client-cloudwatch-logs';
import { GetRestApisCommand, CreateRestApiCommand, DeleteRestApiCommand } from '@aws-sdk/client-api-gateway';
import { GetApisCommand, CreateApiCommand, DeleteApiCommand } from '@aws-sdk/client-apigatewayv2';
import { ListRulesCommand, PutRuleCommand, DeleteRuleCommand, ListTargetsByRuleCommand, RemoveTargetsCommand, ListEventBusesCommand, CreateEventBusCommand, DeleteEventBusCommand } from '@aws-sdk/client-eventbridge';
import { ListTopicsCommand, CreateTopicCommand, DeleteTopicCommand, ListSubscriptionsCommand, GetTopicAttributesCommand } from '@aws-sdk/client-sns';
import { ListSecretsCommand, CreateSecretCommand, DeleteSecretCommand } from '@aws-sdk/client-secrets-manager';
import { DescribeParametersCommand, PutParameterCommand, DeleteParameterCommand } from '@aws-sdk/client-ssm';
import { ListUserPoolsCommand, CreateUserPoolCommand, DeleteUserPoolCommand } from '@aws-sdk/client-cognito-identity-provider';
import { ListKeysCommand, DescribeKeyCommand, CreateKeyCommand, ScheduleKeyDeletionCommand } from '@aws-sdk/client-kms';
import { codebuild, codepipeline, cloudwatch, logs, sfn, apigw, apigw2, events, sns, secrets, ssm, cognito, kms, wrap } from '../aws';
import { Service, Row, date, chunk } from './infra.types';
import { COMPUTE_SERVICES } from './infra.compute';
import { DATA_SERVICES } from './infra.data';

/**
 * Các dịch vụ dịch vụ Developer (CodeBuild, CodePipeline, CloudWatch, Step Functions, API Gateway, EventBridge, SNS, Secrets Manager, SSM, Cognito, KMS). Mỗi resource trả về
 * danh sách hàng phẳng `{ id, ...cột, raw }` để client dựng bảng + xem JSON chi tiết.
 */
const BASE_SERVICES: Service[] = [
  {
    id: 'codebuild',
    label: 'AWS CodeBuild',
    resources: [
      {
        id: 'projects',
        label: 'Build projects',
        columns: [
          { key: 'name', label: 'Project' },
          { key: 'source', label: 'Source' },
          { key: 'image', label: 'Image' },
          { key: 'compute', label: 'Compute' },
        ],
        list: async (res) => {
          const names = (await codebuild(res).send(new ListProjectsCommand({}))).projects || [];
          const rows: Row[] = [];
          for (const part of chunk(names, 100)) {
            for (const p of (await codebuild(res).send(new BatchGetProjectsCommand({ names: part }))).projects || [])
              rows.push({
                id: p.arn || p.name!,
                name: p.name,
                source: p.source?.type,
                image: p.environment?.image,
                compute: p.environment?.computeType,
                raw: p,
              });
          }
          return rows;
        },
      },
    ],
  },
  {
    id: 'codepipeline',
    label: 'AWS CodePipeline',
    resources: [
      {
        id: 'pipelines',
        label: 'Pipelines',
        columns: [
          { key: 'name', label: 'Pipeline' },
          { key: 'version', label: 'Version' },
          { key: 'type', label: 'Type' },
          { key: 'updated', label: 'Updated' },
        ],
        list: async (res) =>
          ((await codepipeline(res).send(new ListPipelinesCommand({}))).pipelines || []).map((p) => ({
            id: p.name!,
            name: p.name,
            version: p.version,
            type: p.pipelineType,
            updated: date(p.updated),
            raw: p,
          })),
      },
    ],
  },
  {
    id: 'cloudwatch',
    label: 'Amazon CloudWatch',
    resources: [
      {
        id: 'alarms',
        label: 'Alarms',
        columns: [
          { key: 'name', label: 'Alarm' },
          { key: 'state', label: 'State' },
          { key: 'metric', label: 'Metric' },
          { key: 'threshold', label: 'Threshold' },
        ],
        list: async (res) =>
          ((await cloudwatch(res).send(new DescribeAlarmsCommand({ MaxRecords: 100 }))).MetricAlarms || []).map((a) => ({
            id: a.AlarmArn || a.AlarmName!,
            name: a.AlarmName,
            state: a.StateValue,
            metric: `${a.Namespace ?? ''}/${a.MetricName ?? ''}`,
            threshold: `${a.ComparisonOperator ?? ''} ${a.Threshold ?? ''}`,
            raw: a,
          })),
      },
      {
        id: 'log-groups',
        label: 'Log groups',
        columns: [
          { key: 'name', label: 'Log group' },
          { key: 'retention', label: 'Retention (days)' },
          { key: 'bytes', label: 'Stored bytes' },
        ],
        list: async (res) =>
          ((await logs(res).send(new DescribeLogGroupsCommand({}))).logGroups || []).map((g) => ({
            id: g.arn || g.logGroupName!,
            name: g.logGroupName,
            retention: g.retentionInDays ?? 'Never expire',
            bytes: g.storedBytes,
            raw: g,
          })),
        create: {
          fields: [{ key: 'name', label: 'Log group name', placeholder: '/ecs/my-service', required: true }],
          run: (res, b) => logs(res).send(new CreateLogGroupCommand({ logGroupName: b.name })),
        },
        remove: (res, id) => {
          // id có thể là ARN: arn:aws:logs:region:acct:log-group:NAME[:*]
          const name = id.includes('log-group:') ? id.split('log-group:')[1].replace(/:\*$/, '') : id;
          return logs(res).send(new DeleteLogGroupCommand({ logGroupName: name }));
        },
      },
    ],
  },
  {
    id: 'stepfunctions',
    label: 'AWS Step Functions',
    resources: [
      {
        id: 'state-machines',
        label: 'State machines',
        columns: [
          { key: 'name', label: 'State machine' },
          { key: 'type', label: 'Type' },
          { key: 'created', label: 'Created' },
        ],
        list: async (res) =>
          ((await sfn(res).send(new ListStateMachinesCommand({ maxResults: 1000 }))).stateMachines || []).map((m) => ({
            id: m.stateMachineArn!,
            name: m.name,
            type: m.type,
            created: date(m.creationDate),
            raw: m,
          })),
      },
      {
        id: 'executions',
        label: 'Executions',
        columns: [
          { key: 'name', label: 'Execution' },
          { key: 'machine', label: 'State machine' },
          { key: 'status', label: 'Status' },
          { key: 'started', label: 'Started' },
        ],
        list: async (res) => {
          const rows: Row[] = [];
          const ms = (await sfn(res).send(new ListStateMachinesCommand({ maxResults: 1000 }))).stateMachines || [];
          for (const m of ms) {
            const ex = (await sfn(res).send(new ListExecutionsCommand({ stateMachineArn: m.stateMachineArn, maxResults: 50 }))).executions || [];
            for (const e of ex)
              rows.push({ id: e.executionArn!, name: e.name, machine: m.name, status: e.status, started: date(e.startDate), raw: e });
          }
          return rows;
        },
      },
    ],
  },
  {
    id: 'apigateway',
    label: 'Amazon API Gateway',
    resources: [
      {
        id: 'rest-apis',
        label: 'REST APIs',
        columns: [
          { key: 'name', label: 'Name' },
          { key: 'apiId', label: 'ID' },
          { key: 'created', label: 'Created' },
        ],
        list: async (res) =>
          ((await apigw(res).send(new GetRestApisCommand({ limit: 500 }))).items || []).map((a) => ({
            id: a.id!, name: a.name, apiId: a.id, created: date(a.createdDate), raw: a,
          })),
        create: {
          fields: [
            { key: 'name', label: 'API name', required: true },
            { key: 'description', label: 'Description' },
          ],
          run: (res, b) => apigw(res).send(new CreateRestApiCommand({ name: b.name, description: b.description || undefined })),
        },
        remove: (res, id) => apigw(res).send(new DeleteRestApiCommand({ restApiId: id })),
      },
      {
        id: 'http-apis',
        label: 'HTTP / WebSocket APIs',
        columns: [
          { key: 'name', label: 'Name' },
          { key: 'protocol', label: 'Protocol' },
          { key: 'endpoint', label: 'Endpoint' },
        ],
        list: async (res) =>
          ((await apigw2(res).send(new GetApisCommand({}))).Items || []).map((a) => ({
            id: a.ApiId!, name: a.Name, protocol: a.ProtocolType, endpoint: a.ApiEndpoint, raw: a,
          })),
        create: {
          fields: [
            { key: 'name', label: 'API name', required: true },
            { key: 'protocol', label: 'Protocol', options: ['HTTP', 'WEBSOCKET'] },
          ],
          run: (res, b) =>
            apigw2(res).send(
              new CreateApiCommand({
                Name: b.name,
                ProtocolType: (b.protocol || 'HTTP') as 'HTTP' | 'WEBSOCKET',
                ...(b.protocol === 'WEBSOCKET' ? { RouteSelectionExpression: '$request.body.action' } : {}),
              }),
            ),
        },
        remove: (res, id) => apigw2(res).send(new DeleteApiCommand({ ApiId: id })),
      },
    ],
  },
  {
    id: 'eventbridge',
    label: 'Amazon EventBridge',
    resources: [
      {
        id: 'rules',
        label: 'Rules',
        columns: [
          { key: 'name', label: 'Rule' },
          { key: 'state', label: 'State' },
          { key: 'schedule', label: 'Schedule / Pattern' },
          { key: 'bus', label: 'Event bus' },
        ],
        list: async (res) =>
          ((await events(res).send(new ListRulesCommand({}))).Rules || []).map((r) => ({
            id: r.Name!, name: r.Name, state: r.State, schedule: r.ScheduleExpression || (r.EventPattern ? 'Event pattern' : ''), bus: r.EventBusName, raw: r,
          })),
        create: {
          fields: [
            { key: 'name', label: 'Rule name', required: true },
            { key: 'schedule', label: 'Schedule expression', placeholder: 'rate(5 minutes)  hoặc  cron(0 12 * * ? *)' },
            { key: 'pattern', label: 'Event pattern (JSON)', multiline: true, placeholder: '{"source":["my.app"]}' },
          ],
          run: (res, b) => {
            if (!b.schedule && !b.pattern) throw Object.assign(new Error('Cần Schedule expression hoặc Event pattern'), { statusCode: 400 });
            return events(res).send(new PutRuleCommand({ Name: b.name, ScheduleExpression: b.schedule || undefined, EventPattern: b.pattern || undefined, State: 'ENABLED' }));
          },
        },
        remove: async (res, id) => {
          const t = (await events(res).send(new ListTargetsByRuleCommand({ Rule: id }))).Targets || [];
          if (t.length) await events(res).send(new RemoveTargetsCommand({ Rule: id, Ids: t.map((x) => x.Id!) }));
          return events(res).send(new DeleteRuleCommand({ Name: id }));
        },
      },
      {
        id: 'event-buses',
        label: 'Event buses',
        columns: [
          { key: 'name', label: 'Name' },
          { key: 'arn', label: 'ARN' },
        ],
        list: async (res) =>
          ((await events(res).send(new ListEventBusesCommand({}))).EventBuses || []).map((b) => ({ id: b.Name!, name: b.Name, arn: b.Arn, raw: b })),
        create: {
          fields: [{ key: 'name', label: 'Event bus name', required: true }],
          run: (res, b) => events(res).send(new CreateEventBusCommand({ Name: b.name })),
        },
        remove: (res, id) => events(res).send(new DeleteEventBusCommand({ Name: id })),
      },
    ],
  },
  {
    id: 'sns',
    label: 'Amazon SNS',
    resources: [
      {
        id: 'topics',
        label: 'Topics',
        columns: [
          { key: 'name', label: 'Topic' },
          { key: 'subs', label: 'Subscriptions' },
        ],
        list: async (res) => {
          const topics = (await sns(res).send(new ListTopicsCommand({}))).Topics || [];
          return Promise.all(
            topics.map(async (t) => {
              let attrs: Record<string, string> = {};
              try { attrs = (await sns(res).send(new GetTopicAttributesCommand({ TopicArn: t.TopicArn }))).Attributes || {}; } catch { /* ignore */ }
              return { id: t.TopicArn!, name: t.TopicArn!.split(':').pop(), subs: attrs.SubscriptionsConfirmed ?? '-', raw: { ...t, attributes: attrs } };
            }),
          );
        },
        create: {
          fields: [{ key: 'name', label: 'Topic name', required: true, placeholder: 'my-topic (hậu tố .fifo cho FIFO)' }],
          run: (res, b) =>
            sns(res).send(new CreateTopicCommand({ Name: b.name, ...(b.name.endsWith('.fifo') ? { Attributes: { FifoTopic: 'true' } } : {}) })),
        },
        remove: (res, id) => sns(res).send(new DeleteTopicCommand({ TopicArn: id })),
      },
      {
        id: 'subscriptions',
        label: 'Subscriptions',
        columns: [
          { key: 'topic', label: 'Topic' },
          { key: 'protocol', label: 'Protocol' },
          { key: 'endpoint', label: 'Endpoint' },
        ],
        list: async (res) =>
          ((await sns(res).send(new ListSubscriptionsCommand({}))).Subscriptions || []).map((x) => ({
            id: x.SubscriptionArn!, topic: x.TopicArn?.split(':').pop(), protocol: x.Protocol, endpoint: x.Endpoint, raw: x,
          })),
      },
    ],
  },
  {
    id: 'secretsmanager',
    label: 'AWS Secrets Manager',
    resources: [
      {
        id: 'secrets',
        label: 'Secrets',
        columns: [
          { key: 'name', label: 'Secret' },
          { key: 'description', label: 'Description' },
          { key: 'changed', label: 'Last changed' },
        ],
        list: async (res) =>
          ((await secrets(res).send(new ListSecretsCommand({}))).SecretList || []).map((x) => ({
            id: x.ARN || x.Name!, name: x.Name, description: x.Description, changed: date(x.LastChangedDate), raw: x,
          })),
        create: {
          fields: [
            { key: 'name', label: 'Secret name', required: true },
            { key: 'value', label: 'Secret value', multiline: true, required: true, placeholder: '{"user":"admin","password":"..."}' },
            { key: 'description', label: 'Description' },
          ],
          run: (res, b) => secrets(res).send(new CreateSecretCommand({ Name: b.name, SecretString: b.value, Description: b.description || undefined })),
        },
        remove: (res, id) => secrets(res).send(new DeleteSecretCommand({ SecretId: id, ForceDeleteWithoutRecovery: true })),
      },
    ],
  },
  {
    id: 'ssm',
    label: 'Systems Manager',
    resources: [
      {
        id: 'parameters',
        label: 'Parameter Store',
        columns: [
          { key: 'name', label: 'Name' },
          { key: 'type', label: 'Type' },
          { key: 'version', label: 'Version' },
          { key: 'modified', label: 'Last modified' },
        ],
        list: async (res) =>
          ((await ssm(res).send(new DescribeParametersCommand({ MaxResults: 50 }))).Parameters || []).map((p) => ({
            id: p.Name!, name: p.Name, type: p.Type, version: p.Version, modified: date(p.LastModifiedDate), raw: p,
          })),
        create: {
          fields: [
            { key: 'name', label: 'Name', required: true, placeholder: '/app/dev/db-url' },
            { key: 'type', label: 'Type', options: ['String', 'StringList', 'SecureString'] },
            { key: 'value', label: 'Value', multiline: true, required: true },
          ],
          run: (res, b) => ssm(res).send(new PutParameterCommand({ Name: b.name, Type: (b.type || 'String') as any, Value: b.value, Overwrite: true })),
        },
        remove: (res, id) => ssm(res).send(new DeleteParameterCommand({ Name: id })),
      },
    ],
  },
  {
    id: 'cognito',
    label: 'Amazon Cognito',
    resources: [
      {
        id: 'user-pools',
        label: 'User pools',
        columns: [
          { key: 'name', label: 'Name' },
          { key: 'poolId', label: 'Pool ID' },
          { key: 'created', label: 'Created' },
        ],
        list: async (res) =>
          ((await cognito(res).send(new ListUserPoolsCommand({ MaxResults: 60 }))).UserPools || []).map((u) => ({
            id: u.Id!, name: u.Name, poolId: u.Id, created: date(u.CreationDate), raw: u,
          })),
        create: {
          fields: [{ key: 'name', label: 'Pool name', required: true }],
          run: (res, b) => cognito(res).send(new CreateUserPoolCommand({ PoolName: b.name })),
        },
        remove: (res, id) => cognito(res).send(new DeleteUserPoolCommand({ UserPoolId: id })),
      },
    ],
  },
  {
    id: 'kms',
    label: 'AWS KMS',
    resources: [
      {
        id: 'keys',
        label: 'Keys',
        columns: [
          { key: 'keyId', label: 'Key ID' },
          { key: 'description', label: 'Description' },
          { key: 'state', label: 'State' },
          { key: 'usage', label: 'Usage' },
        ],
        list: async (res) => {
          const keys = (await kms(res).send(new ListKeysCommand({ Limit: 100 }))).Keys || [];
          const rows: Row[] = [];
          for (const k of keys) {
            const m = (await kms(res).send(new DescribeKeyCommand({ KeyId: k.KeyId }))).KeyMetadata;
            rows.push({ id: k.KeyId!, keyId: k.KeyId, description: m?.Description, state: m?.KeyState, usage: m?.KeyUsage, raw: m ?? k });
          }
          return rows;
        },
        create: {
          fields: [{ key: 'description', label: 'Description' }],
          run: (res, b) => kms(res).send(new CreateKeyCommand({ Description: b.description || undefined })),
        },
        // KMS không xóa ngay: lên lịch xóa tối thiểu 7 ngày
        remove: (res, id) => kms(res).send(new ScheduleKeyDeletionCommand({ KeyId: id, PendingWindowInDays: 7 })),
      },
    ],
  },
];

/** Mô tả ngắn cho các dịch vụ Developer có sẵn (hiện ở đầu trang dịch vụ) */
const BASE_INFO: Record<string, { description: string; concepts?: string[] }> = {
  codebuild: { description: 'Build, test và đóng gói mã nguồn trên máy chủ build được quản lý (chạy buildspec.yml).' },
  codepipeline: { description: 'Tự động hóa CI/CD: Source → Build → Test → Deploy theo các stage.' },
  cloudwatch: { description: 'Giám sát: metric, alarm và log (log group / log stream) của ứng dụng.' },
  stepfunctions: { description: 'Điều phối workflow nhiều bước bằng state machine (Amazon States Language).' },
  apigateway: { description: 'Tạo, publish và bảo vệ API (REST / HTTP / WebSocket) đặt trước Lambda hoặc backend.' },
  eventbridge: { description: 'Event bus: định tuyến sự kiện theo rule (pattern hoặc lịch cron) tới target như Lambda, SQS, SNS.' },
  sns: { description: 'Pub/Sub: publish một message, fan-out tới nhiều subscriber (SQS, Lambda, email, HTTP).' },
  secretsmanager: { description: 'Lưu và xoay vòng secret (mật khẩu DB, API key) thay vì hard-code trong mã nguồn.' },
  ssm: { description: 'Parameter Store: lưu cấu hình ứng dụng theo cây đường dẫn (/app/env/key), hỗ trợ SecureString.' },
  cognito: { description: 'Xác thực và quản lý người dùng cho ứng dụng (user pool, đăng ký/đăng nhập, JWT).' },
  kms: { description: 'Tạo và quản lý khóa mã hóa; các dịch vụ khác dùng KMS để mã hóa dữ liệu.' },
};
const SERVICES: Service[] = [
  ...BASE_SERVICES.map((s) => ({ ...s, ...BASE_INFO[s.id] })),
  ...COMPUTE_SERVICES,
  ...DATA_SERVICES,
];

const router = Router();
const find = (s: string, r: string) => SERVICES.find((x) => x.id === s)?.resources.find((x) => x.id === r);

/** Bỏ $metadata, đổi Uint8Array → text để trả JSON gọn cho client */
const clean = (v: unknown) =>
  v === undefined
    ? null
    : JSON.parse(
        JSON.stringify(v, (k, x) => (k === '$metadata' ? undefined : x instanceof Uint8Array ? Buffer.from(x).toString('utf8') : x)),
      );

/** Mô tả dịch vụ/resource/cột/thao tác để client tự dựng menu, bảng và form */
router.get('/meta', (_req, res) => {
  res.json(
    SERVICES.map((s) => ({
      id: s.id,
      label: s.label,
      description: s.description,
      concepts: s.concepts,
      resources: s.resources.map(({ id, label, description, listCli, columns, create, remove, removeCli, actions }) => ({
        id,
        label,
        description,
        listCli,
        columns,
        create: create ? { fields: create.fields, cli: create.cli, showResult: create.showResult } : undefined,
        canDelete: !!remove,
        removeCli,
        actions: (actions ?? []).map(({ id, label, scope, description, fields, danger, cli }) => ({
          id, label, scope: scope ?? 'row', description, fields, danger, cli,
        })),
      })),
    })),
  );
});

router.get(
  '/:service/:resource',
  wrap(async (req, res) => {
    const r = SERVICES.find((s) => s.id === req.params.service)?.resources.find((x) => x.id === req.params.resource);
    if (!r) return res.status(404).json({ error: 'Resource không tồn tại' });
    res.json(await r.list(res));
  }),
);

router.post(
  '/:service/:resource',
  wrap(async (req, res) => {
    const r = find(req.params.service, req.params.resource);
    if (!r?.create) return res.status(404).json({ error: 'Resource không hỗ trợ tạo mới' });
    const body: Record<string, string> = {};
    for (const f of r.create.fields) {
      const v = String(req.body?.[f.key] ?? '').trim();
      if (f.required && !v) return res.status(400).json({ error: `Thiếu trường "${f.label}"` });
      body[f.key] = v;
    }
    const out = await r.create.run(res, body);
    res.json({ ok: true, result: r.create.showResult ? clean(out) : undefined });
  }),
);

/** Chạy thao tác đặc trưng: body = { id, ...fields } */
router.post(
  '/:service/:resource/action/:action',
  wrap(async (req, res) => {
    const r = find(req.params.service, req.params.resource);
    const a = r?.actions?.find((x) => x.id === req.params.action);
    if (!a) return res.status(404).json({ error: 'Thao tác không tồn tại' });
    const id = String(req.body?.id ?? '');
    if ((a.scope ?? 'row') === 'row' && !id) return res.status(400).json({ error: 'Thiếu id của dòng' });
    const body: Record<string, string> = {};
    for (const f of a.fields ?? []) {
      const v = String(req.body?.[f.key] ?? '').trim();
      if (f.required && !v) return res.status(400).json({ error: `Thiếu trường "${f.label}"` });
      body[f.key] = v;
    }
    res.json({ ok: true, result: clean(await a.run(res, id, body)) });
  }),
);

router.delete(
  '/:service/:resource',
  wrap(async (req, res) => {
    const r = find(req.params.service, req.params.resource);
    const id = String(req.query.id ?? '');
    if (!r?.remove || !id) return res.status(400).json({ error: 'Không hỗ trợ xóa hoặc thiếu id' });
    await r.remove(res, id);
    res.json({ ok: true });
  }),
);

/** Đếm nhanh cho trang Overview (mỗi resource độc lập) */
export async function infraCounts(res: Response) {
  const out: Record<string, { count: number; error?: string }> = {};
  await Promise.all(
    SERVICES.map(async (s) => {
      try {
        const lists = await Promise.all(s.resources.map((r) => r.list(res)));
        out[s.id] = { count: lists.reduce((n, l) => n + l.length, 0) };
      } catch (e: any) {
        out[s.id] = { count: 0, error: e?.message };
      }
    }),
  );
  return out;
}

export default router;
