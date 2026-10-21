import Decimal from 'decimal.js';
import { DateTime } from 'luxon';
import { create } from 'xmlbuilder2';
import { XMLBuilder } from 'xmlbuilder2/lib/interfaces';
import { formatHaciendaDate } from '../domain/document-key';
import { DocumentType } from '../domain/document-types';
import { CalculatedLine, Summary } from '../domain/totals-calculator';

const ROOTS: Record<DocumentType, { name: string; ns: string }> = {
  '01': {
    name: 'FacturaElectronica',
    ns: 'https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/facturaElectronica',
  },
  '03': {
    name: 'NotaCreditoElectronica',
    ns: 'https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/notaCreditoElectronica',
  },
  '04': {
    name: 'TiqueteElectronico',
    ns: 'https://cdn.comprobanteselectronicos.go.cr/xml-schemas/v4.4/tiqueteElectronico',
  },
};

export interface XmlEmitter {
  identificationType: string;
  identification: string;
  name: string;
  tradeName?: string | null;
  activityCode: string;
  province: string;
  canton: string;
  district: string;
  otherSigns: string;
  email: string;
}

export interface XmlReceiver {
  name: string;
  identificationType: string;
  identification: string;
  email?: string;
  foreignAddress?: string;
}

export interface XmlReference {
  documentType: string; // TipoDocIR: 01 factura, 04 tiquete
  key: string;
  issuedAt: DateTime;
  code: string; // 01 anula, 04 referencia a otro documento...
  reason: string;
}

export interface DocumentXmlInput {
  documentType: DocumentType;
  key: string;
  consecutive: string;
  issuedAt: DateTime;
  softwareProviderId: string;
  emitter: XmlEmitter;
  receiver?: XmlReceiver;
  saleCondition?: string; // 01 contado
  lines: CalculatedLine[];
  summary: Summary;
  currency: string;
  exchangeRate: Decimal;
  paymentMethod: string; // 01 efectivo, 02 tarjeta...
  reference?: XmlReference;
}

const money = (d: Decimal) => d.toFixed(5);
const digits = (s: string) => s.replace(/\D/g, '');

/**
 * Builds the unsigned v4.4 document. Node order follows the XSD sequence;
 * any change here must keep the XSD tests green.
 */
export function buildDocumentXml(input: DocumentXmlInput): string {
  const root = ROOTS[input.documentType];
  if (input.documentType === DocumentType.Invoice && !input.receiver) {
    throw new Error('An invoice requires a receiver');
  }
  if (input.documentType === DocumentType.CreditNote && !input.reference) {
    throw new Error('A credit note requires a reference');
  }

  const doc = create({ version: '1.0', encoding: 'utf-8' }).ele(
    root.ns,
    root.name,
    {
      'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
      'xmlns:xsd': 'http://www.w3.org/2001/XMLSchema',
    },
  );

  doc.ele('Clave').txt(input.key);
  doc.ele('ProveedorSistemas').txt(digits(input.softwareProviderId));
  doc.ele('CodigoActividadEmisor').txt(input.emitter.activityCode);
  doc.ele('NumeroConsecutivo').txt(input.consecutive);
  doc.ele('FechaEmision').txt(formatHaciendaDate(input.issuedAt));
  addEmitter(doc, input.emitter);
  if (input.receiver) addReceiver(doc, input.receiver);
  doc.ele('CondicionVenta').txt(input.saleCondition ?? '01');

  const detail = doc.ele('DetalleServicio');
  for (const line of input.lines) addLine(detail, line);

  addSummary(doc, input);

  if (input.reference) {
    const r = doc.ele('InformacionReferencia');
    r.ele('TipoDocIR').txt(input.reference.documentType);
    r.ele('Numero').txt(input.reference.key);
    r.ele('FechaEmisionIR').txt(formatHaciendaDate(input.reference.issuedAt));
    r.ele('Codigo').txt(input.reference.code);
    r.ele('Razon').txt(input.reference.reason);
  }

  return doc.end({ prettyPrint: false });
}

