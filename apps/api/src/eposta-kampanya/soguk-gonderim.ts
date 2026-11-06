/**
 * Soguk gonderim araci (Instantly / Smartlead / Lemlist vb.) icin disa aktarim + RanksUp'in kendi ret linki (02.11.2026).
 *
 * NEDEN: Mailjet onaysiz (toplanmis) listeye gonderimi yasakliyor ve hesabi bu yuzden kapatti; kurumsal rol kutusu
 * kampanyasi kendi posta kutularindan gonderen bir araca tasiniyor. Aracin kendi ret linki yalniz aracin listesini
 * kapatir — bizim tablomuz (RET → 3 is gunu icinde IYS'ye ret bildirimi, md. 6/6) haberdar olmaz. Bu yuzden her
 * satira imzali bir RanksUp ret URL'si konur; tiklaninca satir RET olur.
 *
 * Metinler eposta-sablon.ts'den (Mailjet ile ayni govde, ayni kimlik satiri); burada yalniz Mailjet sozdizimi
 * aracin degisken sozdizimine ({{firma}}) cevrilir. Her aracta CSV sutun adi = degisken adi.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { toCsv } from '../prospect/prospect-utils.js';
import {
  type EpostaKimlik, SEKTOR_META, firmaKisa, isimsizHitap, konuSatiri, metinBlogu, metinSablon, sablonSektoru, sektorSorusu,
} from '../prospect/eposta-sablon.js';

/** Disa aktarim CSV sutunlari (aracta {{sutun}} olarak kullanilir) */
export const SOGUK_SUTUNLAR = ['email', 'firma', 'firma_tam', 'sektor', 'sektor_sorusu', 'varyant', 'konu', 'ret_url', 'web'] as const;

/**
 * Ret imzasi icin sir. NEDEN ayri ad + NEXTAUTH yedegi: gonderilmis maillerdeki linkler aylarca calismali; sir
 * degisirse eski linkler gecersiz olur. Prod'da her zaman tanimli olan NEXTAUTH_SECRET'e dusulur, ad alani ile ayrilir.
 */
export function retSirri(env: Record<string, string | undefined> = process.env): string | null {
  return env.EPOSTA_RET_SECRET?.trim() || env.NEXTAUTH_SECRET?.trim() || env.AUTH_SECRET?.trim() || null;
}

const normal = (email: string) => email.trim().toLowerCase();

export function retImzasi(email: string, sir: string): string {
  return createHmac('sha256', `ranksup-eposta-ret:${sir}`).update(normal(email)).digest('base64url').slice(0, 32);
}

