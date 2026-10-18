import * as cheerio from 'cheerio';

/**
 * Ajan isletilebilirligi — ana sayfa HTML'inden bilgi amacli (puansiz) sinyaller.
 * Saf: yalniz scan()'de zaten cekilmis ana sayfa HTML'ini okur, ek istek yok.
 *
 * Ne olcer, neden:
 *  - Tiklanabilir iletisim: tel: ve WhatsApp (wa.me / api.whatsapp.com)
 *    linkleri — kullanici adina hareket eden ajan arama/mesaj baslatmak icin
 *    duz metin numara yerine bunlari kullanabilir.
 *  - Form anlamlari: etiket (label / aria-label / aria-labelledby), dogru input
 *    turu (tel/email/date/time) ve autocomplete. Chrome'un WebMCP bildirimsel
 *    API'si toolparamdescription yoksa alanin <label>'ini kullanir:
 *    https://developer.chrome.com/docs/ai/webmcp/declarative-api
 *  - Rezervasyon yalniz baska alan adindan iframe ise ajan onu isletemeyebilir;
 *    dogrudan bir rezervasyon linki de olmali.
 *  - Bildirimsel WebMCP (form toolname / tooldescription / toolparamdescription):
 *    Chrome 149 ile origin trial'da; yalniz bilgi:
 *    https://developer.chrome.com/blog/ai-webmcp-origin-trial
 * Siralama etkisi IDDIA EDILMEZ; kopya "ajanlar/tarayicilar siteyi isletmek
 * icin bunlari kullanir" der.
 */

export interface OperabilityReport {
  contact: { tel: number; whatsapp: number };
  forms: {
    count: number;
    /** Kullaniciya gorunen alan sayisi (hidden/submit/button haric) */
    fields: number;
    labeled: number;
    /** Etiketsiz alan ornekleri (en fazla 5) */
    unlabeled: string[];
    /** Anlamina uymayan tur ornekleri — ör. "telefon alanı type=text" (en fazla 5) */
    typeMismatches: string[];
    autocomplete: number;
  };
  booking: { iframeHosts: string[]; directLink: boolean };
  webmcp: { forms: number; described: number; params: number };
}

/** Bilinen rezervasyon/randevu servisleri — yalniz tespit icin (alt alan adlari da eslesir) */
const BOOKING_HOSTS = [
  'calendly.com', 'acuityscheduling.com', 'setmore.com', 'simplybook.me', 'booksy.com', 'fresha.com',
  'squareup.com', 'square.site', 'opentable.com', 'resy.com', 'sevenrooms.com', 'tidycal.com',
  'youcanbook.me', 'zcal.co', 'savvycal.com', 'cal.com', 'meetings.hubspot.com', 'calendar.app.google',
  'treatwell.com', 'vagaro.com', 'mindbodyonline.com', 'planity.com',
];

const BOOKING_WORDS = /randevu|rezervasyon|booking|appointment|reservation|book-?now|reserve/i;
const SKIP_INPUT = new Set(['hidden', 'submit', 'button', 'reset', 'image']);

function hostOf(raw: string, base: string): string | null {
  try { return new URL(raw, base).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; }
}

const isBookingHost = (host: string) => BOOKING_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));

/** Alan adi/etiketinden beklenen tur — yalniz type=text (ya da tursuz) alanlarda uyari */
function expectedType(hint: string): { type: string; label: string } | null {
  if (/e-?mail|e-?posta/i.test(hint)) return { type: 'email', label: 'e-posta' };
  const tokens = hint.toLowerCase().split(/[^a-z0-9ğüşöçı]+/i);
  if (tokens.some((t) => ['tel', 'phone', 'telephone', 'telefon', 'gsm', 'cep', 'mobile'].includes(t))) return { type: 'tel', label: 'telefon' };
  if (tokens.some((t) => ['date', 'tarih'].includes(t))) return { type: 'date', label: 'tarih' };
  if (tokens.some((t) => ['time', 'saat'].includes(t))) return { type: 'time', label: 'saat' };
  return null;
}

