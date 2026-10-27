/**
 * Google Isletme Profili icerik kurallari — gonderi ve yorum yaniti icin saf denetimler.
 *
 * Gonderi: telefon, e-posta, sosyal medya baglantisi ve metin ici URL gonderide yasak/kaldirma sebebi
 * (Google gonderi icerik politikasi; Ekim 2026 guncellemesi — https://support.google.com/business/answer/7213077).
 * Baglanti icin gonderinin "Daha fazla bilgi" dugmesi (callToAction) kullanilir, metin icine yazilmaz.
 */

const TELEFON = /(\+?90[\s.-]?)?\(?0?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}/;
const EPOSTA = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const URL_RE = /\b(https?:\/\/|www\.)\S+|\b[\w-]+\.(com|net|org|com\.tr|net\.tr|org\.tr|io|ai|app)(\/\S*)?\b/i;
const SOSYAL = /\b(instagram|facebook|tiktok|twitter|x\.com|youtube|whatsapp|wa\.me|t\.me|telegram)\b/i;

/** Ihlal varsa kullaniciya gosterilecek Turkce aciklama, yoksa null */
export function gonderiKuralIhlali(metin: string): string | null {
  if (EPOSTA.test(metin)) return 'Gönderi metninde e-posta adresi olamaz (Google gönderi kuralı). Bağlantı için "Daha fazla bilgi" alanını kullanın.';
  if (TELEFON.test(metin)) return 'Gönderi metninde telefon numarası olamaz (Google gönderi kuralı); telefon zaten profilinizde görünüyor.';
  if (SOSYAL.test(metin)) return 'Gönderi metninde sosyal medya hesabı/bağlantısı olamaz (Google gönderi kuralı).';
  if (URL_RE.test(metin)) return 'Gönderi metnine web adresi yazmayın; bağlantıyı "Daha fazla bilgi" alanına ekleyin.';
  return null;
}

/** LLM ya da kullanici yaniti: tirnak/markdown/fazla bosluk temizligi; icerik degistirilmez */
export function yanitTemizle(metin: string): string {
  return String(metin ?? '')
    .replace(/^\s*["“”'`]+|["“”'`]+\s*$/g, '')
    .replace(/\*\*|__|^#+\s*/gm, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
