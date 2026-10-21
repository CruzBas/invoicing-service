import Decimal from 'decimal.js';
import {
  calculateTotals,
  isServiceCabys,
  totalsMatch,
} from './totals-calculator';

const d = (v: string) => new Decimal(v);

describe('calculateTotals', () => {
  it('splits an exempt line and a taxed line', () => {
    const { lines, summary } = calculateTotals([
      // Hotel abroad: exempt
      {
        cabys: '6331000000000',
        description: 'Hotel en Cancún',
        quantity: d('1'),
        unitPrice: d('850.00'),
        taxRateCode: '10',
      },
      // Visa processing: 13 %
      {
        cabys: '8559000000000',
        description: 'Gestión de visa',
        quantity: d('2'),
        unitPrice: d('125.00'),
        taxRateCode: '08',
      },
    ]);

    expect(lines[0].taxAmount.toFixed(5)).toBe('0.00000');
    expect(lines[1].taxAmount.toFixed(5)).toBe('32.50000');
    expect(lines[1].lineTotal.toFixed(2)).toBe('282.50');
    expect(summary.servicesExempt.toFixed(2)).toBe('850.00');
    expect(summary.servicesTaxed.toFixed(2)).toBe('250.00');
    expect(summary.totalSale.toFixed(2)).toBe('1100.00');
    expect(summary.totalTax.toFixed(2)).toBe('32.50');
    expect(summary.total.toFixed(2)).toBe('1132.50');
    expect(summary.taxBreakdown).toEqual([
      { taxRateCode: '08', amount: d('32.5') },
    ]);
  });

  it('keeps decimal precision on USD amounts', () => {
    const { summary } = calculateTotals([
      {
        cabys: '6511000000000',
        description: 'Seguro de viaje',
        quantity: d('3'),
        unitPrice: d('0.1'),
        taxRateCode: '08',
      },
    ]);
    // 0.1 x 3 is exactly 0.3 (not 0.30000000000000004), and 13 % of it 0.039.
    expect(summary.totalSale.toString()).toBe('0.3');
    expect(summary.totalTax.toString()).toBe('0.039');
    expect(summary.total.toString()).toBe('0.339');
  });

  it('classifies goods by CABYS and rejects unknown rates', () => {
    expect(isServiceCabys('2399000000000')).toBe(false);
    expect(isServiceCabys('6331000000000')).toBe(true);
    expect(() =>
      calculateTotals([
        {
          cabys: '6331000000000',
          description: 'x',
          quantity: d('1'),
          unitPrice: d('1'),
          taxRateCode: '99',
        },
      ]),
    ).toThrow();
  });

  it('compares totals at two decimals', () => {
    expect(totalsMatch(d('1132.50000'), d('1132.5'))).toBe(true);
    expect(totalsMatch(d('0.339'), d('0.34'))).toBe(true);
    expect(totalsMatch(d('1132.50'), d('1132.49'))).toBe(false);
  });
});
