/** Who the document is issued to (Receptor). Kept as JSON in Document.receiver. */
export interface Receiver {
  name: string;
  identificationType: string;
  identification: string;
  email?: string;
  foreignAddress?: string;
}
