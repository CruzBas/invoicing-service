export const DocumentType = {
  Invoice: '01',
  CreditNote: '03',
  Ticket: '04',
} as const;
export type DocumentType = (typeof DocumentType)[keyof typeof DocumentType];

export const DocumentStatus = {
  Signed: 'Signed',
  Sent: 'Sent',
  Accepted: 'Accepted',
  Rejected: 'Rejected',
  Error: 'Error',
} as const;
export type DocumentStatus =
  (typeof DocumentStatus)[keyof typeof DocumentStatus];

export const FINAL_STATUSES: readonly string[] = [
  DocumentStatus.Accepted,
  DocumentStatus.Rejected,
  DocumentStatus.Error,
];
