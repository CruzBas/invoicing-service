import { createHmac } from 'crypto';
import { AddressInfo } from 'net';
import { Server, createServer } from 'http';
import request from 'supertest';
import { HaciendaAuthClient } from '../src/documents/infrastructure/hacienda/hacienda-auth.client';
import {
  HaciendaReceptionClient,
  ReceptionPayload,
  StatusResult,
  SubmitResult,
} from '../src/documents/infrastructure/hacienda/hacienda-reception.client';
import { StatusPoller } from '../src/documents/application/status-poller';
import { PrismaService } from '../src/shared/infrastructure/prisma/prisma.service';
import { TestEnv, WEBHOOK_SECRET, startTestEnv, ticketBody } from './support';

/** Hacienda's reception API, scripted per test. */
class FakeReception {
  submits: ReceptionPayload[] = [];
  statusCalls: string[] = [];
  submitResults: SubmitResult[] = [];
  statusResults: StatusResult[] = [];

  submit(_token: string, payload: ReceptionPayload): Promise<SubmitResult> {
    this.submits.push(payload);
    return Promise.resolve(this.submitResults.shift() ?? { kind: 'received' });
  }

  status(_token: string, key: string): Promise<StatusResult> {
    this.statusCalls.push(key);
    return Promise.resolve(this.statusResults.shift() ?? { kind: 'not_found' });
  }

  reset() {
    Object.assign(this, {
      submits: [],
      statusCalls: [],
      submitResults: [],
      statusResults: [],
    });
  }
}

const MENSAJE =
  '<MensajeHacienda><Mensaje>1</Mensaje><DetalleMensaje>Este comprobante fue aceptado</DetalleMensaje></MensajeHacienda>';

describe('delivery to Hacienda and webhooks', () => {
  const reception = new FakeReception();
  const webhooks: { body: string; signature?: string }[] = [];
  let hookServer: Server;
  let env: TestEnv;
  let prisma: PrismaService;
  let poller: StatusPoller;

  const issue = (ref: string) =>
    request(env.url)
      .post('/v1/documents')
      .set('x-api-key', env.apiKey)
      .set('idempotency-key', ref)
      .send(ticketBody(ref))
      .expect(202);

  /** Makes the document due and runs one poller cycle. */
  const tick = async (id: string) => {
    await prisma.document.update({
      where: { id },
      data: { nextAttemptAt: new Date(0) },
    });
    await poller.tick();
  };

  beforeAll(async () => {
    hookServer = createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => {
        webhooks.push({
          body,
          signature: req.headers['x-invoicing-signature'] as string,
        });
        res.writeHead(204).end();
      });
    });
    await new Promise<void>((r) => hookServer.listen(0, r));
    const port = (hookServer.address() as AddressInfo).port;

    env = await startTestEnv(
      (b) =>
        b
          .overrideProvider(HaciendaReceptionClient)
          .useValue(reception)
          .overrideProvider(HaciendaAuthClient)
          .useValue({
            token: () => Promise.resolve('token'),
            invalidate: () => {},
          }),
      `http://localhost:${port}/webhooks/invoicing`,
    );
    prisma = env.app.get(PrismaService);
    poller = env.app.get(StatusPoller);
  });

  afterAll(async () => {
    await env?.close();
    await new Promise((r) => hookServer.close(r));
  });

  beforeEach(() => reception.reset());

  it('after an ambiguous send, looks up the key and resends it unchanged on 404', async () => {
    reception.submitResults = [{ kind: 'ambiguous', reason: 'timeout' }];
    const { body } = await issue('CR-timeout');
    expect(body.status).toBe('Signed');

    reception.statusResults = [{ kind: 'not_found' }];
    await tick(body.id);

    expect(reception.statusCalls).toEqual([body.key]);
    expect(reception.submits.map((s) => s.clave)).toEqual([body.key, body.key]);
    const doc = await prisma.document.findUniqueOrThrow({
      where: { id: body.id },
    });
    expect(doc.status).toBe('Sent');
    expect(doc.sendAttempts).toBe(2);

    // The reception JSON carries the same instant as the XML.
    const payload = reception.submits[0];
    expect(payload.fecha).toMatch(/-06:00$/);
    expect(doc.signedXml).toContain(
      `<FechaEmision>${payload.fecha}</FechaEmision>`,
    );
    expect(payload.emisor).toEqual({
      tipoIdentificacion: '02',
      numeroIdentificacion: '003101123456',
    });
  });

  it('does not resend when Hacienda already has it', async () => {
    reception.submitResults = [{ kind: 'ambiguous', reason: 'HTTP 503' }];
    const { body } = await issue('CR-arrived');

    reception.statusResults = [{ kind: 'found', state: 'procesando' }];
    await tick(body.id);

    expect(reception.submits).toHaveLength(1);
    const doc = await prisma.document.findUniqueOrThrow({
      where: { id: body.id },
    });
    expect(doc.status).toBe('Sent');
  });

  it('polls until accepted, stores MensajeHacienda and sends a signed webhook', async () => {
    const { body } = await issue('CR-ok');
    expect(body.status).toBe('Sent');

    reception.statusResults = [{ kind: 'found', state: 'recibido' }];
    await tick(body.id);
    expect(
      (await prisma.document.findUniqueOrThrow({ where: { id: body.id } }))
        .status,
    ).toBe('Sent');

    reception.statusResults = [
      { kind: 'found', state: 'aceptado', responseXml: MENSAJE },
    ];
    webhooks.length = 0;
    await tick(body.id);

    const doc = await prisma.document.findUniqueOrThrow({
      where: { id: body.id },
    });
    expect(doc.status).toBe('Accepted');
    expect(doc.responseXml).toBe(MENSAJE);
    expect(doc.haciendaMessage).toBe('Este comprobante fue aceptado');
    expect(doc.webhookPending).toBe(false);

    expect(webhooks).toHaveLength(1);
    const [hook] = webhooks;
    const expected = createHmac('sha256', WEBHOOK_SECRET)
      .update(hook.body)
      .digest('hex');
    expect(hook.signature).toBe(`sha256=${expected}`);
    expect(JSON.parse(hook.body)).toMatchObject({
      id: `${body.id}:Accepted`,
      data: { externalReference: 'CR-ok', status: 'Accepted', key: body.key },
    });

    const files = (path: string) =>
      request(env.url)
        .get(`/v1/documents/${body.id}${path}`)
        .set('x-api-key', env.apiKey);
    await files('/response-xml').expect(200).expect('Content-Type', /xml/);
    const pdf = await files('/pdf')
      .expect(200)
      .expect('Content-Type', 'application/pdf');
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('marks a refused submission as Error, with the cause', async () => {
    reception.submitResults = [
      {
        kind: 'refused',
        status: 400,
        cause: 'El comprobante no cumple el esquema',
      },
    ];
    const { body } = await issue('CR-refused');
    expect(body.status).toBe('Error');
    expect(body.haciendaMessage).toBe('El comprobante no cumple el esquema');
  });

  it('hides documents from other API keys', async () => {
    const { body } = await issue('CR-private');
    const admin = await request(env.url)
      .post('/v1/clients')
      .set('x-admin-key', process.env.ADMIN_API_KEY!)
      .send({ name: 'nora', emitterIds: ['crediride'] })
      .expect(201);
    await request(env.url)
      .get(`/v1/documents/${body.id}`)
      .set('x-api-key', admin.body.apiKey)
      .expect(404);
    await request(env.url).get(`/v1/documents/${body.id}`).expect(401);
  });
});
