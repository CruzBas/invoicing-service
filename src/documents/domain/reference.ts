import { DateTime } from 'luxon';

/** InformacionReferencia: the document a credit note corrects. */
export interface Reference {
  documentType: string; // TipoDocIR: 01 factura, 04 tiquete
  key: string;
  issuedAt: DateTime;
  code: string; // 01 anula, 04 referencia a otro documento...
  reason: string;
}
