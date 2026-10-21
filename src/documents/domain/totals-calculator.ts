import Decimal from 'decimal.js';

/** CodigoTarifaIVA (v4.4) -> rate in percent. */
export const IVA_RATES: Record<string, string> = {
  '01': '0', // Tarifa 0% (art. 32, num. 1, RLIVA)
  '02': '1',
  '03': '2',
  '04': '4',
  '05': '0', // transitorio 0%
  '06': '4', // transitorio 4%
  '07': '8', // transitorio 8%
  '08': '13', // general
  '09': '0.5',
  '10': '0', // exenta
  '11': '0', // 0% sin derecho a crédito
};

/** Only "10 Tarifa Exenta" goes to the exempt totals; every other code is taxed, even at 0%. */
const EXEMPT_CODE = '10';

export interface LineInput {
  cabys: string;
  description: string;
  quantity: Decimal;
  unitPrice: Decimal; // before tax
  taxRateCode: string;
  unit?: string;
}

export interface CalculatedLine extends LineInput {
  lineNumber: number;
  isService: boolean;
  unit: string;
  taxRate: Decimal;
  amount: Decimal; // MontoTotal = quantity x unitPrice
  subtotal: Decimal; // no discounts yet, so equals amount
  taxAmount: Decimal;
  lineTotal: Decimal;
}

export interface Summary {
  servicesTaxed: Decimal;
  servicesExempt: Decimal;
  goodsTaxed: Decimal;
  goodsExempt: Decimal;
  totalTaxed: Decimal;
  totalExempt: Decimal;
  totalSale: Decimal;
  totalNetSale: Decimal;
  taxBreakdown: { taxRateCode: string; amount: Decimal }[];
  totalTax: Decimal;
  total: Decimal;
}

const round5 = (d: Decimal) => d.toDecimalPlaces(5, Decimal.ROUND_HALF_UP);

/** CABYS starting with 1–4 are goods; 5–9 are services. */
export function isServiceCabys(cabys: string): boolean {
  return /^[5-9]/.test(cabys);
}

export function calculateTotals(inputs: LineInput[]): {
  lines: CalculatedLine[];
  summary: Summary;
} {
  if (inputs.length === 0) throw new Error('At least one line is required');

  const zero = new Decimal(0);
  const s = {
    servicesTaxed: zero,
    servicesExempt: zero,
    goodsTaxed: zero,
    goodsExempt: zero,
    totalTax: zero,
  };
  const breakdown = new Map<string, Decimal>();

  const lines = inputs.map((input, i): CalculatedLine => {
    const rate = IVA_RATES[input.taxRateCode];
    if (rate === undefined) {
      throw new Error(`Unknown taxRateCode ${input.taxRateCode}`);
    }
    const isService = isServiceCabys(input.cabys);
    const taxRate = new Decimal(rate);
    const amount = round5(input.quantity.mul(input.unitPrice));
    const subtotal = amount;
    const taxAmount = round5(subtotal.mul(taxRate).div(100));
    const exempt = input.taxRateCode === EXEMPT_CODE;

    if (isService) {
      if (exempt) s.servicesExempt = s.servicesExempt.add(subtotal);
      else s.servicesTaxed = s.servicesTaxed.add(subtotal);
    } else if (exempt) s.goodsExempt = s.goodsExempt.add(subtotal);
    else s.goodsTaxed = s.goodsTaxed.add(subtotal);

    s.totalTax = s.totalTax.add(taxAmount);
    if (!exempt) {
      breakdown.set(
        input.taxRateCode,
        (breakdown.get(input.taxRateCode) ?? zero).add(taxAmount),
      );
    }

    return {
      ...input,
      lineNumber: i + 1,
      isService,
      unit: input.unit ?? (isService ? 'Os' : 'Unid'),
      taxRate,
      amount,
      subtotal,
      taxAmount,
      lineTotal: subtotal.add(taxAmount),
    };
  });

  const totalTaxed = s.servicesTaxed.add(s.goodsTaxed);
  const totalExempt = s.servicesExempt.add(s.goodsExempt);
  const totalSale = totalTaxed.add(totalExempt);

  return {
    lines,
    summary: {
      ...s,
      totalTaxed,
      totalExempt,
      totalSale,
      totalNetSale: totalSale,
      taxBreakdown: [...breakdown].map(([taxRateCode, amount]) => ({
        taxRateCode,
        amount,
      })),
      total: totalSale.add(s.totalTax),
    },
  };
}

/** The caller works in cents; compare at two decimals. */
export function totalsMatch(computed: Decimal, declared: Decimal): boolean {
  return computed
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    .eq(declared.toDecimalPlaces(2, Decimal.ROUND_HALF_UP));
}
