/**
 * Google API'lerine JSON istegi — native https, IPv4 zorunlu.
 *
 * NEDEN native + family 4: prod sunucuda googleapis/gaxios ve fetch IPv6 uzerinden ETIMEDOUT veriyordu
 * (bkz. auth/gsc-oauth.service.ts nativeHttpsJson). Ayni tuzaga dusmemek icin GBP/Places cagrilari da IPv4.
 * Hata govdesi yalniz loga gider; disari kisa kod/mesaj cikar.
 */
import * as https from 'node:https';

export class GoogleIstekHatasi extends Error {
  constructor(public readonly status: number, public readonly govde: unknown, mesaj: string) {
    super(mesaj);
  }
}

export interface GoogleIstek {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  /** application/x-www-form-urlencoded govde (OAuth token ucu) */
  form?: Record<string, string>;
  timeoutMs?: number;
}

export function googleJson<T = any>(req: GoogleIstek): Promise<T> {
  const u = new URL(req.url);
  const govde = req.form
    ? new URLSearchParams(req.form).toString()
    : req.body !== undefined ? JSON.stringify(req.body) : undefined;
  const headers: Record<string, string> = { Accept: 'application/json', ...(req.headers ?? {}) };
  if (govde !== undefined) {
    headers['Content-Type'] = req.form ? 'application/x-www-form-urlencoded' : 'application/json';
    headers['Content-Length'] = Buffer.byteLength(govde).toString();
  }
  const timeoutMs = req.timeoutMs ?? 20_000;
  return new Promise<T>((resolve, reject) => {
    const r = https.request(
      { method: req.method, hostname: u.hostname, port: 443, path: u.pathname + u.search, family: 4, timeout: timeoutMs, headers },
      (res) => {
        const parcalar: Buffer[] = [];
        res.on('data', (c) => parcalar.push(c));
        res.on('end', () => {
          const metin = Buffer.concat(parcalar).toString('utf-8');
          let json: any = null;
          try { json = metin ? JSON.parse(metin) : {}; } catch { json = metin; }
          const status = res.statusCode ?? 0;
          if (status >= 200 && status < 300) return resolve(json as T);
          const mesaj = json?.error?.message ?? json?.error_description ?? json?.error ?? `HTTP ${status}`;
          reject(new GoogleIstekHatasi(status, json, String(mesaj).slice(0, 300)));
        });
      },
    );
    r.on('timeout', () => r.destroy(new Error(`istek zaman asimi (${timeoutMs} ms)`)));
    r.on('error', reject);
    if (govde !== undefined) r.write(govde);
    r.end();
  });
}
