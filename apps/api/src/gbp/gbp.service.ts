import { BadRequestException, HttpException, HttpStatus, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { encrypt, decrypt } from '@luviai/shared';
import { PrismaService } from '../prisma/prisma.service.js';
import { LLMProviderService } from '../llm/llm-provider.service.js';
import { ANON_MODEL_FALLBACK } from '../llm/model-tier.js';
import { readSiteNap } from '../audit/site-nap.js';
import { OAuthFlowError } from '../auth/oauth-state.js';
import { profilDenetle, type DenetimSonucu } from './gbp-denetim.js';
import { yerelSoruOnerisi, type YerelSoruOnerisi } from './gbp-yerel.js';
import { PLACES_MALIYET, alanAdi, placeAra, placeDetay, placeFotoUrl, placeIdGecerli, placesAnahtari, type PlaceAday, type PlaceAdayHam } from './places-istemci.js';
import * as gbp from './gbp-api.js';
import { googleJson, GoogleIstekHatasi } from './google-istek.js';
import { gonderiKuralIhlali, yanitTemizle } from './gbp-kurallar.js';

export const GBP_SCOPE = 'https://www.googleapis.com/auth/business.manage';

/**
 * Google Isletme Profili — denetim (Places API, onaysiz calisir) + yonetim (GBP API, onay sonrasi, GBP_API_ENABLED=1).
 *
 * HARCAMA: Places ucretli. Iki gunluk tavan (kv_store sayaci, atomik): toplam PLACES_DAILY_BUDGET_USD (vars. 3) ve
 * herkese acik karne icin ayrica PLACES_PUBLIC_DAILY_BUDGET_USD (vars. 1,5). Tavan asilirsa istek Google'a GITMEZ.
 * VERI: Places icerigi saklanmaz (yalniz placeId) — her denetim canli; panel ayni gun tekrar acarsa yine istek atilir,
 * bu yuzden site basina gunluk denetim siniri (SITE_GUNLUK_DENETIM) var.
 */
@Injectable()
export class GbpService {
  private readonly log = new Logger(GbpService.name);
  static readonly SITE_GUNLUK_DENETIM = 20;
  static readonly PUBLIC_IP_GUNLUK = 3;

  constructor(private readonly prisma: PrismaService, private readonly llm: LLMProviderService) {}

  apiAcik(): boolean {
    return process.env.GBP_API_ENABLED === '1' && !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;
  }

  // ─── Harcama defteri ───────────────────────────────────────────

  private gun(): string { return new Date().toISOString().slice(0, 10); }
  private get toplamTavan(): number { return Number(process.env.PLACES_DAILY_BUDGET_USD) || 3; }
  private get publicTavan(): number { return Number(process.env.PLACES_PUBLIC_DAILY_BUDGET_USD) || 1.5; }

  private async kvSayi(key: string): Promise<number> {
    const r = await this.prisma.kvStore.findUnique({ where: { key } });
    return r ? Number(r.value) || 0 : 0;
  }

  /** Atomik ekleme (ai-citation bumpCostKey ile ayni kalip); 3 gun sonra kv-sweep temizler */
  private async kvEkle(key: string, deger: number): Promise<number> {
    await this.prisma.$executeRawUnsafe(
      'INSERT INTO `kv_store` (`key`, `value`, `expiresAt`, `updatedAt`) VALUES (?, ?, UTC_TIMESTAMP(3) + INTERVAL 3 DAY, UTC_TIMESTAMP(3)) ' +
      'ON DUPLICATE KEY UPDATE `value` = CAST(CAST(`value` AS DECIMAL(18,8)) + ? AS CHAR), `updatedAt` = UTC_TIMESTAMP(3)',
      key, String(deger), deger,
    );
    return this.kvSayi(key);
  }

  /**
   * Harcama oncesi kapi — ONCE ekle, sonra karsilastir (atomik artis): esZamanli istekler ayni bos kapidan gecemez.
   * Tavan asildiysa eklenen geri alinir ve 503 (istek Google'a gitmez).
   */
  private async butceAyir(tutar: number, publicMi: boolean): Promise<void> {
    const g = this.gun();
    const toplam = await this.kvEkle(`places-cost:${g}`, tutar);
    const pub = publicMi ? await this.kvEkle(`places-cost-public:${g}`, tutar) : 0;
    if (toplam > this.toplamTavan || (publicMi && pub > this.publicTavan)) {
      await this.kvEkle(`places-cost:${g}`, -tutar);
      if (publicMi) await this.kvEkle(`places-cost-public:${g}`, -tutar);
      throw new ServiceUnavailableException('Google İşletme denetimi bugünlük kapasiteye ulaştı; yarın tekrar deneyin.');
    }
  }

  /** Google'a hic gitmeyen / basarisiz olan istegin ayrilan payini geri ver */
  private async butceIade(tutar: number, publicMi: boolean): Promise<void> {
    const g = this.gun();
    await this.kvEkle(`places-cost:${g}`, -tutar);
    if (publicMi) await this.kvEkle(`places-cost-public:${g}`, -tutar);
  }

  /** Atomik gunluk sayac kapisi: once artir, siniri astiysa geri al ve reddet */
  private async sayacKapisi(key: string, sinir: number, mesaj: string): Promise<void> {
    if ((await this.kvEkle(key, 1)) > sinir) {
      await this.kvEkle(key, -1);
      throw new HttpException(mesaj, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private anahtar(): string {
    const k = placesAnahtari();
    if (!k) throw new ServiceUnavailableException('Google İşletme denetimi henüz etkin değil (Places API anahtarı tanımlı değil).');
    return k;
  }

  private placesHata(err: unknown): never {
    if (err instanceof HttpException) throw err;
    const status = err instanceof GoogleIstekHatasi ? err.status : 0;
    this.log.warn(`Places hatasi (${status}): ${String((err as any)?.message ?? err).slice(0, 200)}`);
    if (status === 404) throw new NotFoundException('İşletme Google Haritalar’da bulunamadı.');
    // 400 = gecersiz anahtar/alan maskesi gibi BIZIM hatamiz — "bulunamadi" diye maskelenmesin
    if (status === 400 || status === 403) this.log.error(`Places istegi reddedildi (${status}) — anahtar/kisit/alan maskesi kontrol edilmeli`);
    throw new ServiceUnavailableException('Google’dan işletme bilgisi alınamadı; biraz sonra tekrar deneyin.');
  }

  // ─── Site: durum, arama, baglama, denetim ─────────────────────

  async durum(siteId: string) {
    const k = await this.prisma.siteGbp.findUnique({ where: { siteId } });
    return {
      placeId: k?.placeId ?? null,
      placesHazir: !!placesAnahtari(),
      apiAcik: this.apiAcik(),
      oauth: { bagli: !!k?.refreshToken, konum: k?.konum ?? null, konumAdi: k?.konumAdi ?? null, hesap: k?.hesap ?? null },
    };
  }

  static readonly KULLANICI_GUNLUK_ARAMA = 15;

  /**
   * Aday kartlari: ad/adres + kategori, puan, web sitesi, kucuk foto. Panelde (siteId) profilin web sitesi
   * sitenin alan adiyla ayniysa "siteEslesme" isaretlenir ve en uste alinir.
   */
  async ara(sorgu: string, publicMi = false, userId?: string, siteId?: string): Promise<PlaceAday[]> {
    const q = String(sorgu ?? '').trim();
    if (q.length < 3) throw new BadRequestException('İşletme adını ve şehri yazın (en az 3 karakter).');
    const k = this.anahtar();
    // Panel: tek hesap ortak gunluk butceyi tuketemesin
    if (!publicMi && userId) await this.sayacKapisi(`gbp-ara:${userId}:${this.gun()}`, GbpService.KULLANICI_GUNLUK_ARAMA, 'Bugünkü işletme arama hakkınız doldu; yarın tekrar deneyin.');
    await this.butceAyir(PLACES_MALIYET.arama, publicMi);
    let ham: PlaceAdayHam[];
    try { ham = await placeAra(q, k); } catch (e) { this.placesHata(e); }

    let siteHost: string | null = null;
    if (siteId) {
      const site = await this.prisma.site.findUnique({ where: { id: siteId }, select: { url: true } }).catch(() => null);
      siteHost = alanAdi(site?.url);
    }
    const adaylar = await Promise.all(ham.map(async ({ fotoAdi, fotoYazar, ...a }): Promise<PlaceAday> => {
      const aday: PlaceAday = { ...a, ...(siteHost ? { siteEslesme: !!a.web && a.web === siteHost } : {}) };
      if (fotoAdi) {
        const url = await this.fotoAl(fotoAdi, k, publicMi);
        if (url) aday.foto = { url, yazar: fotoYazar };
      }
      return aday;
    }));
    // Sira Google'inki; yalniz site eslesmesi one alinir (sort kararli)
    return adaylar.sort((x, y) => Number(!!y.siteEslesme) - Number(!!x.siteEslesme));
  }

  /** Foto opsiyonel: tavan doluysa ya da Google hata verirse kart fotosuz gosterilir, arama bozulmaz */
  private async fotoAl(fotoAdi: string, k: string, publicMi: boolean): Promise<string | null> {
    try { await this.butceAyir(PLACES_MALIYET.foto, publicMi); } catch { return null; }
    try {
      const url = await placeFotoUrl(fotoAdi, k);
      if (!url) await this.butceIade(PLACES_MALIYET.foto, publicMi);
      return url;
    } catch (e) {
      await this.butceIade(PLACES_MALIYET.foto, publicMi);
      this.log.warn(`Places foto alinamadi: ${String((e as any)?.message ?? e).slice(0, 160)}`);
      return null;
    }
  }

  async placeBagla(siteId: string, placeId: string) {
    if (!placeIdGecerli(placeId)) throw new BadRequestException('Geçersiz işletme kimliği');
    await this.prisma.siteGbp.upsert({ where: { siteId }, create: { siteId, placeId, placeAt: new Date() }, update: { placeId, placeAt: new Date() } });
    return { ok: true };
  }

  async placeKaldir(siteId: string) {
    await this.prisma.siteGbp.updateMany({ where: { siteId }, data: { placeId: null, placeAt: null } });
    return { ok: true };
  }

  async denetle(siteId: string): Promise<DenetimSonucu & { yerelOneri: YerelSoruOnerisi }> {
    const [kayit, site] = await Promise.all([
      this.prisma.siteGbp.findUnique({ where: { siteId } }),
      this.prisma.site.findUnique({ where: { id: siteId }, select: { url: true } }),
    ]);
    if (!kayit?.placeId) throw new BadRequestException('Önce Google İşletme Profili’nizi seçin.');
    const k = this.anahtar();
    await this.sayacKapisi(`gbp-denetim:${siteId}:${this.gun()}`, GbpService.SITE_GUNLUK_DENETIM, 'Bu site için bugünkü denetim hakkı doldu; yarın tekrar deneyin.');
    await this.butceAyir(PLACES_MALIYET.detay, false);
    let detay;
    try { detay = await placeDetay(kayit.placeId, k); } catch (e) { this.placesHata(e); }
    const nap = await readSiteNap(this.prisma, siteId).catch(() => null);
    let host: string | null = null;
    try { host = site?.url ? new URL(site.url).hostname.replace(/^www\./, '') : null; } catch { host = null; }
    return { ...profilDenetle(detay, { siteHost: host, siteNap: nap }), yerelOneri: yerelSoruOnerisi(detay) };
  }

  // ─── Herkese acik karne (lead magnet) ─────────────────────────

  private ipAnahtar(ip: string): string {
    return createHash('sha256').update(`gbp-public:${ip}:${process.env.ENCRYPTION_KEY ?? ''}`).digest('hex').slice(0, 24);
  }

  /** IP basina gunluk sinir — ARAMA ve KARNE ayri sayilmaz: ikisi de ayni hakkan duser (aramasiz karne yok) */
  async publicHakKontrol(ip: string, tuket: boolean): Promise<void> {
    const key = `gbp-public-ip:${this.ipAnahtar(ip)}:${this.gun()}`;
    const mesaj = 'Bugünkü ücretsiz Google İşletme karnesi hakkınız doldu; yarın tekrar deneyin.';
    if (!tuket) {
      if ((await this.kvSayi(key)) >= GbpService.PUBLIC_IP_GUNLUK * 2) throw new HttpException(mesaj, HttpStatus.TOO_MANY_REQUESTS);
      return;
    }
    await this.sayacKapisi(key, GbpService.PUBLIC_IP_GUNLUK * 2, mesaj);
  }

  async publicKarne(placeId: string): Promise<DenetimSonucu> {
    if (!placeIdGecerli(placeId)) throw new BadRequestException('Geçersiz işletme kimliği');
    const k = this.anahtar();
    await this.butceAyir(PLACES_MALIYET.detay, true);
    try { return profilDenetle(await placeDetay(placeId, k)); } catch (e) { this.placesHata(e); }
  }

  // ─── OAuth (GBP API onayi sonrasi) ─────────────────────────────

  redirectUri(): string { return `${process.env.API_BASE_URL}/api/gbp/oauth/callback`; }

  yetkiUrl(state: string): string {
    if (!this.apiAcik()) throw new ServiceUnavailableException('Google İşletme bağlantısı henüz açık değil (Google API onayı bekleniyor).');
    const q = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? '',
      redirect_uri: this.redirectUri(),
      response_type: 'code',
      scope: GBP_SCOPE,
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'false',
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
  }

  async baglantiTamamla(siteId: string, code: string): Promise<void> {
    const r = await googleJson<{ refresh_token?: string; scope?: string }>({
      method: 'POST', url: 'https://oauth2.googleapis.com/token',
      form: { code, client_id: process.env.GOOGLE_CLIENT_ID ?? '', client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '', redirect_uri: this.redirectUri(), grant_type: 'authorization_code' },
    }).catch((e) => { this.log.warn(`GBP token degisimi basarisiz: ${String(e?.message ?? e).slice(0, 200)}`); throw new OAuthFlowError('token_exchange_failed'); });
    if (!String(r.scope ?? '').split(' ').includes(GBP_SCOPE)) throw new OAuthFlowError('scope_not_granted');
    const eski = await this.prisma.siteGbp.findUnique({ where: { siteId } });
    const refresh = r.refresh_token ?? (eski?.refreshToken ? decrypt(eski.refreshToken) : null);
    if (!refresh) throw new OAuthFlowError('no_refresh_token');
    // Yeni baglanti baska bir Google hesabi olabilir: eski hesap/konum secimi gecersiz (403 alirdi) — yeniden secilir
    await this.prisma.siteGbp.upsert({
      where: { siteId },
      create: { siteId, refreshToken: encrypt(refresh), oauthAt: new Date() },
      update: { refreshToken: encrypt(refresh), oauthAt: new Date(), hesap: null, konum: null, konumAdi: null },
    });
  }

  async baglantiKes(siteId: string) {
    await this.prisma.siteGbp.updateMany({ where: { siteId }, data: { refreshToken: null, hesap: null, konum: null, konumAdi: null, oauthAt: null } });
    return { ok: true };
  }

  private async erisim(siteId: string): Promise<{ token: string; hesap: string | null; konum: string | null }> {
    if (!this.apiAcik()) throw new ServiceUnavailableException('Google İşletme yönetimi henüz açık değil (Google API onayı bekleniyor).');
    const k = await this.prisma.siteGbp.findUnique({ where: { siteId } });
    if (!k?.refreshToken) throw new BadRequestException('Önce Google İşletme hesabınızı bağlayın.');
    const r = await googleJson<{ access_token?: string }>({
      method: 'POST', url: 'https://oauth2.googleapis.com/token',
      form: { refresh_token: decrypt(k.refreshToken), client_id: process.env.GOOGLE_CLIENT_ID ?? '', client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '', grant_type: 'refresh_token' },
    }).catch((e) => {
      this.log.warn(`GBP erisim yenileme basarisiz (${siteId}): ${String(e?.message ?? e).slice(0, 200)}`);
      throw new BadRequestException('Google bağlantısı yenilenemedi; hesabı yeniden bağlayın.');
    });
    if (!r.access_token) throw new BadRequestException('Google bağlantısı yenilenemedi; hesabı yeniden bağlayın.');
    return { token: r.access_token, hesap: k.hesap, konum: k.konum };
  }

  private gbpHata(e: unknown): never {
    if (e instanceof HttpException) throw e;
    const status = e instanceof GoogleIstekHatasi ? e.status : 0;
    this.log.warn(`GBP API hatasi (${status}): ${String((e as any)?.message ?? e).slice(0, 200)}`);
    if (status === 401 || status === 403) throw new BadRequestException('Google bu işlem için izin vermedi. Hesabın bu profilde sahip/yönetici olduğundan emin olup yeniden bağlayın.');
    if (status === 429) throw new HttpException('Google kota sınırı; biraz sonra tekrar deneyin.', HttpStatus.TOO_MANY_REQUESTS);
    throw new ServiceUnavailableException('Google İşletme Profili’ne ulaşılamadı; biraz sonra tekrar deneyin.');
  }

  private async hazirKonum(siteId: string): Promise<{ token: string; v4: string; konum: string }> {
    const e = await this.erisim(siteId);
    if (!e.hesap || !e.konum) throw new BadRequestException('Önce yönetilecek işletme konumunu seçin.');
    return { token: e.token, v4: gbp.v4Konum(e.hesap, e.konum), konum: e.konum };
  }

  async konumListesi(siteId: string) {
    const { token } = await this.erisim(siteId);
    try {
      const out: Array<{ hesap: string; hesapAdi: string; konum: string; ad: string; adres: string; placeId: string | null }> = [];
      for (const h of (await gbp.hesaplar(token)).slice(0, 10)) {
        for (const l of await gbp.konumlar(token, h.name)) {
          out.push({
            hesap: h.name, hesapAdi: h.accountName ?? '', konum: l.name, ad: l.title ?? '',
            adres: [l.storefrontAddress?.locality, l.storefrontAddress?.administrativeArea].filter(Boolean).join(', '),
            placeId: l.metadata?.placeId ?? null,
          });
        }
      }
      return out;
    } catch (e) { this.gbpHata(e); }
  }

  async konumSec(siteId: string, hesap: string, konum: string) {
    const liste = await this.konumListesi(siteId);
    const secilen = liste.find((l) => l.hesap === hesap && l.konum === konum);
    if (!secilen) throw new BadRequestException('Bu konum hesabınızda bulunamadı.');
    await this.prisma.siteGbp.update({
      where: { siteId },
      data: { hesap, konum, konumAdi: secilen.ad.slice(0, 255), ...(secilen.placeId && placeIdGecerli(secilen.placeId) ? { placeId: secilen.placeId, placeAt: new Date() } : {}) },
    });
    return { ok: true };
  }

  async yorumListesi(siteId: string, sayfa?: string) {
    const { token, v4 } = await this.hazirKonum(siteId);
    try {
      const r = await gbp.yorumlar(token, v4, sayfa);
      return {
        ortalama: r.ortalama ?? null,
        toplam: r.toplam ?? null,
        sonraki: r.sonraki ?? null,
        yanitsiz: r.yorumlar.filter((y) => !y.reviewReply?.comment).length,
        yorumlar: r.yorumlar.map((y) => ({
          reviewId: y.reviewId, yazar: y.reviewer?.isAnonymous ? 'Anonim' : y.reviewer?.displayName ?? '',
          yildiz: gbp.YILDIZ[y.starRating ?? ''] ?? null, metin: y.comment ?? '', tarih: y.createTime ?? null,
          yanit: y.reviewReply?.comment ?? null, yanitTarih: y.reviewReply?.updateTime ?? null,
        })),
      };
    } catch (e) { this.gbpHata(e); }
  }

  /**
   * Yanit TASLAGI — gonderilmez; sahip duzenleyip onaylar. Yorumdaki kisisel veri tekrar edilmez, saglik/hukuk
   * gibi hassas iddialara girilmez, tesvik/indirim teklif edilmez (yorum politikasi).
   */
  async yanitTaslagi(siteId: string, reviewId: string) {
    const { token, v4 } = await this.hazirKonum(siteId);
    let ham: gbp.GbpYorum;
    try { ham = await gbp.yorumGetir(token, v4, reviewId); } catch (e) { this.gbpHata(e); }
    const y = { metin: ham.comment ?? '', yildiz: gbp.YILDIZ[ham.starRating ?? ''] ?? null };
    const site = await this.prisma.site.findUnique({ where: { id: siteId }, select: { name: true, userId: true } });
    const res = await this.llm.chat({
      context: 'gbp-yorum-yaniti',
      siteId,
      userId: site?.userId,
      model: process.env.GBP_REPLY_MODEL || ANON_MODEL_FALLBACK,
      systemPrompt:
        'Bir işletme sahibi adına Google yorumuna Türkçe, kısa (en fazla 4 cümle), kibar ve kişisel yanıt taslağı yaz. ' +
        'Kurallar: yorumcunun adını en fazla bir kez kullan; telefon, e-posta, bağlantı, indirim ya da hediye teklifi YAZMA; ' +
        'olumsuz yorumda özür dile, savunmaya geçme, sorunu çözmek için işletmeyle iletişime geçmeye davet et (iletişim bilgisi yazmadan); ' +
        'tıbbi/hukuki iddia ve kişisel veri tekrarı yok. Yalnız yanıt metnini döndür.',
      messages: [{ role: 'user', content: `İşletme: ${site?.name ?? ''}\nYıldız: ${y.yildiz ?? '?'}\nYorum: ${y.metin || '(metinsiz yorum)'}` }],
      maxTokens: 400,
      effort: 'low',
    });
    return { taslak: yanitTemizle(res.output) };
  }

  async yanitGonder(siteId: string, reviewId: string, metin: string) {
    const temiz = yanitTemizle(metin);
    if (temiz.length < 2) throw new BadRequestException('Yanıt boş olamaz.');
    // Google siniri 4.096 BAYT: Turkce harfler 2 bayt — karakter sayisi yaniltir
    if (Buffer.byteLength(temiz, 'utf8') > 4096) throw new BadRequestException('Yanıt çok uzun (Google sınırı 4.096 bayt, yaklaşık 2.000-4.000 karakter).');
    const { token, v4 } = await this.hazirKonum(siteId);
    try { await gbp.yorumYanitla(token, v4, reviewId, temiz); } catch (e) { this.gbpHata(e); }
    return { ok: true };
  }

  async gonderiListesi(siteId: string) {
    const { token, v4 } = await this.hazirKonum(siteId);
    try {
      return (await gbp.gonderiler(token, v4)).map((g) => ({ metin: g.summary ?? '', durum: g.state ?? '', tarih: g.createTime ?? null, url: g.searchUrl ?? null }));
    } catch (e) { this.gbpHata(e); }
  }

  async gonderiOlustur(siteId: string, girdi: { metin?: string; url?: string | null }) {
    const metin = String(girdi.metin ?? '').trim();
    if (metin.length < 20) throw new BadRequestException('Gönderi en az 20 karakter olmalı.');
    if (metin.length > 1500) throw new BadRequestException('Gönderi en fazla 1.500 karakter olabilir.');
    const ihlal = gonderiKuralIhlali(metin);
    if (ihlal) throw new BadRequestException(ihlal);
    let url: string | null = null;
    if (girdi.url) {
      try { const u = new URL(girdi.url); if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error(); url = u.toString(); } catch { throw new BadRequestException('Bağlantı geçerli bir web adresi olmalı.'); }
    }
    const { token, v4 } = await this.hazirKonum(siteId);
    try { await gbp.gonderiOlustur(token, v4, { metin, url }); } catch (e) { this.gbpHata(e); }
    return { ok: true };
  }

  async performansOzeti(siteId: string) {
    const { token, konum } = await this.hazirKonum(siteId);
    try {
      const t = await gbp.performans(token, konum, 28);
      const g = (k: string) => t[k] ?? 0;
      return {
        gun: 28,
        aramaGorunum: g('BUSINESS_IMPRESSIONS_DESKTOP_SEARCH') + g('BUSINESS_IMPRESSIONS_MOBILE_SEARCH'),
        haritaGorunum: g('BUSINESS_IMPRESSIONS_DESKTOP_MAPS') + g('BUSINESS_IMPRESSIONS_MOBILE_MAPS'),
        arama: g('CALL_CLICKS'),
        webTiklama: g('WEBSITE_CLICKS'),
        yolTarifi: g('BUSINESS_DIRECTION_REQUESTS'),
      };
    } catch (e) { this.gbpHata(e); }
  }

}
