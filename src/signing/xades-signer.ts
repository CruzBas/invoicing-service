import { Injectable } from '@nestjs/common';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { webcrypto } from 'crypto';
import forge from 'node-forge';
import * as xadesjs from 'xadesjs';

xadesjs.setNodeDependencies({ DOMParser, XMLSerializer });
xadesjs.Application.setEngine('NodeJS', webcrypto as unknown as Crypto);

/**
 * Signature policy of the v4.4 resolution. The hash is SHA-256 of the policy
 * PDF; re-check both values against Hacienda if the sandbox rejects the
 * signature.
 */
const POLICY_URI =
  'https://cdn.comprobanteselectronicos.go.cr/xml-schemas/Resoluci%C3%B3n_General_sobre_disposiciones_t%C3%A9cnicas_comprobantes_electr%C3%B3nicos_para_efectos_tributarios.pdf';
const POLICY_DIGEST = 'DWxin1xWOeI8OuWQXazh4VjLWAaCLAA954em7DMh0h8=';

const ALGORITHM = {
  name: 'RSASSA-PKCS1-v1_5',
  hash: { name: 'SHA-256' },
} as const;

export class CertificateError extends Error {}

interface UnpackedCertificate {
  certificateBase64: string; // DER
  privateKeyPkcs8: Buffer;
  publicKeySpki: Buffer;
  notAfter: Date;
}

/** Opens a .p12 in memory. Nothing here is logged or written to disk. */
export function openCertificate(p12: Buffer, pin: string): UnpackedCertificate {
  let parsed: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn1 = forge.asn1.fromDer(
      forge.util.createBuffer(p12.toString('binary')),
    );
    parsed = forge.pkcs12.pkcs12FromAsn1(asn1, true, pin);
  } catch {
    throw new CertificateError(
      'The certificate could not be opened with that PIN',
    );
  }

  const keyBags = [
    ...(parsed.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[
      forge.pki.oids.pkcs8ShroudedKeyBag
    ] ?? []),
    ...(parsed.getBags({ bagType: forge.pki.oids.keyBag })[
      forge.pki.oids.keyBag
    ] ?? []),
  ];
  const certBags =
    parsed.getBags({ bagType: forge.pki.oids.certBag })[
      forge.pki.oids.certBag
    ] ?? [];
  const key = keyBags[0]?.key;
  const cert = certBags[0]?.cert;
  if (!key || !cert) {
    throw new CertificateError(
      'The certificate has no private key or certificate',
    );
  }

  const pkcs8 = forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(key));
  return {
    certificateBase64: forge.util.encode64(
      forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(),
    ),
    privateKeyPkcs8: Buffer.from(forge.asn1.toDer(pkcs8).getBytes(), 'binary'),
    publicKeySpki: Buffer.from(
      forge.asn1.toDer(forge.pki.publicKeyToAsn1(cert.publicKey)).getBytes(),
      'binary',
    ),
    notAfter: cert.validity.notAfter,
  };
}

/** A certificate opened and imported, ready to sign many documents. */
export interface SigningKey {
  certificateBase64: string;
  privateKey: webcrypto.CryptoKey;
  publicKey: webcrypto.CryptoKey;
}

@Injectable()
export class XadesSigner {
  /** Opens the .p12 (the slow part); do it outside any transaction. */
  async prepare(p12: Buffer, pin: string): Promise<SigningKey> {
    const unpacked = openCertificate(p12, pin);
    if (unpacked.notAfter.getTime() < Date.now()) {
      throw new CertificateError('The certificate has expired');
    }
    const [privateKey, publicKey] = await Promise.all([
      webcrypto.subtle.importKey(
        'pkcs8',
        unpacked.privateKeyPkcs8,
        ALGORITHM,
        false,
        ['sign'],
      ),
      webcrypto.subtle.importKey(
        'spki',
        unpacked.publicKeySpki,
        ALGORITHM,
        true,
        ['verify'],
      ),
    ]);
    return {
      certificateBase64: unpacked.certificateBase64,
      privateKey,
      publicKey,
    };
  }

  /** Signs XAdES-EPES (enveloped) and returns the signed XML as text. */
  async sign(xml: string, signingKey: SigningKey): Promise<string> {
    const certificate = signingKey.certificateBase64;
    const document = xadesjs.Parse(xml);
    const signedXml = new xadesjs.SignedXml();
    const signature = await signedXml.Sign(
      ALGORITHM,
      signingKey.privateKey as unknown as CryptoKey,
      document,
      {
        keyValue: signingKey.publicKey as unknown as CryptoKey,
        references: [
          {
            id: `Reference-${webcrypto.randomUUID()}`,
            uri: '',
            hash: 'SHA-256',
            transforms: ['enveloped', 'c14n'],
          },
        ],
        signingCertificate: certificate,
        x509: [certificate],
        signerRole: { claimed: ['ObligadoTributario'] },
        policy: {
          hash: 'SHA-256',
          digestValue: POLICY_DIGEST,
          identifier: { qualifier: 'OIDAsURI', value: POLICY_URI },
        },
      },
    );

    document.documentElement.appendChild(signature.GetXml()!);
    return new XMLSerializer().serializeToString(
      document as unknown as Parameters<XMLSerializer['serializeToString']>[0],
    );
  }
}
