import { INestApplication } from '@nestjs/common';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { execSync } from 'child_process';
import { randomBytes } from 'crypto';
import request from 'supertest';
import { createTestP12 } from '../src/signing/test-certificate';

export const ADMIN_KEY = randomBytes(32).toString('hex');
export const WEBHOOK_SECRET = randomBytes(32).toString('hex');

export interface TestEnv {
  container: StartedPostgreSqlContainer;
  app: INestApplication;
  url: string;
  apiKey: string;
  close(): Promise<void>;
}

/** PostgreSQL 18 in a container, migrations applied, one emitter and one API client. */
export async function startTestEnv(
  override: (builder: TestingModuleBuilder) => TestingModuleBuilder,
  webhookUrl?: string,
): Promise<TestEnv> {
  const container = await new PostgreSqlContainer('postgres:18').start();
  const databaseUrl = container.getConnectionUri();
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'ignore',
  });

  Object.assign(process.env, {
    DATABASE_URL: databaseUrl,
    HACIENDA_IDP_URL: 'https://idp.invalid/token',
    HACIENDA_CLIENT_ID: 'api-stag',
    HACIENDA_RECEPTION_URL: 'https://reception.invalid/recepcion/v1',
    HACIENDA_PUBLIC_API_URL: 'https://public.invalid',
    SOFTWARE_PROVIDER_ID: '3101123456',
    CERT_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    WEBHOOK_SECRET,
    ADMIN_API_KEY: ADMIN_KEY,
  });

  // Required after the env is set: ConfigModule validates when the module loads.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { AppModule } = require('../src/app.module') as {
    AppModule: new () => unknown;
  };
  const moduleRef = await override(
    Test.createTestingModule({ imports: [AppModule] }),
  ).compile();
  const app = moduleRef.createNestApplication();
  await app.listen(0);
  const url = (await app.getUrl()).replace('[::1]', 'localhost');

  const admin = (method: 'put' | 'post', path: string) =>
    request(url)[method](path).set('x-admin-key', ADMIN_KEY);
  await admin('put', '/v1/emitters/crediride')
    .send({
      identificationType: '02',
      identification: '3101123456',
      name: 'Viajes de Prueba S.A.',
      activityCode: '791101',
      province: '1',
      canton: '01',
      district: '01',
      otherSigns: 'Avenida central',
      email: 'facturacion@example.com',
    })
    .expect(200);
  await admin('put', '/v1/emitters/crediride/certificate')
    .send({
      certificateBase64: createTestP12('1234').toString('base64'),
      pin: '1234',
      apiUser: 'cpj-3-101-123456@stag.comprobanteselectronicos.go.cr',
      apiPassword: 'secret',
    })
    .expect(200);
  const client = await admin('post', '/v1/clients')
    .send({ name: 'cotizadores', emitterIds: ['crediride'], webhookUrl })
    .expect(201);

  return {
    container,
    app,
    url,
    apiKey: client.body.apiKey as string,
    async close() {
      await app.close();
      await container.stop();
    },
  };
}

export const visaLine = {
  cabys: '8559000000000',
  description: 'Gestión de visa',
  quantity: 1,
  unitPrice: '100.00',
  taxRateCode: '08',
};

export const ticketBody = (ref: string) => ({
  emitterId: 'crediride',
  documentType: '04',
  externalReference: ref,
  currency: 'CRC',
  paymentMethod: '02',
  lines: [visaLine],
  total: '113.00',
});
