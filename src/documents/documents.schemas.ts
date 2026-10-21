import Decimal from 'decimal.js';
import { z } from 'zod';
import { IVA_RATES } from './domain/totals-calculator';

const decimal = (opts: { maxDecimals: number; positive?: boolean }) =>
  z.union([z.string(), z.number()]).transform((v, ctx) => {
    let d: Decimal;
    try {
      d = new Decimal(v);
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Not a decimal' });
      return z.NEVER;
    }
    if (!d.isFinite() || d.isNeg() || (opts.positive && d.isZero())) {
      ctx.addIssue({ code: 'custom', message: 'Out of range' });
      return z.NEVER;
    }
    if (d.decimalPlaces() > opts.maxDecimals) {
      ctx.addIssue({
        code: 'custom',
        message: `At most ${opts.maxDecimals} decimals`,
      });
      return z.NEVER;
    }
    return d;
  });

export const money = decimal({ maxDecimals: 5 });

export const lineSchema = z.object({
  cabys: z.string().regex(/^\d{13}$/),
  description: z.string().min(3).max(200),
  quantity: decimal({ maxDecimals: 3, positive: true }),
  unitPrice: money, // before tax
  taxRateCode: z.enum(Object.keys(IVA_RATES) as [string, ...string[]]),
  unit: z.string().min(1).max(15).optional(),
});

export const receiverSchema = z
  .object({
    name: z.string().min(3).max(100),
    // 01 física, 02 jurídica, 03 DIMEX, 04 NITE, 05 extranjero no domiciliado, 06 no contribuyente
    identificationType: z.enum(['01', '02', '03', '04', '05', '06']),
    identification: z.string().min(1).max(20),
    email: z.string().email().max(160).optional(),
    foreignAddress: z.string().min(5).max(300).optional(),
  })
  .refine(
    (r) =>
      !['01', '02', '03', '04'].includes(r.identificationType) ||
      /^\d{9,12}$/.test(r.identification),
    {
      message: 'Costa Rican identifications have 9 to 12 digits',
      path: ['identification'],
    },
  );

export const paymentMethodSchema = z.enum([
  '01', // efectivo
  '02', // tarjeta
  '03', // cheque
  '04', // transferencia
  '05', // recaudado por terceros
  '06', // SINPE Móvil
  '07', // plataforma digital
  '99', // otros
]);

export const issueDocumentSchema = z
  .object({
    emitterId: z.string().min(1),
    documentType: z.enum(['01', '04']),
    externalReference: z.string().min(1).max(100),
    currency: z.enum(['CRC', 'USD']),
    paymentMethod: paymentMethodSchema,
    receiver: receiverSchema.optional(),
    lines: z.array(lineSchema).min(1).max(1000),
    /** What the consumer charged; it must match what this service computes. */
    total: money,
  })
  .refine((b) => b.documentType !== '01' || b.receiver, {
    message: 'An invoice (01) requires a receiver',
    path: ['receiver'],
  });
export type IssueDocumentBody = z.infer<typeof issueDocumentSchema>;

export const creditNoteSchema = z.object({
  reason: z.string().min(3).max(180),
  /** Omitted: the whole original document is credited. */
  lines: z.array(lineSchema).min(1).max(1000).optional(),
  /** CodigoReferencia. Defaults: 01 (anula) when crediting everything, 04 otherwise. */
  referenceCode: z.enum(['01', '04', '06', '09', '99']).optional(),
  total: money,
});
export type CreditNoteBody = z.infer<typeof creditNoteSchema>;

export const idempotencyKeySchema = z.string().min(1).max(100);
