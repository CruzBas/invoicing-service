import { randomInt } from 'crypto';
import { DateTime } from 'luxon';
import { COSTA_RICA_ZONE } from './document-types';

/** 1 normal, 2 contingency, 3 without internet. */
export type Situation = '1' | '2' | '3';

/**
 * 50-digit clave: 506 | ddMMyy | identification (12) | consecutive (20) |
 * situation (1) | security code (8). The date is Costa Rica's calendar day of
 * `issuedAt`, whatever the server's zone.
 */
export function buildDocumentKey(input: {
  issuedAt: DateTime;
  identification: string;
  consecutive: string;
  situation?: Situation;
  securityCode?: string;
}): string {
  const identification = input.identification.replace(/\D/g, '');
  if (identification.length < 9 || identification.length > 12) {
    throw new Error('Identification must have 9 to 12 digits');
  }
  if (!/^\d{20}$/.test(input.consecutive)) {
    throw new Error('Consecutive must have 20 digits');
  }
  const securityCode =
    input.securityCode ?? randomInt(0, 1e8).toString().padStart(8, '0');
  if (!/^\d{8}$/.test(securityCode)) {
    throw new Error('Security code must have 8 digits');
  }

  return (
    '506' +
    input.issuedAt.setZone(COSTA_RICA_ZONE).toFormat('ddMMyy') +
    identification.padStart(12, '0') +
    input.consecutive +
    (input.situation ?? '1') +
    securityCode
  );
}

/** One instant, formatted the same way in the clave, FechaEmision and the reception JSON. */
export function formatHaciendaDate(instant: DateTime): string {
  return instant
    .setZone(COSTA_RICA_ZONE)
    .toISO({ suppressMilliseconds: true, includeOffset: true })!;
}