export function assessOperability(html: string, baseUrl: string): OperabilityReport {
  const report: OperabilityReport = {
    contact: { tel: 0, whatsapp: 0 },
    forms: { count: 0, fields: 0, labeled: 0, unlabeled: [], typeMismatches: [], autocomplete: 0 },
    booking: { iframeHosts: [], directLink: false },
    webmcp: { forms: 0, described: 0, params: 0 },
  };
  if (!html) return report;
  const $ = cheerio.load(html);
  const siteHost = hostOf(baseUrl, baseUrl);

  $('a[href]').each((_, el) => {
    const href = ($(el).attr('href') ?? '').trim();
    if (/^tel:/i.test(href)) report.contact.tel++;
    else if (/^(https?:)?\/\/(wa\.me|api\.whatsapp\.com)\//i.test(href) || /^whatsapp:\/\/send/i.test(href)) report.contact.whatsapp++;
    if (!report.booking.directLink) {
      const host = hostOf(href, baseUrl);
      if ((host && isBookingHost(host)) || BOOKING_WORDS.test(href) || BOOKING_WORDS.test($(el).text())) report.booking.directLink = true;
    }
  });

  $('iframe[src]').each((_, el) => {
    const src = $(el).attr('src') ?? '';
    const host = hostOf(src, baseUrl);
    if (!host || host === siteHost) return;
    const looksBooking = isBookingHost(host) || BOOKING_WORDS.test(src) || BOOKING_WORDS.test($(el).attr('title') ?? '');
    if (looksBooking && !report.booking.iframeHosts.includes(host)) report.booking.iframeHosts.push(host);
  });

  // label[for] haritasi bir kez: id'de ozel karakter olsa da secici kurmaya gerek kalmaz
  const labelFor = new Map<string, string>();
  $('label[for]').each((_, el) => {
    const f = $(el).attr('for');
    if (f && !labelFor.has(f)) labelFor.set(f, $(el).text());
  });

  const forms = $('form');
  report.forms.count = forms.length;
  forms.each((_, form) => {
    const $form = $(form);
    if ($form.attr('toolname')?.trim()) {
      report.webmcp.forms++;
      if ($form.attr('tooldescription')?.trim()) report.webmcp.described++;
      report.webmcp.params += $form.find('[toolparamdescription]').length;
    }
    $form.find('input, select, textarea').each((__, field) => {
      const $f = $(field);
      const tag = (field as any).tagName?.toLowerCase?.() ?? (field as any).name;
      const type = ($f.attr('type') ?? (tag === 'input' ? 'text' : tag)).toLowerCase();
      if (tag === 'input' && SKIP_INPUT.has(type)) return;
      report.forms.fields++;

      const id = $f.attr('id');
      const labelText = (id ? labelFor.get(id) ?? '' : '') || $f.closest('label').text();
      const labeled = !!($f.attr('aria-label')?.trim() || $f.attr('aria-labelledby')?.trim() || labelText.trim());
      const nameHint = $f.attr('name') ?? id ?? $f.attr('placeholder') ?? tag;
      if (labeled) report.forms.labeled++;
      else if (report.forms.unlabeled.length < 5) report.forms.unlabeled.push(nameHint);

      const ac = ($f.attr('autocomplete') ?? '').trim().toLowerCase();
      if (ac && ac !== 'off') report.forms.autocomplete++;

      if (tag === 'input' && type === 'text') {
        const exp = expectedType([$f.attr('name'), id, $f.attr('placeholder'), labelText].filter(Boolean).join(' '));
        if (exp && report.forms.typeMismatches.length < 5) report.forms.typeMismatches.push(`${exp.label} alanı type="text" (önerilen type="${exp.type}")`);
      }
    });
  });

  return report;
}
