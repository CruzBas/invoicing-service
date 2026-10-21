import Decimal from 'decimal.js';
import { CalculatedLine, LineInput } from './totals-calculator';

/** How a line is kept in Document.lines (decimals as strings). */
export interface StoredLine {
  lineNumber: number;
  cabys: string;
  description: string;
  quantity: string;
  unitPrice: string;
  taxRateCode: string;
  unit: string;
  subtotal: string;
  taxAmount: string;
  lineTotal: string;
}

export function toStoredLine(l: CalculatedLine): StoredLine {
  return {
    lineNumber: l.lineNumber,
    cabys: l.cabys,
    description: l.description,
    quantity: l.quantity.toString(),
    unitPrice: l.unitPrice.toString(),
    taxRateCode: l.taxRateCode,
    unit: l.unit,
    subtotal: l.subtotal.toFixed(5),
    taxAmount: l.taxAmount.toFixed(5),
    lineTotal: l.lineTotal.toFixed(5),
  };
}

export function toLineInput(l: StoredLine): LineInput {
  return {
    cabys: l.cabys,
    description: l.description,
    quantity: new Decimal(l.quantity),
    unitPrice: new Decimal(l.unitPrice),
    taxRateCode: l.taxRateCode,
    unit: l.unit,
  };
}
