import crypto from 'node:crypto';

const KEY = process.env.ENCRYPTION_KEY ?? '0'.repeat(64);

export function encrypt(text: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(KEY, 'hex'), iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decrypt(payload: string): string {
  const [ivHex, authTagHex, dataHex] = payload.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(KEY, 'hex'), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
  return decrypted.toString('utf8');
}

/**
 * PublishTarget.credentials'i coz — IKI FORMATI DA bilir.
 *
 * NEDEN BURADA: bu mantik UC yerde ayri ayri yaziliydi
 * (`publisher.service.ts`, `auto-fix.service.ts`,
 * `stuck-page-external-recovery.service.ts`) ve UCUNCUSU EKSIKTI:
 * yalnizca eski alan-bazli yolu uyguluyordu. `create()`/`update()`
 * bugun `{ enc: "iv:tag:ciphertext" }` yaziyor
 * (`publish-targets.service.ts:109,136`), dolayisiyla o dosya adaptore
 * `{ enc: '{"baseUrl":...}' }` veriyordu: `baseUrl` hic ulasmiyor,
 * `publish()` "credentials eksik" donuyordu. Takili sayfa kurtarma
 * ozelligi bu yuzden — enum yazimi duzeltildikten SONRA BILE —
 * disariya hic yazamiyordu.
 *
 * Kopyalanan bir yardimci, kopyalardan biri geride kalinca sessiz
 * bir hataya donusuyor. Tek kaynak burada.
 *
 * Yeni format: { enc: "<iv>:<tag>:<ciphertext>" } — tum alanlar tek JSON
 * string'inde. Eski format: her alan ayri ayri sifreli (geriye uyumluluk;
 * eski kayitlar migrate EDILMEDI, o yuzden ikinci yol silinemez).
 */
export function decryptCredentials(creds: Record<string, any> | null | undefined): Record<string, any> {
  if (!creds || typeof creds !== 'object') return {};

  if (typeof creds.enc === 'string' && creds.enc.includes(':')) {
    try {
      const parsed = JSON.parse(decrypt(creds.enc));
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // bozuk/eski kayit — asagidaki alan-bazli yola dus
    }
  }

  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(creds)) {
    if (typeof v === 'string' && v.includes(':')) {
      try { out[k] = decrypt(v); } catch { out[k] = v; }
    } else {
      out[k] = v;
    }
  }
  return out;
}
