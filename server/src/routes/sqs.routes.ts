import { Router } from 'express';
import { randomUUID } from 'crypto';
import {
  ListQueuesCommand,
  CreateQueueCommand,
  DeleteQueueCommand,
  GetQueueAttributesCommand,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  PurgeQueueCommand,
} from '@aws-sdk/client-sqs';
import { sqs, wrap } from '../aws';

const router = Router();
const urlOf = (q: unknown) => String(q || '');

router.get(
  '/queues',
  wrap(async (_req, res) => {
    const out = await sqs(res).send(new ListQueuesCommand({ MaxResults: 1000 }));
    res.json(
      (out.QueueUrls || []).map((url) => ({
        url,
        name: url.split('/').pop(),
        fifo: url.endsWith('.fifo'),
      })),
    );
  }),
);

router.post(
  '/queues',
  wrap(async (req, res) => {
    let name = String(req.body?.name || '').trim();
    const fifo = !!req.body?.fifo;
    if (!name) return res.status(400).json({ error: 'Thiếu tên queue' });
    if (fifo && !name.endsWith('.fifo')) name += '.fifo';
    const attrs: Record<string, string> = {};
    if (fifo) {
      attrs.FifoQueue = 'true';
      attrs.ContentBasedDeduplication = 'true';
    }
    const out = await sqs(res).send(new CreateQueueCommand({ QueueName: name, Attributes: attrs }));
    res.status(201).json({ url: out.QueueUrl });
  }),
);

router.delete(
  '/queue',
  wrap(async (req, res) => {
    await sqs(res).send(new DeleteQueueCommand({ QueueUrl: urlOf(req.query.url) }));
    res.json({ ok: true });
  }),
);

router.get(
  '/queue/attributes',
  wrap(async (req, res) => {
    const out = await sqs(res).send(
      new GetQueueAttributesCommand({ QueueUrl: urlOf(req.query.url), AttributeNames: ['All'] }),
    );
    res.json(out.Attributes || {});
  }),
);

router.post(
  '/queue/send',
  wrap(async (req, res) => {
    const { url, body, groupId, deduplicationId, delaySeconds } = req.body || {};
    if (!url || body === undefined || body === '') return res.status(400).json({ error: 'Thiếu url hoặc nội dung' });
    const fifo = String(url).endsWith('.fifo');
    const out = await sqs(res).send(
      new SendMessageCommand({
        QueueUrl: url,
        MessageBody: String(body),
        ...(fifo
          ? { MessageGroupId: groupId || 'default', MessageDeduplicationId: deduplicationId || randomUUID() }
          : delaySeconds
            ? { DelaySeconds: Number(delaySeconds) }
            : {}),
      }),
    );
    res.json({ messageId: out.MessageId });
  }),
);

// Poll: nhận tối đa 10 message
router.post(
  '/queue/receive',
  wrap(async (req, res) => {
    const { url, max = 10, waitSeconds = 1, visibilityTimeout = 30 } = req.body || {};
    const out = await sqs(res).send(
      new ReceiveMessageCommand({
        QueueUrl: url,
        MaxNumberOfMessages: Math.min(Number(max) || 10, 10),
        WaitTimeSeconds: Number(waitSeconds),
        VisibilityTimeout: Number(visibilityTimeout),
        AttributeNames: ['All'],
        MessageAttributeNames: ['All'],
      }),
    );
    res.json(
      (out.Messages || []).map((m) => ({
        messageId: m.MessageId,
        receiptHandle: m.ReceiptHandle,
        body: m.Body,
        attributes: m.Attributes,
      })),
    );
  }),
);

router.post(
  '/queue/delete-message',
  wrap(async (req, res) => {
    const { url, receiptHandle } = req.body || {};
    await sqs(res).send(new DeleteMessageCommand({ QueueUrl: url, ReceiptHandle: receiptHandle }));
    res.json({ ok: true });
  }),
);

router.post(
  '/queue/purge',
  wrap(async (req, res) => {
    await sqs(res).send(new PurgeQueueCommand({ QueueUrl: urlOf(req.body?.url) }));
    res.json({ ok: true });
  }),
);

export default router;
