import request from 'supertest';
import { DocumentDeliveryService } from '../src/documents/application/document-delivery.service';
import { PrismaService } from '../src/shared/infrastructure/prisma/prisma.service';
import { TestEnv, startTestEnv, ticketBody as body } from './support';

describe('issuing against a real PostgreSQL 18', () => {
  let env: TestEnv;
  let prisma: PrismaService;

  const post = (path: string, idempotencyKey: string, payload: object) =>
    request(env.url)
      .post(path)
      .set('x-api-key', env.apiKey)
      .set('idempotency-key', idempotencyKey)
      .send(payload);

  beforeAll(async () => {
    env = await startTestEnv((b) =>
      b
        .overrideProvider(DocumentDeliveryService)
        .useValue({ send: async () => {}, poll: async () => {} }),
    );
    prisma = env.app.get(PrismaService);
  });

  afterAll(() => env?.close());

  it('gives 50 parallel emissions 50 distinct consecutives', async () => {
    const responses = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        post('/v1/documents', `par-${i}`, body(`CR-${i}`)),
      ),
    );
    for (const r of responses) expect(r.status).toBe(202);

    const consecutives = responses.map((r) => r.body.consecutive as string);
    expect(new Set(consecutives).size).toBe(50);
    const numbers = consecutives
      .map((c) => Number(c.slice(10)))
      .sort((a, b) => a - b);
    expect(numbers).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(new Set(responses.map((r) => r.body.key)).size).toBe(50);
  });

  it('returns the same document for a repeated Idempotency-Key, even in parallel', async () => {
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        post('/v1/documents', 'same-key', body('CR-dup')),
      ),
    );
    expect(new Set(responses.map((r) => r.body.id)).size).toBe(1);
    expect(
      await prisma.document.count({ where: { externalReference: 'CR-dup' } }),
    ).toBe(1);
  });

  it('answers 422 when the declared total does not match', async () => {
    const res = await post('/v1/documents', 'bad-total', {
      ...body('CR-bad'),
      total: '100.00',
    });
    expect(res.status).toBe(422);
    expect(res.body.computedTotal).toBe('113.00000');
  });

  it('rejects an invoice without receiver and an emitter the key cannot use', async () => {
    await post('/v1/documents', 'no-receiver', {
      ...body('CR-x'),
      documentType: '01',
    }).expect(400);
    await post('/v1/documents', 'other-emitter', {
      ...body('CR-y'),
      emitterId: 'nora',
    }).expect(403);
  });

  it('never credits more than the original, even with parallel refunds', async () => {
    const original = await post(
      '/v1/documents',
      'to-refund',
      body('CR-refund'),
    ).expect(202);
    await post(`/v1/documents/${original.body.id}/credit-notes`, 'cn-early', {
      reason: 'Reembolso',
      total: '113.00',
    }).expect(409); // not accepted yet

    await prisma.document.update({
      where: { id: original.body.id },
      data: { status: 'Accepted' },
    });
    const refunds = await Promise.all(
      ['cn-a', 'cn-b'].map((k) =>
        post(`/v1/documents/${original.body.id}/credit-notes`, k, {
          reason: 'Reembolso del ítem',
          total: '113.00',
        }),
      ),
    );
    expect(refunds.map((r) => r.status).sort()).toEqual([202, 422]);
    const note = refunds.find((r) => r.status === 202)!.body;
    expect(note.documentType).toBe('03');
    expect(note.referencedId).toBe(original.body.id);
    expect(note.consecutive.slice(8, 10)).toBe('03');
  });
});
