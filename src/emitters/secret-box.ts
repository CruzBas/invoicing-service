import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const IV_LENGTH = 12;
const TAG_LENGTH = 16;

/** AES-256-GCM. Output layout: iv | tag | ciphertext. */
export class SecretBox {
  private readonly key: Buffer;

  constructor(hexKey: string) {
    this.key = Buffer.from(hexKey, 'hex');
    if (this.key.length !== 32) throw new Error('Key must be 32 bytes');
  }

  encrypt(plain: Buffer | string): Uint8Array<ArrayBuffer> {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain), cipher.final()]);
    return new Uint8Array(Buffer.concat([iv, cipher.getAuthTag(), data]));
  }

  decrypt(box: Uint8Array): Buffer {
    const buf = Buffer.from(box);
    const iv = buf.subarray(0, IV_LENGTH);
    const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(buf.subarray(IV_LENGTH + TAG_LENGTH)),
      decipher.final(),
    ]);
  }
}