function addEmitter(doc: XMLBuilder, e: XmlEmitter) {
  const node = doc.ele('Emisor');
  node.ele('Nombre').txt(e.name);
  const id = node.ele('Identificacion');
  id.ele('Tipo').txt(e.identificationType);
  id.ele('Numero').txt(digits(e.identification));
  if (e.tradeName) node.ele('NombreComercial').txt(e.tradeName);
  const loc = node.ele('Ubicacion');
  loc.ele('Provincia').txt(e.province);
  loc.ele('Canton').txt(e.canton);
  loc.ele('Distrito').txt(e.district);
  loc.ele('OtrasSenas').txt(e.otherSigns);
  node.ele('CorreoElectronico').txt(e.email);
}

function addReceiver(doc: XMLBuilder, r: XmlReceiver) {
  const node = doc.ele('Receptor');
  node.ele('Nombre').txt(r.name);
  const id = node.ele('Identificacion');
  id.ele('Tipo').txt(r.identificationType);
  id.ele('Numero').txt(r.identification);
  if (r.foreignAddress) node.ele('OtrasSenasExtranjero').txt(r.foreignAddress);
  if (r.email) node.ele('CorreoElectronico').txt(r.email);
}

function addLine(detail: XMLBuilder, l: CalculatedLine) {
  const node = detail.ele('LineaDetalle');
  node.ele('NumeroLinea').txt(String(l.lineNumber));
  node.ele('CodigoCABYS').txt(l.cabys);
  node.ele('Cantidad').txt(l.quantity.toFixed(3));
  node.ele('UnidadMedida').txt(l.unit);
  node.ele('Detalle').txt(l.description);
  node.ele('PrecioUnitario').txt(money(l.unitPrice));
  node.ele('MontoTotal').txt(money(l.amount));
  node.ele('SubTotal').txt(money(l.subtotal));
  node.ele('BaseImponible').txt(money(l.subtotal));
  const tax = node.ele('Impuesto');
  tax.ele('Codigo').txt('01'); // IVA
  tax.ele('CodigoTarifaIVA').txt(l.taxRateCode);
  tax.ele('Tarifa').txt(l.taxRate.toFixed(2));
  tax.ele('Monto').txt(money(l.taxAmount));
  node.ele('ImpuestoAsumidoEmisorFabrica').txt(money(new Decimal(0)));
  node.ele('ImpuestoNeto').txt(money(l.taxAmount));
  node.ele('MontoTotalLinea').txt(money(l.lineTotal));
}

function addSummary(doc: XMLBuilder, input: DocumentXmlInput) {
  const s = input.summary;
  const zero = money(new Decimal(0));
  const node = doc.ele('ResumenFactura');
  const currency = node.ele('CodigoTipoMoneda');
  currency.ele('CodigoMoneda').txt(input.currency);
  currency.ele('TipoCambio').txt(money(input.exchangeRate));
  node.ele('TotalServGravados').txt(money(s.servicesTaxed));
  node.ele('TotalServExentos').txt(money(s.servicesExempt));
  node.ele('TotalServExonerado').txt(zero);
  node.ele('TotalServNoSujeto').txt(zero);
  node.ele('TotalMercanciasGravadas').txt(money(s.goodsTaxed));
  node.ele('TotalMercanciasExentas').txt(money(s.goodsExempt));
  node.ele('TotalMercExonerada').txt(zero);
  node.ele('TotalMercNoSujeta').txt(zero);
  node.ele('TotalGravado').txt(money(s.totalTaxed));
  node.ele('TotalExento').txt(money(s.totalExempt));
  node.ele('TotalExonerado').txt(zero);
  node.ele('TotalNoSujeto').txt(zero);
  node.ele('TotalVenta').txt(money(s.totalSale));
  node.ele('TotalDescuentos').txt(zero);
  node.ele('TotalVentaNeta').txt(money(s.totalNetSale));
  for (const b of s.taxBreakdown) {
    const t = node.ele('TotalDesgloseImpuesto');
    t.ele('Codigo').txt('01');
    t.ele('CodigoTarifaIVA').txt(b.taxRateCode);
    t.ele('TotalMontoImpuesto').txt(money(b.amount));
  }
  node.ele('TotalImpuesto').txt(money(s.totalTax));
  node.ele('TotalIVADevuelto').txt(zero);
  node.ele('TotalOtrosCargos').txt(zero);
  const payment = node.ele('MedioPago');
  payment.ele('TipoMedioPago').txt(input.paymentMethod);
  payment.ele('TotalMedioPago').txt(money(s.total));
  node.ele('TotalComprobante').txt(money(s.total));
}
