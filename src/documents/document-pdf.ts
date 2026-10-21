import { Document, Emitter } from '@prisma/client';
import { DateTime } from 'luxon';
import PDFDocument from 'pdfkit';
import { COSTA_RICA_ZONE } from './domain/document-types';
import { StoredLine } from './domain/stored-line';
import { XmlReceiver } from './xml/document-xml.builder';

const TITLES: Record<string, string> = {
  '01': 'Factura electrónica',
  '03': 'Nota de crédito electrónica',
  '04': 'Tiquete electrónico',
};

/** Printable representation of an accepted document. */
export function renderDocumentPdf(
  doc: Document,
  emitter: Pick<Emitter, 'name' | 'tradeName' | 'identification' | 'email'>,
  referencedKey?: string,
): Promise<Buffer> {
  const pdf = new PDFDocument({ size: 'LETTER', margin: 50 });
  const chunks: Buffer[] = [];
  pdf.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) =>
    pdf.on('end', () => resolve(Buffer.concat(chunks))),
  );

  const receiver = doc.receiver as unknown as XmlReceiver | null;
  const lines = doc.lines as unknown as StoredLine[];
  const issued = DateTime.fromJSDate(doc.issuedAt)
    .setZone(COSTA_RICA_ZONE)
    .toFormat('dd/MM/yyyy HH:mm');
  const amount = (v: string | { toString(): string }) =>
    `${doc.currency} ${Number(v.toString()).toLocaleString('es-CR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  pdf.fontSize(16).text(TITLES[doc.documentType] ?? 'Comprobante electrónico');
  pdf.moveDown(0.5).fontSize(9);
  pdf.text(`Clave: ${doc.key}`);
  pdf.text(`Consecutivo: ${doc.consecutive}`);
  pdf.text(`Fecha de emisión: ${issued}`);
  if (referencedKey) pdf.text(`Documento de referencia: ${referencedKey}`);

  pdf.moveDown().fontSize(11).text('Emisor');
  pdf.fontSize(9).text(emitter.tradeName ?? emitter.name);
  pdf.text(
    `${emitter.name} · Cédula ${emitter.identification} · ${emitter.email}`,
  );

  if (receiver) {
    pdf.moveDown().fontSize(11).text('Receptor');
    pdf
      .fontSize(9)
      .text(`${receiver.name} · Identificación ${receiver.identification}`);
    if (receiver.email) pdf.text(receiver.email);
  }

  pdf.moveDown().fontSize(11).text('Detalle');
  pdf.fontSize(9);
  for (const l of lines) {
    pdf.text(
      `${l.lineNumber}. ${l.description} — ${l.quantity} x ${amount(l.unitPrice)} · ` +
        `IVA ${amount(l.taxAmount)} · Total ${amount(l.lineTotal)}`,
    );
  }

  pdf.moveDown();
  if (doc.currency !== 'CRC')
    pdf.text(`Tipo de cambio: ${doc.exchangeRate.toString()}`);
  pdf.text(`Impuesto: ${amount(doc.totalTax)}`);
  pdf.fontSize(12).text(`Total: ${amount(doc.total)}`);

  pdf.end();
  return done;
}
