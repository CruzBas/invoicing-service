import { z } from 'zod';

export const emitterBodySchema = z.object({
  identificationType: z.enum(['01', '02', '03', '04']),
  identification: z.string().regex(/^\d{9,12}$/),
  name: z.string().min(5).max(100),
  tradeName: z.string().min(3).max(80).nullish(),
  activityCode: z.string().regex(/^\d{6}$/),
  province: z.string().regex(/^\d$/),
  canton: z.string().regex(/^\d{2}$/),
  district: z.string().regex(/^\d{2}$/),
  otherSigns: z.string().min(5).max(250),
  email: z.string().email().max(160),
  branchCode: z
    .string()
    .regex(/^\d{3}$/)
    .default('001'),
  terminalCode: z
    .string()
    .regex(/^\d{5}$/)
    .default('00001'),
});
export type EmitterBody = z.infer<typeof emitterBodySchema>;

export const certificateBodySchema = z.object({
  certificateBase64: z.string().min(1).base64(),
  pin: z.string().min(1),
  apiUser: z.string().min(1),
  apiPassword: z.string().min(1),
});
export type CertificateBody = z.infer<typeof certificateBodySchema>;
