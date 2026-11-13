import { Router } from 'express';
import {
  ListTablesCommand,
  DescribeTableCommand,
  CreateTableCommand,
  DeleteTableCommand,
  ScalarAttributeType,
} from '@aws-sdk/client-dynamodb';
import { ScanCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { dynamo, docClient, wrap } from '../aws';

const router = Router();

router.get(
  '/tables',
  wrap(async (_req, res) => {
    const names: string[] = [];
    let start: string | undefined;
    do {
      const out = await dynamo(res).send(new ListTablesCommand({ ExclusiveStartTableName: start }));
      names.push(...(out.TableNames || []));
      start = out.LastEvaluatedTableName;
    } while (start);
    res.json(names);
  }),
);

router.get(
  '/tables/:table',
  wrap(async (req, res) => {
    const out = await dynamo(res).send(new DescribeTableCommand({ TableName: req.params.table }));
    const t = out.Table!;
    res.json({
      name: t.TableName,
      status: t.TableStatus,
      itemCount: t.ItemCount,
      keySchema: t.KeySchema,
      attributes: t.AttributeDefinitions,
      createdAt: t.CreationDateTime,
    });
  }),
);

router.post(
  '/tables',
  wrap(async (req, res) => {
    const { name, partitionKey, partitionKeyType = 'S', sortKey, sortKeyType = 'S' } = req.body || {};
    if (!name || !partitionKey) return res.status(400).json({ error: 'Cần tên bảng và Partition Key' });
    const attrs = [{ AttributeName: partitionKey, AttributeType: partitionKeyType as ScalarAttributeType }];
    const keys: any[] = [{ AttributeName: partitionKey, KeyType: 'HASH' }];
    if (sortKey) {
      attrs.push({ AttributeName: sortKey, AttributeType: sortKeyType as ScalarAttributeType });
      keys.push({ AttributeName: sortKey, KeyType: 'RANGE' });
    }
    await dynamo(res).send(
      new CreateTableCommand({
        TableName: name,
        AttributeDefinitions: attrs,
        KeySchema: keys,
        BillingMode: 'PAY_PER_REQUEST',
      }),
    );
    res.status(201).json({ name });
  }),
);

router.delete(
  '/tables/:table',
  wrap(async (req, res) => {
    await dynamo(res).send(new DeleteTableCommand({ TableName: req.params.table }));
    res.json({ ok: true });
  }),
);

// Scan toàn bộ (tối đa `limit` item, mặc định 500)
router.get(
  '/tables/:table/items',
  wrap(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 500, 5000);
    const items: any[] = [];
    let key: Record<string, any> | undefined;
    do {
      const out = await docClient(res).send(
        new ScanCommand({ TableName: req.params.table, ExclusiveStartKey: key }),
      );
      items.push(...(out.Items || []));
      key = out.LastEvaluatedKey;
    } while (key && items.length < limit);
    res.json({ items: items.slice(0, limit), truncated: !!key || items.length > limit });
  }),
);

// Thêm / sửa item (PutItem thay thế toàn bộ item)
router.put(
  '/tables/:table/items',
  wrap(async (req, res) => {
    const item = req.body?.item;
    if (!item || typeof item !== 'object') return res.status(400).json({ error: 'Item không hợp lệ' });
    await docClient(res).send(new PutCommand({ TableName: req.params.table, Item: item }));
    res.json({ ok: true });
  }),
);

// Xóa item theo key (body: { key: {...} })
router.post(
  '/tables/:table/items/delete',
  wrap(async (req, res) => {
    const key = req.body?.key;
    if (!key) return res.status(400).json({ error: 'Thiếu key' });
    await docClient(res).send(new DeleteCommand({ TableName: req.params.table, Key: key }));
    res.json({ ok: true });
  }),
);

export default router;