export function retImzaGecerli(email: unknown, t: unknown, sir: string | null): boolean {
  if (!sir || typeof email !== 'string' || typeof t !== 'string' || !email.includes('@') || !t) return false;
  const a = Buffer.from(retImzasi(email, sir));
  const b = Buffer.from(t);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function retUrl(email: string, sir: string, base: string): string {
  const kok = base.replace(/\/+$/, '');
  return `${kok}/api/eposta/ret?e=${encodeURIComponent(normal(email))}&t=${retImzasi(email, sir)}`;
}

/** Mailjet sozdizimi → arac sozdizimi. Kalinti (cevrilemeyen etiket) varsa null: yarim metin aracin eline gecmesin. */
export function aracSozdizimi(s: string): string | null {
  const out = s
    .replace(/\[\[UNSUB_LINK_EN\]\]/g, '{{ret_url}}')
    .replace(/\{\{var:([a-z_]+)\}\}/g, '{{$1}}');
  return /\[\[|\{\{var:|\{\{(ad|soyad|unvan)\}\}/.test(out) ? null : out;
}

/**
 * Paragraf ici sabit satir kirilimlarini birlestir. NEDEN: md bloklari ~90 karakterde elle kirilmis; araclar duz metni
 * aynen gonderir, mobilde cumle ortasinda kopuk satir gorunur. Kural: satir noktalama ile bitmiyor VE sonraki satir
 * kucuk harfle basliyorsa ayni cumlenin devamidir. Imza/hitap ("Saygılarımla,", ad, unvan) noktalama ya da buyuk harfle ayrilir.
 */
export function satirBirlestir(s: string): string {
  return s.replace(/([^\s.,:;!?)\]])\n(?=[a-zçğıöşü"“(])/g, '$1 ');
}

/** Imza satiri — mesajDenetimi ile ayni bicim ("<adres> · <kimlik>") */
export function imzaSatiri(k: EpostaKimlik): string {
  return `${k.gonderenAdres.trim()} · ${k.kimlik.trim() || `MERSİS ${k.mersis.trim()}`}`;
}

export type SogukSablon = { ad: string; konu: string; govde: string };

/** Firmaya ozel tiklama baglantisi: ranksup.ai/e/<hedef id> (web /e/[id] kaydeder, siteye yonlendirir) */
export function tikUrl(id: string, site: string): string {
  return `${site.replace(/\/+$/, '')}/e/${encodeURIComponent(id)}`;
}

/**
 * Imza satirindaki "· ranksup.ai" → firmaya ozel tiklama baglantisi. NEDEN imza: metindeki tek site baglantisi
 * orasi; metne yeni bir cagri eklenmez (09.09 ton karari). Satir bulunamazsa (sablon degisti) metin aynen doner —
 * takipsiz gider, bozuk metin gitmez.
 */
export function tikBaglantisiEkle(govde: string, k: EpostaKimlik, url: string): string {
  const eski = `${imzaSatiri(k)} · ranksup.ai`;
  return govde.includes(eski) ? govde.replace(eski, `${imzaSatiri(k)} · ${url}`) : govde;
}

/**
 * Sektor govdesi + 2 takip, arac sozdizimiyle. Takip bloklarinda md. 5/1 kimlik satiri yok (kisa imza) → sona eklenir.
 * Hata firlatir: hitap kurulamazsa, ret linki ya da imza eksikse (eksik metin disa aktarilmaz).
 */
export function sogukSablonlar(sektor: string, k: EpostaKimlik): SogukSablon[] {
  const eksikKimlik = [!k.gonderenAd.trim() && 'gönderen adı', !k.gonderenAdres.trim() && 'adres', !(k.kimlik || k.mersis).trim() && 'kimlik/MERSİS'].filter(Boolean);
  if (eksikKimlik.length) throw new Error(`Gönderici kimliği eksik (md. 5/1): ${eksikKimlik.join(', ')}`);
  const imza = imzaSatiri(k);
  const hazirla = (ad: string, ham: string, ekImza: boolean): string => {
    const hitapli = isimsizHitap(ham);
    if (!hitapli) throw new Error(`${ad}: "Sayın {{ad}} {{soyad}}," hitap satırı yok`);
    let govde = aracSozdizimi(satirBirlestir(hitapli));
    if (!govde) throw new Error(`${ad}: çevrilemeyen etiket kaldı`);
    if (ekImza && !govde.includes(imza)) govde = `${govde.trimEnd()}\n${imza} · ranksup.ai`;
    const eksik = [!govde.includes('{{ret_url}}') && 'ret linki', !govde.includes(imza) && 'imza/kimlik satırı'].filter(Boolean);
    if (eksik.length) throw new Error(`${ad}: ${eksik.join(', ')} yok`);
    return govde;
  };
  const meta = SEKTOR_META[sektor] ?? SEKTOR_META.diger;
  return [
    { ad: `İlk e-posta (${meta.mdBaslik})`, konu: '{{konu}}', govde: hazirla('İlk e-posta', metinSablon(sektor, k), false) },
    { ad: 'Takip 1 (4 gün sonra, yanıt yoksa)', konu: 'Re: {{konu}}', govde: hazirla('Takip 1', metinBlogu('Takip 1', k), true) },
    { ad: 'Takip 2 (9 gün sonra, son)', konu: 'Son mesaj — {{firma}} için AI görünürlük', govde: hazirla('Takip 2', metinBlogu('Takip 2', k), true) },
  ];
}

export type SogukHedef = { email: string; firma: string; marka: string | null; sektor: string; varyant: string; web: string | null };

export function sogukSatir(h: SogukHedef, sir: string, base: string): Record<(typeof SOGUK_SUTUNLAR)[number], string> {
  const firma = h.marka?.trim() || firmaKisa(h.firma);
  const varyant = h.varyant === 'B' ? 'B' : 'A';
  // Sablon secimi (B2B firma Sablon B'nin alisveris metnini almaz) — bkz. sablonSektoru
  const sektor = sablonSektoru(h.firma, h.sektor, h.web);
  return {
    email: normal(h.email),
    firma,
    firma_tam: h.firma,
    sektor,
    sektor_sorusu: sektorSorusu(h.firma, sektor, undefined, h.web),
    varyant,
    konu: konuSatiri(sektor, varyant, firma),
    ret_url: retUrl(h.email, sir, base),
    web: h.web ?? '',
  };
}

/** Disa aktarim paketi: CSV + sektor basina sablon metni (aracta bir kez yapistirilir) */
export function sogukPaket(hedefler: SogukHedef[], k: EpostaKimlik, sir: string, base: string): { csv: string; sablonlar: string } {
  const csv = toCsv(hedefler.map((h) => sogukSatir(h, sir, base)), [...SOGUK_SUTUNLAR]);
  const sektorler = [...new Set(hedefler.map((h) => sablonSektoru(h.firma, h.sektor, h.web)))].sort();
  const parcalar = [
    'RanksUp — soğuk gönderim şablonları',
    'Değişkenler CSV sütunlarıdır: {{firma}}, {{konu}}, {{sektor_sorusu}}, {{ret_url}} …',
    'Aracın kendi "abonelikten çık" bağlantısını da açık bırakın; {{ret_url}} RanksUp listesini (ve İYS ret takibini) kapatır.',
    'Açılma/tıklama takibini KAPALI tutun (teslim oranını düşürür).',
  ];
  for (const s of sektorler) {
    parcalar.push('', '='.repeat(72), `SEKTÖR: ${s} (${SEKTOR_META[s]?.ad ?? s}) — CSV'de sektor=${s} olan satırlar`, '='.repeat(72));
    for (const t of sogukSablonlar(s, k)) parcalar.push('', `--- ${t.ad} ---`, `Konu: ${t.konu}`, '', t.govde);
  }
  return { csv, sablonlar: parcalar.join('\n') + '\n' };
}

/**
 * Ret sayfasi. 'onay': GET — tek dugmeli form, ayni adrese (sorgu dizesi korunur) POST eder; 'tamam': POST sonrasi.
 * Tek dil yeter: alicilar TR kurumlari.
 */
export function retSayfasi(durum: 'onay' | 'tamam' | 'gecersiz'): string {
  const icerik = {
    onay: {
      baslik: 'Listeden çıkmak istiyor musunuz?',
      metin: 'Onaylarsanız bu adrese RanksUp\'tan bir daha tanıtım e-postası gönderilmez.',
      dugme: '<form method="post" style="margin-top:20px"><button type="submit" style="background:#1e1b18;color:#faf7f2;border:0;border-radius:8px;padding:12px 20px;font-size:15px;cursor:pointer">Listeden çık</button></form>',
    },
    tamam: {
      baslik: 'Listeden çıkarıldınız',
      metin: 'Bu adrese RanksUp\'tan bir daha tanıtım e-postası gönderilmeyecek. Ret talebiniz en geç 3 iş günü içinde İYS\'ye de bildirilir.',
      dugme: '',
    },
    gecersiz: {
      baslik: 'Bağlantı geçersiz',
      metin: 'Bağlantı eksik ya da bozuk görünüyor. Listeden çıkmak için e-postayı yanıtlayıp "ret" yazmanız yeterli.',
      dugme: '',
    },
  }[durum];
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${icerik.baslik} — RanksUp</title></head>`
    + `<body style="margin:0;background:#faf7f2;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1e1b18"><main style="max-width:480px;margin:15vh auto;padding:0 20px">`
    + `<h1 style="font-size:22px;margin:0 0 12px">${icerik.baslik}</h1><p style="font-size:15px;line-height:1.55;color:#4a4540;margin:0">${icerik.metin}</p>${icerik.dugme}`
    + `<p style="font-size:13px;color:#8a8178;margin-top:28px">RanksUp · ranksup.ai</p></main></body></html>`;
}
