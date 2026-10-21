import { Prisma } from '@prisma/client';

/** 20 digits: branch (3) | terminal (5) | document type (2) | sequence (10). */
export function formatConsecutive(input: {
  branchCode: string;
  terminalCode: string;
  documentType: string;
  number: bigint;
}): string {
  const { branchCode, terminalCode, documentType, number } = input;
  if (!/^\d{1,3}$/.test(branchCode)) throw new Error('Invalid branch code');
  if (!/^\d{1,5}$/.test(terminalCode)) throw new Error('Invalid terminal code');
  if (!/^\d{2}$/.test(documentType)) throw new Error('Invalid document type');
  if (number < 1n || number > 9_999_999_999n) {
    throw new Error('Sequence out of range');
  }
  return (
    branchCode.padStart(3, '0') +
    terminalCode.padStart(5, '0') +
    documentType +
    number.toString().padStart(10, '0')
  );
}

/**
 * Takes the next number atomically. The row stays locked until the
 * transaction ends, so two emissions never share a number, and a rollback
 * gives the number back (no gaps).
 */
export async function takeNextNumber(
  tx: Prisma.TransactionClient,
  emitterId: string,
  documentType: string,
): Promise<bigint> {
  const [{ last_number }] = await tx.$queryRaw<{ last_number: bigint }[]>`
    INSERT INTO document_sequence (emitter_id, document_type, last_number)
    VALUES (${emitterId}, ${documentType}, 1)
    ON CONFLICT (emitter_id, document_type)
    DO UPDATE SET last_number = document_sequence.last_number + 1
    RETURNING last_number`;
  return last_number;
}
