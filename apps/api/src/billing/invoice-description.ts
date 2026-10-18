/**
 * Invoice.description yazim siniri.
 *
 * Sutun VARCHAR(191): semada `description String?` (MySQL'de Prisma'nin String
 * varsayilani VARCHAR(191)), init migration'da `description VARCHAR(191) NULL`.
 *
 * NEDEN VAR: markInvoiceFailed basarisizlik nedenini aciklamanin sonuna ekleyip
 * 500 karaktere kirpiyordu. Uzun bir PayTR hata metni sutunu asinca MySQL
 * (strict mod) yazimi reddediyor, Prisma P2000 atiyor, PayTR bildirimi 500
 * donuyordu. PayTR "OK" almadikca ayni bildirimi yeniden gonderir; fatura
 * PENDING'de kaliyor, her tekrar ayni hataya carpiyordu.
 *
 * Sinir KARAKTER (kod noktasi) sayisidir: utf8mb4'te VARCHAR(n) n karakter
 * tutar. String.slice UTF-16 birimi sayar ve emoji gibi iki birimlik bir
 * karakteri ortadan bolebilir; Array.from kod noktasi uzerinden keser.
 */
export const INVOICE_DESCRIPTION_MAX = 191;

/** Invoice.description'a yazilacak her metin buradan gecer. */
export function capInvoiceDescription(text: string): string {
  const chars = Array.from(text);
  return chars.length <= INVOICE_DESCRIPTION_MAX ? text : chars.slice(0, INVOICE_DESCRIPTION_MAX).join('');
}

/**
 * Basarisiz odeme aciklamasi. Asil aciklama BASTA kalir: odeme donemi oradan
 * okunur (subscription-period.ts cycleFromDescription "— annual"); kirpma
 * gerekirse saglayici mesajinin sonundan kirpilir.
 */
export function failedInvoiceDescription(base: string | null | undefined, code?: string, msg?: string): string {
  return capInvoiceDescription(`${base ?? ''} — ${code ?? '?'}: ${msg ?? ''}`);
}
