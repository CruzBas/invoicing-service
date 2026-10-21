import { DOMParser } from '@xmldom/xmldom';
import Decimal from 'decimal.js';
import { readFileSync } from 'fs';
import { DateTime } from 'luxon';
import { join } from 'path';
import * as xadesjs from 'xadesjs';
import { validateXML } from 'xmllint-wasm';
import { createTestP12 } from '../../signing/test-certificate';
import { SigningKey, XadesSigner } from '../../signing/xades-signer';
import { formatConsecutive } from '../domain/consecutive-number';
import { buildDocumentKey } from '../domain/document-key';
import { DocumentType } from '../domain/document-types';
import { calculateTotals } from '../domain/totals-calculator';
import { DocumentXmlInput, buildDocumentXml } from './document-xml.builder';

const XSD_DIR = join(__dirname, 'xsd');
const SCHEMAS: Record<DocumentType, string> = {
  '01': 'FacturaElectronica_V4.4.xsd',
  '03': 'NotaCreditoElectronica_V4.4.xsd',
  '04': 'TiqueteElectronico_V4.4.xsd',
};

async function validate(xml: string, type: DocumentType) {
  const file = (name: string) => ({
    fileName: name,
    contents: readFileSync(join(XSD_DIR, name), 'utf8'),
  });
  return validateXML({
    xml: { fileName: 'document.xml', contents: xml },
    schema: file(SCHEMAS[type]),
    preload: [file('xmldsig-core-schema.xsd')],
  });
}

function input(
  type: DocumentType,
  overrides: Partial<DocumentXmlInput> = {},
): DocumentXmlInput {
  const issuedAt = DateTime.fromISO('2026-10-21T14:03:00-06:00');
  const consecutive = formatConsecutive({
    branchCode: '001',
    terminalCode: '00001',
    documentType: type,
    number: 7n,
  });
  const { lines, summary } = calculateTotals([
    {
      cabys: '6331000000000',
      description: 'Hotel en el exterior & <tasas>',
      quantity: new Decimal(1),
      unitPrice: new Decimal('850'),
      taxRateCode: '10',
    },
    {
      cabys: '8559000000000',
      description: 'Gestión de visa',
      quantity: new Decimal(2),
      unitPrice: new Decimal('125'),
      taxRateCode: '08',
    },
  ]);
  return {
    documentType: type,
    key: buildDocumentKey({
      issuedAt,
      identification: '3101123456',
      consecutive,
    }),
    consecutive,
    issuedAt,
    softwareProviderId: '3101123456',
    emitter: {
      identificationType: '02',
      identification: '3101123456',
      name: 'Viajes de Prueba S.A.',
      tradeName: 'CrediRide',
      activityCode: '791101',
      province: '1',
      canton: '01',
      district: '01',
      otherSigns: 'Avenida central, edificio azul',
      email: 'facturacion@example.com',
    },
    receiver: {
      name: 'Cliente de Prueba',
      identificationType: '01',
      identification: '114560789',
      email: 'cliente@example.com',
    },
    lines,
    summary,
    currency: 'USD',
    exchangeRate: new Decimal('457.54'),
    paymentMethod: '02',
    ...overrides,
  };
}

describe('document XML v4.4', () => {
  const pin = '1234';
  let p12: Buffer;
  let key: SigningKey;
  const signer = new XadesSigner();

  beforeAll(async () => {
    p12 = createTestP12(pin);
    key = await signer.prepare(p12, pin);
  });

  const cases: [string, DocumentXmlInput][] = [
    ['invoice (01) in USD paid by card', input('01')],
    [
      'ticket (04) without receiver',
      input('04', {
        receiver: undefined,
        currency: 'CRC',
        exchangeRate: new Decimal(1),
      }),
    ],
    [
      'credit note (03) with InformacionReferencia',
      input('03', {
        reference: {
          documentType: '01',
          key: '5'.repeat(50),
          issuedAt: DateTime.fromISO('2026-10-20T10:00:00-06:00'),
          code: '01',
          reason: 'Reembolso del ítem',
        },
      }),
    ],
  ];

  it.each(cases)('%s validates against the XSD once signed', async (_, doc) => {
    const signed = await signer.sign(buildDocumentXml(doc), key);
    const result = await validate(signed, doc.documentType);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('fails the XSD without a signature, so the schema is really checked', async () => {
    const result = await validate(buildDocumentXml(input('01')), '01');
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.message).join('\n')).toMatch(/Signature/);
  });

  it('writes the USD exchange rate, card payment and Costa Rica time', () => {
    const xml = buildDocumentXml(input('01'));
    expect(xml).toContain(
      '<CodigoMoneda>USD</CodigoMoneda><TipoCambio>457.54000</TipoCambio>',
    );
    expect(xml).toContain('<TipoMedioPago>02</TipoMedioPago>');
    expect(xml).toContain(
      '<FechaEmision>2026-10-21T14:03:00-06:00</FechaEmision>',
    );
    expect(xml).toContain('Hotel en el exterior &amp; &lt;tasas&gt;');
  });

  it('produces a signature that verifies', async () => {
    const signed = await signer.sign(buildDocumentXml(input('01')), key);
    const doc = new DOMParser().parseFromString(signed, 'application/xml');
    const sigNode = doc.getElementsByTagNameNS(
      'http://www.w3.org/2000/09/xmldsig#',
      'Signature',
    )[0];
    const verifier = new xadesjs.SignedXml(doc as unknown as Document);
    verifier.LoadXml(sigNode as unknown as Element);
    expect(await verifier.Verify()).toBe(true);
    expect(signed).toContain('ObligadoTributario');
    expect(signed).toContain('SigPolicyHash');
  });

  it('refuses a wrong PIN', async () => {
    await expect(signer.prepare(p12, 'wrong')).rejects.toThrow('PIN');
  });
});
