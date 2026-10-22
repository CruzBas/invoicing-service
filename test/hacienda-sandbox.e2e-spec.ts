import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { readFileSync } from 'fs';
import request from 'supertest';
import { DocumentDeliveryService } from '../src/documents/application/document-delivery.service';
import { PrismaService } from '../src/shared/infrastructure/prisma/prisma.service';

/**
 * Against Hacienda's real sandbox. Skipped unless HACIENDA_SANDBOX=1, with the
 * service's .env pointing at a migrated database and these variables:
 *   SANDBOX_EMITTER   JSON body of PUT /v1/emitters/:id
 *   SANDBOX_P12_PATH  SANDBOX_P12_PIN  SANDBOX_API_USER  SANDBOX_API_PASSWORD
 *   SANDBOX_CABYS     a service CABYS code that exists (13 digits)
 */
const run = process.env.HACIENDA_SANDBOX === '1' ? describe : describe.skip;

run('Hacienda sandbox', () => {
  jest.setTimeout(15 * 60_000);
  let app: INestApplication;
  let url: string;
  let apiKey: string;
  let prisma: PrismaService;
  let delivery: DocumentDeliveryService;
  const runId = Date.now().toString(36);
  const emitterId = `sandbox-${runId}`;

  const line = (cabys = process.env.SANDBOX_CABYS!) => ({
    cabys,
    description: 'Gestión de visa',
    quantity: 1,
    unitPrice: '100.00',
    taxRateCode: '08',
  });
  const issue = (key: string, extra: object) =>
    request(url)
      .post('/v1/documents')
      .set('x-api-key', apiKey)
      .set('idempotency-key', `${runId}-${key}`)
      .send({
        emitterId,
        externalReference: `sandbox-${runId}-${key}`,
        currency: 'USD',
        paymentMethod: '02',
        lines: [line()],
        total: '113.00',
        ...extra,
      })
      .expect(202);

  /** Polls Hacienda until the document reaches a final state. */
  async function settle(id: string): Promise<string> {
    for (let i = 0; i < 40; i++) {
      const doc = await prisma.document.findUniqueOrThrow({ where: { id } });
      if (['Accepted', 'Rejected', 'Error'].includes(doc.status))
        return doc.status;
      if (doc.status === 'Signed') await delivery.send(id);
      else await delivery.poll(id);
      await new Promise((r) => setTimeout(r, 15_000));
    }
    throw new Error(`Document ${id} did not settle`);
  }

  beforeAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AppModule } = require('../src/app.module') as {
      AppModule: new () => unknown;
    };
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.listen(0);
    url = (await app.getUrl()).replace('[::1]', 'localhost');
    prisma = app.get(PrismaService);
    delivery = app.get(DocumentDeliveryService);

    const admin = (method: 'put' | 'post', path: string) =>
      request(url)[method](path).set('x-admin-key', process.env.ADMIN_API_KEY!);
    await admin('put', `/v1/emitters/${emitterId}`)
      .send(JSON.parse(process.env.SANDBOX_EMITTER!))
      .expect(200);
    await admin('put', `/v1/emitters/${emitterId}/certificate`)
      .send({
        certificateBase64: readFileSync(process.env.SANDBOX_P12_PATH!).toString(
          'base64',
        ),
        pin: process.env.SANDBOX_P12_PIN,
        apiUser: process.env.SANDBOX_API_USER,
        apiPassword: process.env.SANDBOX_API_PASSWORD,
      })
      .expect(200);
    const client = await admin('post', '/v1/clients')
      .send({ name: `sandbox-${runId}`, emitterIds: [emitterId] })
      .expect(201);
    apiKey = client.body.apiKey;
  });

  afterAll(() => app?.close());

  it('accepts an invoice in USD and a credit note for it', async () => {
    const invoice = await issue('invoice', {
      documentType: '01',
      receiver: {
        name: 'Cliente de Prueba',
        identificationType: '01',
        identification: '114560789',
        email: 'cliente@example.com',
      },
    });
    expect(await settle(invoice.body.id)).toBe('Accepted');

    const note = await request(url)
      .post(`/v1/documents/${invoice.body.id}/credit-notes`)
      .set('x-api-key', apiKey)
      .set('idempotency-key', `${runId}-credit`)
      .send({ reason: 'Reembolso del ítem', total: '113.00' })
      .expect(202);
    expect(await settle(note.body.id)).toBe('Accepted');
  });

  it('accepts a ticket', async () => {
    const ticket = await issue('ticket', { documentType: '04' });
    expect(await settle(ticket.body.id)).toBe('Accepted');
  });

  it('rejects a ticket with a CABYS code that does not exist', async () => {
    const ticket = await issue('rejected', {
      documentType: '04',
      lines: [line('9999999999999')],
    });
    expect(await settle(ticket.body.id)).not.toBe('Accepted');
  });
});
