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
