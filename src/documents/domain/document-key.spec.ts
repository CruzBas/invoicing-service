import { DateTime } from 'luxon';
import { buildDocumentKey, formatHaciendaDate } from './document-key';

describe('buildDocumentKey', () => {
  const consecutive = '00100001010000000042';

  it('has 50 digits in the documented layout', () => {
    const key = buildDocumentKey({
      issuedAt: DateTime.fromISO('2026-10-21T14:03:00-06:00'),
      identification: '3-101-123456',
      consecutive,
      securityCode: '12345678',
    });
    expect(key).toHaveLength(50);
    expect(key).toBe(
      '506' + '211026' + '003101123456' + consecutive + '1' + '12345678',
    );
  });

  it("uses Costa Rica's calendar day even when the instant is the next day in UTC", () => {
    // 21 Oct 21:30 in Costa Rica is 22 Oct 03:30 UTC.
    const utc = DateTime.fromISO('2026-10-22T03:30:00Z', { zone: 'utc' });
    const key = buildDocumentKey({
      issuedAt: utc,
      identification: '114560789',
      consecutive,
    });
    expect(key.slice(3, 9)).toBe('211026');
    expect(formatHaciendaDate(utc)).toBe('2026-10-21T21:30:00-06:00');
  });

  it('generates a random 8-digit security code', () => {
    const key = buildDocumentKey({
      issuedAt: DateTime.now(),
      identification: '114560789',
      consecutive,
    });
    expect(key).toMatch(/^\d{50}$/);
  });

  it('rejects malformed input', () => {
    const issuedAt = DateTime.now();
    expect(() =>
      buildDocumentKey({ issuedAt, identification: '123', consecutive }),
    ).toThrow();
    expect(() =>
      buildDocumentKey({
        issuedAt,
        identification: '114560789',
        consecutive: '1',
      }),
    ).toThrow();
  });
});
