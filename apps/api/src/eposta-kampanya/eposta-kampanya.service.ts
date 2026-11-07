import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Prisma, type EpostaHedefDurum } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { parseCsv, toCsv } from '../prospect/prospect-utils.js';
import { kimlikEnv, kimlikSorunlari, mailjetMesaj, mesajDenetimi, type Alici } from '../prospect/eposta-sablon.js';
import {
  ACIK_DURUMLAR, KAPALI_DURUMLAR, bizimMesaj, eskiKanalDuraklatmasi, firmaAnahtari, mailjetJsonOku, type IceAktarSatir, frenNedeni, gonderimPenceresinde, iceAktarSatiri, olayEsle, olayZamani, tikGecerli,
  trAyBasi, trGun, trGunBasi, turKotasi,
} from './eposta-kurallar.js';
import { kisiselMi, retImzaGecerli, retSirri, sogukPaket, sogukSablonlar, sogukSatir, tikBaglantisiEkle, tikUrl } from './soguk-gonderim.js';
import { KISISEL_GECERLILIK_MS, type KisiselVeri, kisiselOku } from './kisisel.js';
import { doldur } from './smtp-kanal.js';
import { KisiselHazirlikService } from './kisisel-hazirlik.service.js';
import {
  type Kanal, type SmtpAyar, bizimKimlikler, dsnAyikla, dsnMi, kaliciRet, kanal, mesajKimligi, smtpAyar, smtpMesaj, smtpSorunlari, yanitTuru,
} from './smtp-kanal.js';
import { type ResendMesaj, resendAyar, resendMesaj, resendOlayEsle, resendSorunlari, svixDogrula } from './resend-kanal.js';
import nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';

const KV_ACIK = 'eposta-kampanya:acik';
const KV_DURAKLAT = 'eposta-kampanya:duraklatildi';
const KV_KILIT = 'eposta-kampanya:kilit';
/** IMAP okuma imleci: "<uidValidity>:<son uid>" — gelen kutusu her turda bastan taranmasin, okunmamis isaretine dokunulmasin */
const KV_IMAP = 'eposta-kampanya:imap-imlec';
/**
 * Yazma-oncesi isaret: "gonderiliyor:<tur belirteci>". Satirlar POST'tan ONCE bu isaretle SAHIPLENILIR (kosullu
 * updateMany), yalniz kendi isaretini tasiyan satirlar gonderilir ve sonuc yalniz o isaret hala duruyorsa yazilir.
 * Kalirsa "belirsiz" (gitmis olabilir) — bir daha gonderilmez.
 */
const GONDERILIYOR = 'gonderiliyor';
/** sonOlay sutun genisligi (schema.prisma VarChar(64)) — isaret buna sigmali, yoksa MySQL strict modda guncelleme duser */
export const SON_OLAY_MAX = 64;
const MAILJET = 'https://api.mailjet.com';
const RESEND = 'https://api.resend.com';
/** Saatlik/yarim saatlik tur basina en fazla — gunluk kota gune yayilsin, tek seferde 200 gitmesin */
const TUR_BASI = 40;
const KILIT_SURE_MS = 10 * 60 * 1000;
const POST_ZAMAN_ASIMI_MS = 45_000;

export type TickSonuc = { gonderildi: number; hata: number; neden: string };

/** SMTP gonderici (test icin degistirilebilir) — nodemailer transport'unun kullandigimiz kismi */
export type SmtpGonderici = { sendMail(m: Record<string, unknown>): Promise<unknown>; close(): void };
/** IMAP okuyucu (test icin degistirilebilir) */
export type GelenMesaj = { uid: number; kimden: string; konu: string; ham: string };
export type GelenOkuyucu = (a: SmtpAyar, sonrasi: string | null) => Promise<{ imlec: string; mesajlar: GelenMesaj[] }>;

/**
 * Kurumsal e-posta kampanyasi — sunucu tarafi (27.10.2026). Hedefler `eposta_hedefleri` tablosunda; worker
 * EPOSTA_KAMPANYA_TICK 30 dk'da bir tick() cagirir. Metin/kimlik/ret linki eposta-sablon.ts'den (CLI ile ayni).
 *
 * KAPILAR (sirayla, biri tutmazsa gonderim yok):
 *  1) Panel anahtari acik (varsayilan KAPALI) ve duraklatilmamis
 *  2) Hafta ici 10-17 TR
 *  3) Mailjet anahtari + gonderici kimligi (md. 5/1) tam, sablonda kalinti yok
 *  4) Son 7 gun bounce <= %3, spam <= %0,2 (asilirsa DURAKLAT + neden)
 *  5) Gunluk (200) / aylik (6.000) kota, tur basina 40
 *  6) Yalniz SIRADA satirlar — kullanicinin "IYS'ye yukledim" dedigi partiler (Yonetmelik md. 6/6)
 */
@Injectable()
export class EpostaKampanyaService {
  private readonly log = new Logger(EpostaKampanyaService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly kisiselHazirlik?: KisiselHazirlikService,
  ) {}

  /**
   * Kisisel mail stogu: gonderim sirasindaki adresleri onceden hazirlar (worker her turdan once cagirir).
   * Kampanya kapaliyken para harcamaz. Stok hedefi gunluk kotanin iki kati (pazartesi sabahina hazir olsun).
   */
  async kisiselHazirla(o: { zorla?: boolean; adet?: number } = {}) {
    if (!this.kisiselHazirlik) return { hazirlanan: 0, incele: 0, ertelenen: 0, stok: 0, neden: 'Hazırlık servisi yok' };
    if (!o.zorla && !(await this.isAcik())) return { hazirlanan: 0, incele: 0, ertelenen: 0, stok: 0, neden: 'Kampanya kapalı' };
    return this.kisiselHazirlik.hazirla({ stokHedefi: this.gunlukKota * 2, adet: o.adet });
  }

  /** Bir hedefe gidecek ilk mailin tam metni (panel onizlemesi). Kisisel hazir degilse neden doner, metin uretilmez. */
  async onizleme(id: string): Promise<{ hazir: boolean; neden?: string; konu?: string; govde?: string }> {
    const h = await this.prisma.epostaHedef.findUnique({ where: { id } });
    if (!h) throw new BadRequestException('Hedef yok');
    const kisisel = kisiselOku(h.kisisel);
    if (h.sektor !== 'ajans' && !kisisel) {
      const neden = (h.kisisel as { neden?: string } | null)?.neden;
      return { hazir: false, neden: h.kisiselDurum === 'INCELE' ? `İncelenmeli: ${neden ?? 'neden yok'}` : 'Kişisel metin henüz hazırlanmadı' };
    }
    const sir = retSirri() ?? 'onizleme';
    const base = process.env.API_PUBLIC_URL || 'https://api.ranksup.ai';
    const satir = sogukSatir({ ...h, kisisel }, sir, base);
    const kimlik = kimlikEnv();
    const [ilk] = sogukSablonlar(satir.sektor, kimlik);
    return { hazir: true, konu: doldur(ilk.konu, satir), govde: tikBaglantisiEkle(doldur(ilk.govde, satir), kimlik, tikUrl(h.id, this.site)) };
  }

  /** INCELE'deki hedefi yeniden hazirlanmaya birak (panel "Yeniden dene") */
  async kisiselSifirla(id: string): Promise<{ ok: true }> {
    await this.prisma.epostaHedef.updateMany({ where: { id, kisiselDurum: { in: ['INCELE', 'HAZIR'] } }, data: { kisiselDurum: null, kisisel: Prisma.DbNull, kisiselAt: null } });
    return { ok: true };
  }

  /** SMTP baglantisi ve gelen kutusu okuyucu — testler sahte verir */
  smtpFabrika: (a: SmtpAyar) => SmtpGonderici = (a) =>
    nodemailer.createTransport({ host: a.host, port: a.port, secure: a.secure, auth: { user: a.user, pass: a.pass } }) as unknown as SmtpGonderici;
  gelenOku: GelenOkuyucu = imapOku;

  private get kanal(): Kanal { return kanal(); }
  /**
   * NEDEN SMTP'de dusuk: yeni alan adi + paylasimli sunucu IP'si; hacim yavas artmali (isinma).
   * NEDEN Resend'de dusuk: ayni hesap sistem e-postalarini da tasiyor (ucretsiz plan gunde 100, ortak) ve hesap
   * soguk gonderim yuzunden kapanirsa admin girisi/musteri postalari durur.
   */
  private get gunlukKota(): number {
    if (this.kanal === 'smtp') return Number(process.env.EPOSTA_SMTP_GUNLUK) || 30;
    if (this.kanal === 'resend') return Number(process.env.EPOSTA_RESEND_GUNLUK) || 40;
    return Number(process.env.EPOSTA_GUNLUK_KOTA) || 200;
  }
  private get turBasi(): number {
    if (this.kanal === 'smtp') return Number(process.env.EPOSTA_SMTP_TUR) || 10;
    if (this.kanal === 'resend') return Number(process.env.EPOSTA_RESEND_TUR) || 10;
    return TUR_BASI;
  }
  /** Resend kanalinda yanitlarin okunacagi kutu (Reply-To) — verilmezse gelen kutusu okunmaz, yanitlar elle izlenir */
  private get resendImap(): SmtpAyar | null {
    const e = process.env;
    const user = e.EPOSTA_IMAP_USER?.trim(), pass = e.EPOSTA_IMAP_PASS, host = e.EPOSTA_IMAP_HOST?.trim();
    if (!user || !pass || !host) return null;
    return { ...smtpAyar(), user, pass, imapHost: host, imapPort: Number(e.EPOSTA_IMAP_PORT) || 993 };
  }
  /** SMTP'de iki mesaj arasi bekleme (ms) — saniyede onlarca mail ayni IP'den spam gibi gorunur */
  private get smtpAralik(): number { const v = Number(process.env.EPOSTA_SMTP_ARALIK_MS); return Number.isFinite(v) && v >= 0 && process.env.EPOSTA_SMTP_ARALIK_MS !== undefined ? v : 20_000; }

  /** Gonderimden once eksik ayarlar (kanala gore). Bos dizi = hazir. */
  hazirlikSorunlari(sektorler: Iterable<string> = ['ajans', 'diger', 'finans']): string[] {
    if (this.kanal === 'smtp') {
      const a = smtpAyar();
      const s = smtpSorunlari(a);
      if (!retSirri()) s.push('Ret linki için EPOSTA_RET_SECRET (ya da NEXTAUTH_SECRET) yok');
      return [...s, ...kimlikSorunlari({ ...kimlikEnv(), fromEmail: a.from, replyTo: a.from }, sektorler).filter((x) => !x.startsWith('MAILJET_FROM_EMAIL'))];
    }
    if (this.kanal === 'resend') {
      const a = resendAyar();
      const s = resendSorunlari(a);
      if (!retSirri()) s.push('Ret linki için EPOSTA_RET_SECRET (ya da NEXTAUTH_SECRET) yok');
      return [...s, ...kimlikSorunlari({ ...kimlikEnv(), fromEmail: a.from, replyTo: a.replyTo }, sektorler).filter((x) => !x.startsWith('MAILJET_FROM_EMAIL'))];
    }
    return this.mailjetHazir ? kimlikSorunlari(kimlikEnv(), sektorler) : ['MAILJET_API_KEY / MAILJET_SECRET sunucu .env dosyasında yok'];
  }

  private get aylikKota(): number { return Number(process.env.EPOSTA_AYLIK_KOTA) || 6000; }
  private get mailjetHazir(): boolean { return !!process.env.MAILJET_API_KEY && !!process.env.MAILJET_SECRET; }

  // ─── Anahtar / duraklatma ─────────────────────────────────────────────

  /** NEDEN catch yok: DB hatasinda "duraklatilmamis/acik" sanip gondermek yerine tur HATA ile biter (fail closed) */
  private async kv(key: string): Promise<string | null> {
    const r = await this.prisma.kvStore.findUnique({ where: { key } });
    if (!r) return null;
    if (r.expiresAt && r.expiresAt.getTime() < Date.now()) return null;
    return r.value;
  }

  private async kvYaz(key: string, value: string, expiresAt: Date | null = null): Promise<void> {
    await this.prisma.kvStore.upsert({ where: { key }, create: { key, value, expiresAt }, update: { value, expiresAt } });
  }

  async isAcik(): Promise<boolean> { return (await this.kv(KV_ACIK)) === '1'; }

  async setAcik(acik: boolean): Promise<{ acik: boolean }> {
    await this.kvYaz(KV_ACIK, acik ? '1' : '0');
    return { acik };
  }

  async duraklat(neden: string): Promise<void> {
    await this.kvYaz(KV_DURAKLAT, neden.slice(0, 500));
    this.log.warn(`E-posta kampanyasi duraklatildi: ${neden}`);
  }

  /** Duraklatma nedeni; baska kanaldan kalmis kayit (eskiKanalDuraklatmasi) silinir ve yok sayilir */
  private async duraklatma(): Promise<string | null> {
    const d = await this.kv(KV_DURAKLAT);
    if (!eskiKanalDuraklatmasi(d, this.kanal)) return d;
    await this.prisma.kvStore.deleteMany({ where: { key: KV_DURAKLAT } });
    this.log.log(`Eski kanalin duraklatmasi kaldirildi (simdiki kanal ${this.kanal}): ${d}`);
    return null;
  }

  /** E-postalardaki firmaya ozel baglantinin koku (web /e/[id]) */
  private get site(): string { return process.env.EPOSTA_SITE_URL?.trim() || 'https://ranksup.ai'; }

  async devam(): Promise<{ ok: true }> {
    await this.prisma.kvStore.deleteMany({ where: { key: KV_DURAKLAT } });
    return { ok: true };
  }

  // ─── Panel ozeti ──────────────────────────────────────────────────────

  async overview(f: { durum?: string; sektor?: string; q?: string; sayfa?: number } = {}) {
    const simdi = new Date();
    const yedi = new Date(simdi.getTime() - 7 * 86_400_000);
    const [kisiselGruplar] = await Promise.all([
      this.prisma.epostaHedef.groupBy({ by: ['kisiselDurum'], where: { durum: 'SIRADA', sektor: { not: 'ajans' } }, _count: { _all: true } }),
    ]);
    const kisiselSayilar = Object.fromEntries(kisiselGruplar.map((g) => [g.kisiselDurum ?? 'BEKLIYOR', g._count._all]));
    const [acik, duraklatma, gruplar, bugun, ay, acilan, tiklanan, partiler, son7] = await Promise.all([
      this.isAcik(),
      this.duraklatma(),
      this.prisma.epostaHedef.groupBy({ by: ['durum'], _count: { _all: true } }),
      this.prisma.epostaHedef.count({ where: { gonderildiAt: { gte: trGunBasi(simdi) } } }),
      this.prisma.epostaHedef.count({ where: { gonderildiAt: { gte: trAyBasi(simdi) } } }),
      this.prisma.epostaHedef.count({ where: { acildiAt: { not: null } } }),
      this.prisma.epostaHedef.count({ where: { tiklandiAt: { not: null } } }),
      this.prisma.epostaHedef.groupBy({ by: ['iysParti'], where: { durum: 'IYS_DOSYADA' }, _count: { _all: true }, _min: { updatedAt: true } }),
      this.son7Gun(yedi),
    ]);
    const sayilar = Object.fromEntries(gruplar.map((g) => [g.durum, g._count._all])) as Partial<Record<EpostaHedefDurum, number>>;
    const gonderilenToplam = (['GONDERILDI', 'BOUNCE', 'RET', 'SPAM'] as const).reduce((a, d) => a + (sayilar[d] ?? 0), 0)
      + (await this.prisma.epostaHedef.count({ where: { durum: 'HATA', gonderildiAt: { not: null } } }));

    const where: Prisma.EpostaHedefWhereInput = {};
    if (f.durum) where.durum = f.durum as EpostaHedefDurum;
    if (f.sektor) where.sektor = f.sektor;
    if (f.q?.trim()) where.OR = [{ firma: { contains: f.q.trim() } }, { email: { contains: f.q.trim().toLowerCase() } }];
    const sayfa = Math.max(1, Number(f.sayfa) || 1);
    const [toplamListe, liste] = await Promise.all([
      this.prisma.epostaHedef.count({ where }),
      this.prisma.epostaHedef.findMany({
        where,
        orderBy: [{ sonOlayAt: { sort: 'desc', nulls: 'last' } }, { updatedAt: 'desc' }],
        skip: (sayfa - 1) * 50,
        take: 50,
      }),
    ]);

    // LinkedIn kanali: ayni firma (adin ilk iki anlamli kelimesi) icin bot kuyrugundaki en ileri durum
    const linkedin = await this.linkedinDurumlari(liste.map((h) => h.marka || h.firma));

    const sorunlar = this.hazirlikSorunlari();
    return {
      kanal: this.kanal,
      gonderen: this.kanal === 'smtp' ? smtpAyar().from || null : this.kanal === 'resend' ? resendAyar().from || null : process.env.MAILJET_FROM_EMAIL || null,
      gelenKutusu: this.kanal === 'smtp' || (this.kanal === 'resend' && !!this.resendImap),
      // Resend panelinde webhook olustururken girilecek adres (olaylar: delivered, bounced, complained, suppressed, failed)
      webhookAdresi: this.kanal === 'resend' ? `${(process.env.API_PUBLIC_URL || 'https://api.ranksup.ai').replace(/\/+$/, '')}/api/eposta/webhooks/resend` : null,
      acik,
      duraklatma,
      pencerede: gonderimPenceresinde(simdi),
      hazir: sorunlar.length === 0,
      sorunlar,
      kota: { bugun, gunluk: this.gunlukKota, ay, aylik: this.aylikKota },
      sayilar,
      kisisel: kisiselSayilar,
      metrik: { gonderilen: gonderilenToplam, acilan, tiklanan, son7 },
      iysPartileri: partiler.filter((p) => p.iysParti).map((p) => ({ parti: p.iysParti as string, adet: p._count._all, olusturuldu: p._min.updatedAt })),
      liste: liste.map((h) => ({ ...h, linkedin: linkedin.get(firmaAnahtari(h.marka || h.firma)) ?? null })),
      toplamListe,
      sayfa,
    };
  }

  private async son7Gun(yedi: Date) {
    const [gonderilen, bounce, spam] = await Promise.all([
      this.prisma.epostaHedef.count({ where: { gonderildiAt: { gte: yedi } } }),
      this.prisma.epostaHedef.count({ where: { gonderildiAt: { gte: yedi }, durum: 'BOUNCE' } }),
      this.prisma.epostaHedef.count({ where: { gonderildiAt: { gte: yedi }, durum: 'SPAM' } }),
    ]);
    return { gonderilen, bounce, spam };
  }

  /** firma anahtari → LinkedIn'deki en ileri durum (+ kisi sayisi). Kisi adi DONMEZ. */
  private async linkedinDurumlari(firmalar: string[]): Promise<Map<string, { durum: string; kisi: number }>> {
    const out = new Map<string, { durum: string; kisi: number }>();
    const anahtarlar = new Set(firmalar.map(firmaAnahtari).filter(Boolean));
    if (anahtarlar.size === 0) return out;
    const sira = ['QUEUED', 'FAILED', 'SKIPPED', 'REQUESTED', 'ACCEPTED', 'MESSAGED', 'REPLIED'];
    const kayitlar = await this.prisma.linkedinProspect.findMany({ select: { firma: true, status: true } }).catch(() => []);
    for (const k of kayitlar) {
      const a = firmaAnahtari(k.firma);
      if (!anahtarlar.has(a)) continue;
      const prev = out.get(a);
      if (!prev) out.set(a, { durum: k.status, kisi: 1 });
      else out.set(a, { durum: sira.indexOf(k.status) > sira.indexOf(prev.durum) ? k.status : prev.durum, kisi: prev.kisi + 1 });
    }
    return out;
  }

  // ─── Ice aktarma / IYS partisi ─────────────────────────────────────────

  /**
   * 07-kurumsal-adres ciktisi (kurumsal-import.csv) → tablo. Var olan satirin durumu GERI ALINMAZ; yalniz bos
   * marka/kaynakSayfa doldurulur. CLI'dan gonderilmis satir (durum=gonderildi) GONDERILDI olarak gelir.
   */
  async iceAktar(csv: string): Promise<{ eklendi: number; guncellendi: number; atlandi: number; hatalar: string[] }> {
    const satirlar = parseCsv(String(csv ?? '').replace(/^\uFEFF/, '')).slice(0, 20_000);
    let eklendi = 0, guncellendi = 0, atlandi = 0;
    const hatalar: string[] = [];
    const gecerli: IceAktarSatir[] = [];
    const gorulen = new Set<string>();
    for (const r of satirlar) {
      const p = iceAktarSatiri(r);
      if ('hata' in p) { atlandi++; if (hatalar.length < 30) hatalar.push(p.hata); continue; }
      if (gorulen.has(p.satir.email)) { atlandi++; continue; }
      gorulen.add(p.satir.email);
      gecerli.push(p.satir);
    }
    // NEDEN 500'luk parca: satir basina iki sorgu 20k satirda Cloudflare'in 100 sn sinirini asiyordu
    for (let i = 0; i < gecerli.length; i += 500) {
      const parca = gecerli.slice(i, i + 500);
      const mevcutlar = new Map(
        (await this.prisma.epostaHedef.findMany({ where: { email: { in: parca.map((s) => s.email) } } })).map((m) => [m.email, m]),
      );
      const yeniler = parca.filter((s) => !mevcutlar.has(s.email));
      if (yeniler.length) {
        const r = await this.prisma.epostaHedef.createMany({
          skipDuplicates: true, // es zamanli ikinci ice aktarma ayni adresi eklediyse sessizce atla
          data: yeniler.map((s) => ({
            email: s.email, firma: s.firma, marka: s.marka, sektor: s.sektor, web: s.web, kaynakSayfa: s.kaynakSayfa,
            kaynak: s.kaynak, varyant: s.varyant,
            ...(s.gecmis ? { durum: 'GONDERILDI' as const, kampanya: s.gecmis.kampanya, messageId: s.gecmis.messageId, gonderildiAt: s.gecmis.gonderildiAt, sonOlay: 'sent', sonOlayAt: s.gecmis.gonderildiAt } : {}),
          })),
        });
        eklendi += r.count;
        atlandi += yeniler.length - r.count;
      }
      for (const s of parca) {
        const m = mevcutlar.get(s.email);
        if (!m) continue;
        const data: Prisma.EpostaHedefUpdateInput = {};
        if (!m.marka && s.marka) data.marka = s.marka;
        if (!m.kaynakSayfa && s.kaynakSayfa) data.kaynakSayfa = s.kaynakSayfa;
        // Gecmis gonderim yalniz ACIK durumun uzerine (RET/BOUNCE/SPAM/HARIC korunur — RET'in IYS bildirimi borcu kaybolmasin)
        if (s.gecmis && !m.gonderildiAt && (ACIK_DURUMLAR as readonly string[]).includes(m.durum)) {
          Object.assign(data, { durum: 'GONDERILDI', kampanya: s.gecmis.kampanya, messageId: s.gecmis.messageId, gonderildiAt: s.gecmis.gonderildiAt });
        }
        if (Object.keys(data).length) { await this.prisma.epostaHedef.update({ where: { id: m.id }, data }); guncellendi++; }
        else atlandi++;
      }
    }
    return { eklendi, guncellendi, atlandi, hatalar };
  }

  /** YENI satirlari tek bir IYS partisine koyar ve yukleme dosyasini dondurur. Parti verilirse ayni dosyayi yeniden uretir. */
  async iysDosyasi(parti?: string): Promise<{ parti: string; adet: number; csv: string }> {
    let p = parti?.trim();
    if (!p) {
      p = `iys-${trGun(new Date())}-${randomBytes(3).toString('hex')}`;
      await this.prisma.epostaHedef.updateMany({ where: { durum: 'YENI' }, data: { durum: 'IYS_DOSYADA', iysParti: p } });
    }
    const rows = await this.prisma.epostaHedef.findMany({ where: { iysParti: p }, orderBy: { createdAt: 'asc' }, select: { email: true, firma: true } });
    const tarih = new Date().toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' });
    // NEDEN bu sutunlar: IYS toplu yuklemede alici, izin turu (EPOSTA), alici tipi (TACIR), durum ve tarih istenir;
    // panelin indirilen sablonu farkli basliklar kullaniyorsa yuklerken eslenir.
    const csv = '﻿' + toCsv(rows.map((r) => ({ 'Alıcı': r.email, 'İzin Türü': 'EPOSTA', 'Alıcı Tipi': 'TACIR', Durum: 'ONAY', 'İzin Tarihi': tarih, Firma: r.firma })), ['Alıcı', 'İzin Türü', 'Alıcı Tipi', 'Durum', 'İzin Tarihi', 'Firma']);
    return { parti: p, adet: rows.length, csv };
  }

  /** Kullanici beyani: bu partideki adresler IYS'ye yuklendi → gonderim sirasina girer */
  async iysYuklendi(parti: string): Promise<{ sirada: number }> {
    const r = await this.prisma.epostaHedef.updateMany({ where: { iysParti: parti, durum: 'IYS_DOSYADA' }, data: { durum: 'SIRADA', iysYuklendiAt: new Date() } });
    return { sirada: r.count };
  }

  async hedefGuncelle(id: string, d: { durum?: string; not?: string | null }): Promise<{ ok: true }> {
    const data: Prisma.EpostaHedefUpdateInput = {};
    // Elle yalniz kapatici durumlar: haric tut / ret istedi (IYS'ye ret bildirimi kullanicida)
    if (d.durum === 'HARIC' || d.durum === 'RET') data.durum = d.durum;
    if (d.not !== undefined) data.not = d.not ? String(d.not).slice(0, 2000) : null;
    await this.prisma.epostaHedef.update({ where: { id }, data });
    return { ok: true };
  }

  /** LinkedIn kuyrugundaki firmalar (yalniz firma adi) → 07 --ek girdisi. Kisi verisi cikmaz. */
  async linkedinFirmalarCsv(): Promise<{ adet: number; csv: string }> {
    const rows = await this.prisma.linkedinProspect.findMany({ select: { firma: true, sektor: true, kampanya: true } });
    const tekil = new Map<string, { firma: string; web: string; sektor: string }>();
    for (const r of rows) {
      if (r.kampanya === 'YATIRIMCI' || !r.firma.trim()) continue;
      const k = firmaAnahtari(r.firma);
      if (!tekil.has(k)) tekil.set(k, { firma: r.firma.trim(), web: '', sektor: r.kampanya === 'ISBIRLIGI' ? 'ajans' : r.sektor || 'diger' });
    }
    return { adet: tekil.size, csv: toCsv([...tekil.values()], ['firma', 'web', 'sektor']) };
  }

  // ─── Soguk gonderim araci (Mailjet disi) ──────────────────────────────

  /**
   * SIRADA (IYS'ye yuklenmis) satirlari soguk gonderim aracina aktar. isaretle=true → satirlar DIS_ARAC olur;
   * Mailjet turu bir daha almaz (ayni adrese iki kanaldan gitmez). Sablon/kimlik eksikse hicbir satir isaretlenmez.
   */
  async sogukDisaAktar(o: { sektor?: string; limit?: number; isaretle?: boolean }): Promise<{ adet: number; csv: string; sablonlar: string; kampanya: string | null }> {
    const sir = retSirri();
    if (!sir) throw new BadRequestException('Ret linki için EPOSTA_RET_SECRET (ya da NEXTAUTH_SECRET) tanımlı değil');
    const kimlik = kimlikEnv();
    const limit = Math.min(Math.max(Math.floor(Number(o.limit) || 200), 1), 2000);
    // NEDEN gonderiliyor isareti haric: Mailjet turunun o an sahiplendigi satir iki kanaldan gitmesin
    const bosta: Prisma.EpostaHedefWhereInput = { durum: 'SIRADA', OR: [{ sonOlay: null }, { NOT: { sonOlay: { startsWith: GONDERILIYOR } } }] };
    const where: Prisma.EpostaHedefWhereInput = { ...bosta };
    if (o.sektor) where.sektor = o.sektor;
    const hedefler = await this.prisma.epostaHedef.findMany({
      where,
      orderBy: [{ iysYuklendiAt: 'asc' }, { createdAt: 'asc' }],
      take: limit,
      select: { id: true, email: true, firma: true, marka: true, sektor: true, varyant: true, web: true },
    });
    const base = process.env.API_PUBLIC_URL || 'https://api.ranksup.ai';
    // NEDEN once paket: sablon hatasi (eksik kimlik/ret) varsa isaretleme yapilmadan hata doner
    let paket: { csv: string; sablonlar: string };
    try {
      paket = sogukPaket(hedefler, kimlik, sir, base);
    } catch (e: any) {
      throw new BadRequestException(`Şablon hazır değil: ${e?.message ?? e}`);
    }
    if (!o.isaretle || !hedefler.length) return { adet: hedefler.length, ...paket, kampanya: null };
    const kampanya = `soguk-${trGun(new Date())}`;
    const ids = hedefler.map((h) => h.id);
    await this.prisma.epostaHedef.updateMany({
      where: { id: { in: ids }, ...bosta },
      data: { durum: 'DIS_ARAC', kampanya, sonOlay: 'dis-arac', sonOlayAt: new Date() },
    });
    // NEDEN yeniden oku: okuma ile isaretleme arasinda RET/HARIC yapilan ya da Mailjet turunun aldigi satir dosyaya girmesin
    const isaretli = new Set((await this.prisma.epostaHedef.findMany({ where: { id: { in: ids }, durum: 'DIS_ARAC', kampanya }, select: { id: true } })).map((r) => r.id));
    const giden = hedefler.filter((h) => isaretli.has(h.id));
    return { adet: giden.length, ...sogukPaket(giden, kimlik, sir, base), kampanya };
  }

  /**
   * Imzali ret linki (soguk gonderim e-postalarindaki {{ret_url}}). Imza gecerliyse adres RET olur (BOUNCE/SPAM
   * korunur); tabloda olmayan adres icin de "cikarildiniz" denir — adres var mi yok mu disari sizmaz.
   */
  retImzaGecerli(email: unknown, t: unknown): boolean {
    return retImzaGecerli(email, t, retSirri());
  }

  async retIsle(email: unknown, t: unknown): Promise<boolean> {
    if (!this.retImzaGecerli(email, t)) return false;
    await this.prisma.epostaHedef.updateMany({
      where: { email: String(email).trim().toLowerCase(), durum: { notIn: ['RET', 'BOUNCE', 'SPAM'] } },
      data: { durum: 'RET', sonOlay: 'ret-baglanti', sonOlayAt: new Date() },
    });
    return true;
  }

  /**
   * Pazarlama e-postasina ACIKCA onay vermis ve cift onayi tamamlamis aboneler (Mailjet'e yuklenebilir liste).
   * Kanit sutunlari: onay ani, cift onay ani, formun kaynagi. Iptal/geri donen haric.
   */
  async pazarlamaOnayliCsv(): Promise<{ adet: number; csv: string }> {
    const rows = await this.prisma.publicCitationSubscriber.findMany({
      where: { marketingConsentAt: { not: null }, confirmedAt: { not: null }, status: { notIn: ['UNSUBSCRIBED', 'BOUNCED', 'PENDING_OPTIN'] } },
      orderBy: { marketingConsentAt: 'asc' },
      select: { email: true, domain: true, locale: true, marketingConsentAt: true, marketingConsentSource: true, confirmedAt: true },
    });
    const tekil = new Map<string, Record<string, string>>();
    for (const r of rows) {
      // NEDEN: yeniden abonelikte confirmedAt eski kalir; onay, KENDISINDEN SONRA tamamlanan cift onayla kanitlanir
      if (tekil.has(r.email) || r.confirmedAt! < r.marketingConsentAt!) continue;
      tekil.set(r.email, {
        email: r.email,
        alan_adi: r.domain,
        dil: r.locale,
        onay_ani: r.marketingConsentAt!.toISOString(),
        cift_onay_ani: r.confirmedAt!.toISOString(),
        kaynak: r.marketingConsentSource ?? '',
      });
    }
    return { adet: tekil.size, csv: toCsv([...tekil.values()], ['email', 'alan_adi', 'dil', 'onay_ani', 'cift_onay_ani', 'kaynak']) };
  }

  // ─── Gonderim turu ─────────────────────────────────────────────────────

  /**
   * ATOMIK kilit: kvStore.key birincil anahtar → create() ikinci surecte unique hatasiyla duser (API'den elle tur ile
   * worker turu ayni anda baslasa bile biri kazanir). Suresi dolmus kilit kosullu silinip bir kez daha denenir.
   * Donus: sahiplik belirteci ya da null.
   */
  private async kilitAl(): Promise<string | null> {
    const belirtec = `${process.pid}-${randomBytes(6).toString('hex')}`;
    const dene = async () => {
      await this.prisma.kvStore.create({ data: { key: KV_KILIT, value: belirtec, expiresAt: new Date(Date.now() + KILIT_SURE_MS) } });
      return belirtec;
    };
    try {
      return await dene();
    } catch {
      await this.prisma.kvStore.deleteMany({ where: { key: KV_KILIT, expiresAt: { lt: new Date() } } });
      try { return await dene(); } catch { return null; }
    }
  }

  /** Yalniz kendi kilidini birakir (suresi dolup baskasi aldiysa ona dokunmaz) */
  private async kilitBirak(belirtec: string): Promise<void> {
    await this.prisma.kvStore.deleteMany({ where: { key: KV_KILIT, value: belirtec } }).catch(() => undefined);
  }

  async tick(opts: { zorla?: boolean } = {}): Promise<TickSonuc> {
    const bos = (neden: string): TickSonuc => ({ gonderildi: 0, hata: 0, neden });
    if (!(await this.isAcik())) return bos('Kapalı');
    const durak = await this.duraklatma();
    if (durak) return bos(`Duraklatıldı: ${durak}`);
    const simdi = new Date();
    if (!opts.zorla && !gonderimPenceresinde(simdi)) return bos('Gönderim penceresi dışında (hafta içi 10-17)');
    if (this.kanal === 'mailjet' && !this.mailjetHazir) { await this.duraklat('Mailjet anahtarı yok'); return bos('Mailjet anahtarı yok'); }
    if (this.kanal === 'smtp') {
      const s = smtpSorunlari(smtpAyar());
      if (s.length) { await this.duraklat(`SMTP ayarı: ${s.join(' · ')}`); return bos(`SMTP ayarı eksik: ${s.join(' · ')}`); }
    }
    if (this.kanal === 'resend') {
      const s = resendSorunlari(resendAyar());
      if (s.length) { await this.duraklat(`Resend ayarı: ${s.join(' · ')}`); return bos(`Resend ayarı eksik: ${s.join(' · ')}`); }
    }

    const belirtec = await this.kilitAl();
    if (!belirtec) return bos('Başka bir tur çalışıyor');
    try {
      // Asili isaret = onceki tur POST sirasinda oldu → gitmis olabilir: TEKRAR GONDERILMEZ, kotaya ve bounce
      // paydasina sayilsin diye gonderildiAt isaret zamani olur.
      const asililar = await this.prisma.epostaHedef.findMany({
        where: { durum: 'SIRADA', sonOlay: { startsWith: GONDERILIYOR }, sonOlayAt: { lt: new Date(simdi.getTime() - KILIT_SURE_MS) } },
        select: { id: true, sonOlayAt: true },
      });
      for (const a of asililar) {
        await this.prisma.epostaHedef.updateMany({
          where: { id: a.id, durum: 'SIRADA', sonOlay: { startsWith: GONDERILIYOR } },
          data: { durum: 'HATA', gonderildiAt: a.sonOlayAt, sonOlay: 'belirsiz', hata: 'Belirsiz: gönderim sırasında süreç kesildi; gitmiş olabilir — Mailjet > Messages ekranından kontrol edin' },
        });
      }
      if (asililar.length) this.log.warn(`${asililar.length} hedef belirsiz durumda HATA'ya alindi`);

      const imap = this.kanal === 'smtp' ? smtpAyar() : this.kanal === 'resend' ? this.resendImap : null;
      if (imap) {
        // NEDEN once gelen kutusu: SMTP'de webhook yok, geri donmeler okunmadan fren kor kalir; Resend'de ret yanitlari
        try {
          await this.gelenKutusuTara(imap);
        } catch (e: any) {
          return bos(`Gelen kutusu okunamadı (${e?.message ?? e}) — geri dönmeler/ret yanıtları görülmeden gönderilmez, sonraki turda tekrar`);
        }
      }
      const fren = frenNedeni(await this.son7Gun(new Date(simdi.getTime() - 7 * 86_400_000)), { ilkSikayetteDur: this.kanal === 'resend' });
      if (fren) { await this.duraklat(fren); return bos(fren); }

      const [bugun, ay] = await Promise.all([
        this.prisma.epostaHedef.count({ where: { gonderildiAt: { gte: trGunBasi(simdi) } } }),
        this.prisma.epostaHedef.count({ where: { gonderildiAt: { gte: trAyBasi(simdi) } } }),
      ]);
      const adet = turKotasi({ bugunGonderilen: bugun, ayGonderilen: ay, gunluk: this.gunlukKota, aylik: this.aylikKota, turBasi: this.turBasi });
      if (adet === 0) return bos(`Kota doldu (bugün ${bugun}/${this.gunlukKota}, ay ${ay}/${this.aylikKota})`);

      // Ajans disi hedef yalniz kisisel metni HAZIR ve olcumu tazeyken gider (07.11 karari: genel metne donus yok)
      const uygun: Prisma.EpostaHedefWhereInput = {
        durum: 'SIRADA',
        OR: [{ sonOlay: null }, { NOT: { sonOlay: { startsWith: GONDERILIYOR } } }],
        AND: [{ OR: [{ sektor: 'ajans' }, { kisiselDurum: 'HAZIR', kisiselAt: { gte: new Date(simdi.getTime() - KISISEL_GECERLILIK_MS) } }] }],
      };
      const adaylar = await this.prisma.epostaHedef.findMany({ where: uygun, orderBy: { iysYuklendiAt: 'asc' }, take: adet, select: { id: true } });
      if (adaylar.length === 0) {
        const sirada = await this.prisma.epostaHedef.count({ where: { durum: 'SIRADA' } });
        return bos(sirada
          ? `Kişisel metni hazır adres yok (${sirada} adres sırada; hazırlık worker'da sürüyor)`
          : 'Sırada adres yok (İYS partisi onayı bekleniyor olabilir)');
      }

      // SAHIPLEN: yalniz hala SIRADA ve isaretsiz olanlar (arada HARIC/RET yapilan ya da baska turun aldigi dusurulur)
      const isaret = `${GONDERILIYOR}:${belirtec}`;
      if (isaret.length > SON_OLAY_MAX) throw new Error(`isaret ${isaret.length} karakter > ${SON_OLAY_MAX}`);
      const kampanya = `kurumsal-${trGun(simdi).slice(0, 7)}`;
      await this.prisma.epostaHedef.updateMany({
        where: { id: { in: adaylar.map((a) => a.id) }, ...uygun },
        data: { sonOlay: isaret, sonOlayAt: new Date(), kampanya },
      });
      const sahiplenilen = await this.prisma.epostaHedef.findMany({ where: { sonOlay: isaret, durum: 'SIRADA' }, orderBy: { iysYuklendiAt: 'asc' } });
      // Kisisel JSON okunamayan ajans disi hedef GONDERILMEZ (genel metne dusmesin): INCELE'ye alinir, isareti birakilir
      const hedefler: Array<(typeof sahiplenilen)[number] & { kisisel: KisiselVeri | null }> = [];
      for (const h of sahiplenilen) {
        const kisisel = kisiselOku(h.kisisel);
        if (h.sektor !== 'ajans' && !kisisel) {
          await this.prisma.epostaHedef.updateMany({
            where: { id: h.id, sonOlay: isaret },
            data: { sonOlay: null, sonOlayAt: null, kisiselDurum: 'INCELE', kisisel: { neden: 'Kişisel veri okunamadı; yeniden hazırlanmalı' } },
          });
          continue;
        }
        hedefler.push({ ...h, kisisel });
      }
      if (hedefler.length === 0) return bos('Sahiplenilecek adres kalmadı');
      const isaretiKaldir = () => this.prisma.epostaHedef.updateMany({ where: { sonOlay: isaret }, data: { sonOlay: null, sonOlayAt: null } });
      if (this.kanal === 'mailjet' && hedefler.some((h) => kisiselMi(h))) {
        await isaretiKaldir();
        const n = 'Mailjet kanalı kişisel şablonu desteklemiyor (EPOSTA_KANAL=resend ya da smtp olmalı)';
        await this.duraklat(n);
        return bos(n);
      }

      if (this.kanal === 'smtp') return await this.smtpTuru(hedefler, isaret, kampanya, isaretiKaldir);
      if (this.kanal === 'resend') return await this.resendTuru(hedefler, isaret, kampanya, isaretiKaldir);

      // Metin + yasal denetim: kimlik eksik, hitap kurulamadi ya da footer/ret linki yoksa HIC gonderme, duraklat
      const kimlik = kimlikEnv();
      let mesajlar: ReturnType<typeof mailjetMesaj>[];
      try {
        const sorunlar = kimlikSorunlari(kimlik, hedefler.map((h) => h.sektor));
        if (sorunlar.length) throw new Error(sorunlar.join(' · '));
        mesajlar = hedefler.map((h) => {
          const alici: Alici = { email: h.email, ad: '', soyad: '', firma: h.firma, sektor: h.sektor, varyant: h.varyant, marka: h.marka ?? undefined, web: h.web };
          const m = mailjetMesaj(alici, { kimlik, kampanya });
          const eksik = mesajDenetimi(m, kimlik);
          if (eksik.length) throw new Error(`${h.sektor} şablonu: ${eksik.join(', ')}`);
          return m;
        });
      } catch (e: any) {
        await isaretiKaldir();
        const n = `Gönderici kimliği/şablon: ${e?.message ?? e}`;
        await this.duraklat(n);
        return bos(n);
      }

      let yanit: { status: number; govde: any };
      try {
        yanit = await this.mailjetPost({ Messages: mesajlar });
      } catch (e: any) {
        // Ag/zaman asimi: Mailjet isledi mi bilinmez → isaret kalir (sonraki tur belirsiz yapar), duraklat
        const n = `Mailjet'e ulaşılamadı (${e?.message ?? e}); ${hedefler.length} adres belirsiz — Mailjet panelinden kontrol edip "Devam" deyin`;
        await this.duraklat(n);
        return bos(n);
      }
      if (yanit.status === 429 || yanit.status === 401 || yanit.status === 403) {
        // Kesin "islenmedi": isareti geri al, sonraki turda tekrar denensin (yetki hatasinda duraklat)
        await isaretiKaldir();
        const n = yanit.status === 429 ? 'Mailjet hız sınırı (429) — sonraki turda tekrar' : `Mailjet yetki hatası (HTTP ${yanit.status})`;
        if (yanit.status !== 429) await this.duraklat(n);
        return bos(n);
      }
      const sonuc = Array.isArray(yanit.govde?.Messages) ? yanit.govde.Messages : null;
      if (!sonuc || sonuc.length !== hedefler.length) {
        const n = `Mailjet yanıtı beklenmedik (HTTP ${yanit.status}); ${hedefler.length} adres belirsiz — panelden kontrol`;
        await this.duraklat(n);
        return bos(n);
      }
      let ok = 0, hata = 0;
      const zaman = new Date();
      for (let i = 0; i < hedefler.length; i++) {
        const m = sonuc[i];
        // Sonuc yalniz isaret hala bizimse yazilir (arada webhook teslim kaniti islediyse onu ezmeyiz)
        const kosul = { id: hedefler[i].id, sonOlay: isaret };
        if (m?.Status === 'success') {
          ok++;
          await this.prisma.epostaHedef.updateMany({
            where: kosul,
            data: { durum: 'GONDERILDI', gonderildiAt: zaman, messageId: String(m?.To?.[0]?.MessageID ?? '') || null, sonOlay: 'sent', sonOlayAt: zaman, hata: null },
          });
        } else {
          hata++;
          await this.prisma.epostaHedef.updateMany({
            where: kosul,
            data: { durum: 'HATA', sonOlay: 'error', sonOlayAt: zaman, hata: JSON.stringify(m?.Errors ?? m?.Status ?? '').slice(0, 1000) },
          });
        }
      }
      this.log.log(`E-posta turu: ${ok} gonderildi, ${hata} hata (kampanya ${kampanya})`);
      return { gonderildi: ok, hata, neden: `${ok} gönderildi${hata ? `, ${hata} hata` : ''}` };
    } finally {
      await this.kilitBirak(belirtec);
    }
  }

  /**
   * SMTP turu: mesajlar TEK TEK, aralikli gider; her sonuc hemen yazilir (surec kesilirse yalniz o an gonderilen
   * satir isaretli kalir → sonraki tur "belirsiz" yapar, tekrar gondermez).
   *  - basari → GONDERILDI (messageId = Message-ID yerel kismi; yanit/geri donme bununla eslesir)
   *  - alici reddi (RCPT TO 5xx) → BOUNCE
   *  - diger hata (baglanti, kimlik dogrulama, zaman asimi) → o satir HATA "belirsiz", kalanlarin isareti kalkar, DURAKLAT
   */
  private async smtpTuru(
    hedefler: Array<{ id: string; email: string; firma: string; marka: string | null; sektor: string; varyant: string; web: string | null; kisisel: KisiselVeri | null }>,
    isaret: string,
    kampanya: string,
    isaretiKaldir: () => Promise<unknown>,
  ): Promise<TickSonuc> {
    const bos = (neden: string): TickSonuc => ({ gonderildi: 0, hata: 0, neden });
    const a = smtpAyar();
    const sir = retSirri();
    const kimlik = kimlikEnv();
    const base = process.env.API_PUBLIC_URL || 'https://api.ranksup.ai';
    let mesajlar: Array<{ h: (typeof hedefler)[number]; kimlik: string; m: ReturnType<typeof smtpMesaj> }>;
    try {
      if (!sir) throw new Error('ret linki sırrı yok');
      const sorunlar = kimlikSorunlari({ ...kimlik, fromEmail: a.from, replyTo: a.from }, hedefler.map((h) => h.sektor));
      if (sorunlar.length) throw new Error(sorunlar.join(' · '));
      mesajlar = hedefler.map((h) => {
        const id = mesajKimligi();
        return { h, kimlik: id, m: smtpMesaj(h, kimlik, a, sir, base, id, tikUrl(h.id, this.site)) };
      });
    } catch (e: any) {
      await isaretiKaldir();
      const n = `Gönderici kimliği/şablon: ${e?.message ?? e}`;
      await this.duraklat(n);
      return bos(n);
    }

    const t = this.smtpFabrika(a);
    let ok = 0, hata = 0;
    try {
      for (let i = 0; i < mesajlar.length; i++) {
        const { h, kimlik: id, m } = mesajlar[i];
        if (i > 0 && this.smtpAralik > 0) await new Promise((r) => setTimeout(r, this.smtpAralik));
        const kosul = { id: h.id, sonOlay: isaret };
        try {
          await t.sendMail({ ...m, envelope: { from: a.from, to: m.to } });
          ok++;
          const zaman = new Date();
          await this.prisma.epostaHedef.updateMany({ where: kosul, data: { durum: 'GONDERILDI', gonderildiAt: zaman, messageId: id, sonOlay: 'sent', sonOlayAt: zaman, hata: null } });
        } catch (e: any) {
          const zaman = new Date();
          const neden = `${e?.responseCode ?? e?.code ?? ''} ${e?.response ?? e?.message ?? e}`.trim().slice(0, 1000);
          if (kaliciRet(e) && String(e?.command ?? '').toUpperCase().startsWith('RCPT')) {
            hata++;
            await this.prisma.epostaHedef.updateMany({ where: kosul, data: { durum: 'BOUNCE', gonderildiAt: zaman, sonOlay: 'bounce', sonOlayAt: zaman, hata: neden } });
            continue;
          }
          // Kesin olmayan hata: bu satir gitmis olabilir → bir daha gonderilmez; kalanlar sonraki tura birakilir
          await this.prisma.epostaHedef.updateMany({
            where: kosul,
            data: { durum: 'HATA', gonderildiAt: zaman, sonOlay: 'belirsiz', sonOlayAt: zaman, hata: `Belirsiz (SMTP): ${neden}` },
          });
          await isaretiKaldir();
          const n = `SMTP hatası: ${neden} — ${ok} gönderildi, kalanlar sırada; ayarı kontrol edip "Devam" deyin`;
          await this.duraklat(n);
          return { gonderildi: ok, hata: hata + 1, neden: n };
        }
      }
    } finally {
      try { t.close(); } catch { /* yok */ }
    }
    this.log.log(`E-posta turu (SMTP): ${ok} gonderildi, ${hata} geri dondu (kampanya ${kampanya})`);
    return { gonderildi: ok, hata, neden: `${ok} gönderildi${hata ? `, ${hata} geri döndü` : ''}` };
  }

  /**
   * Resend turu: tek /emails/batch istegi (en fazla 100; tur 10). Batch butunuyle kabul ya da ret edilir.
   *  - 200 + her oge icin id → GONDERILDI (messageId = Resend email id; webhook olaylari bununla eslesir)
   *  - 401/403 (anahtar, alan adi dogrulanmamis) ve 400/422 (dogrulama) → hicbiri gitmedi: isaret kalkar, DURAKLAT
   *  - 429 (hiz/kota) → isaret kalkar, sonraki tur tekrar dener
   *  - ag hatasi / 5xx / beklenmeyen govde → gitmis olabilir: isaret kalir (sonraki tur "belirsiz" yapar), DURAKLAT
   * Idempotency-Key = tur isareti: ayni tur istegi tekrar edilirse Resend ikinci kez gondermez.
   */
  private async resendTuru(
    hedefler: Array<{ id: string; email: string; firma: string; marka: string | null; sektor: string; varyant: string; web: string | null; kisisel: KisiselVeri | null }>,
    isaret: string,
    kampanya: string,
    isaretiKaldir: () => Promise<unknown>,
  ): Promise<TickSonuc> {
    const bos = (neden: string): TickSonuc => ({ gonderildi: 0, hata: 0, neden });
    const a = resendAyar();
    const sir = retSirri();
    const kimlik = kimlikEnv();
    const base = process.env.API_PUBLIC_URL || 'https://api.ranksup.ai';
    let mesajlar: ResendMesaj[];
    try {
      if (!sir) throw new Error('ret linki sırrı yok');
      const sorunlar = kimlikSorunlari({ ...kimlik, fromEmail: a.from, replyTo: a.replyTo }, hedefler.map((h) => h.sektor));
      if (sorunlar.length) throw new Error(sorunlar.join(' · '));
      mesajlar = hedefler.map((h) => resendMesaj(h, kimlik, a, sir, base, kampanya, this.site));
    } catch (e: any) {
      await isaretiKaldir();
      const n = `Gönderici kimliği/şablon: ${e?.message ?? e}`;
      await this.duraklat(n);
      return bos(n);
    }

    let yanit: { status: number; govde: any };
    try {
      yanit = await this.resendPost('/emails/batch', mesajlar, a.apiKey, isaret);
    } catch (e: any) {
      const n = `Resend'e ulaşılamadı (${e?.message ?? e}); ${hedefler.length} adres belirsiz — Resend › Emails ekranından kontrol edip "Devam" deyin`;
      await this.duraklat(n);
      return bos(n);
    }
    const mesaj = String(yanit.govde?.message ?? yanit.govde?.name ?? '').slice(0, 300);
    if (yanit.status === 429) {
      await isaretiKaldir();
      return bos(`Resend hız/kota sınırı (429)${mesaj ? `: ${mesaj}` : ''} — sonraki turda tekrar`);
    }
    if ([400, 401, 403, 422].includes(yanit.status)) {
      await isaretiKaldir();
      const n = `Resend reddetti (HTTP ${yanit.status})${mesaj ? `: ${mesaj}` : ''}`;
      await this.duraklat(n);
      return bos(n);
    }
    const sonuc = Array.isArray(yanit.govde?.data) ? yanit.govde.data : null;
    if (yanit.status !== 200 || !sonuc || sonuc.length !== hedefler.length) {
      const n = `Resend yanıtı beklenmedik (HTTP ${yanit.status}); ${hedefler.length} adres belirsiz — Resend › Emails ekranından kontrol`;
      await this.duraklat(n);
      return bos(n);
    }
    let ok = 0, hata = 0;
    const zaman = new Date();
    for (let i = 0; i < hedefler.length; i++) {
      const id = typeof sonuc[i]?.id === 'string' ? sonuc[i].id : '';
      const kosul = { id: hedefler[i].id, sonOlay: isaret };
      if (id) {
        ok++;
        await this.prisma.epostaHedef.updateMany({ where: kosul, data: { durum: 'GONDERILDI', gonderildiAt: zaman, messageId: id.slice(0, 40), sonOlay: 'sent', sonOlayAt: zaman, hata: null } });
      } else {
        // Batch kabul edildi ama bu ogenin kimligi yok: gitmis olabilir → tekrar gonderilmez
        hata++;
        await this.prisma.epostaHedef.updateMany({ where: kosul, data: { durum: 'HATA', gonderildiAt: zaman, sonOlay: 'belirsiz', sonOlayAt: zaman, hata: 'Belirsiz (Resend): yanıtta e-posta kimliği yok' } });
      }
    }
    this.log.log(`E-posta turu (Resend): ${ok} gonderildi, ${hata} belirsiz (kampanya ${kampanya})`);
    return { gonderildi: ok, hata, neden: `${ok} gönderildi${hata ? `, ${hata} belirsiz` : ''}` };
  }

  private async resendPost(yol: string, body: unknown, anahtar: string, idempotency: string): Promise<{ status: number; govde: any }> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), POST_ZAMAN_ASIMI_MS);
    try {
      const res = await fetch(`${RESEND}${yol}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${anahtar}`, 'content-type': 'application/json', 'idempotency-key': idempotency },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      const text = await res.text();
      let govde: any = null;
      try { govde = text ? JSON.parse(text) : null; } catch { govde = null; }
      return { status: res.status, govde };
    } finally {
      clearTimeout(t);
    }
  }

  /**
   * Resend webhook (Svix imzali). Imza ham govde uzerinden dogrulanir; gecersizse false (controller 401 doner, Resend
   * yeniden dener — sir yanlis yazildiysa panelde gorulur). Eslesme: Resend email id (messageId); bulunamazsa geri
   * donme/sikayet/bastirma icin alici adresi (muhafazakar yon: o adrese bir daha yazilmaz).
   */
  async resendOlayIsle(ham: Buffer | string | undefined, basliklar: { id?: string; timestamp?: string; signature?: string }): Promise<{ gecerli: boolean; islendi: number }> {
    const sir = resendAyar().webhookSecret;
    if (!ham || !svixDogrula(sir, basliklar, ham)) return { gecerli: false, islendi: 0 };
    let govde: unknown;
    try { govde = JSON.parse(typeof ham === 'string' ? ham : ham.toString('utf8')); } catch { return { gecerli: true, islendi: 0 }; }
    const o = resendOlayEsle(govde);
    if (!o) return { gecerli: true, islendi: 0 };
    let h = o.emailId ? await this.prisma.epostaHedef.findFirst({ where: { messageId: o.emailId } }) : null;
    const bizim = !!h;
    if (!h && o.durum && o.durum !== 'HATA' && o.alici) h = await this.prisma.epostaHedef.findUnique({ where: { email: o.alici } });
    if (!h) return { gecerli: true, islendi: 0 }; // sistem e-postasi (ayni hesap) — kampanyanin degil
    const kapali = (KAPALI_DURUMLAR as readonly string[]).includes(h.durum);
    const data: Prisma.EpostaHedefUpdateInput = { sonOlay: o.sonOlay, sonOlayAt: o.zaman };
    if (bizim && o.teslim && !kapali && (h.durum === 'SIRADA' || h.durum === 'HATA')) {
      data.durum = 'GONDERILDI';
      if (!h.gonderildiAt) data.gonderildiAt = o.zaman;
      data.hata = null;
    }
    if (bizim && o.acildi && !h.acildiAt) data.acildiAt = o.zaman;
    if (bizim && o.tiklandi && !h.tiklandiAt) data.tiklandiAt = o.zaman;
    if (o.durum && !kapali) {
      data.durum = o.durum;
      if (!h.gonderildiAt && bizim) data.gonderildiAt = o.zaman;
    }
    if (o.hata) data.hata = o.hata;
    await this.prisma.epostaHedef.update({ where: { id: h.id }, data });
    return { gecerli: true, islendi: 1 };
  }

  /**
   * Firmaya ozel baglantiya tiklama (web /e/[id] sunucu tarafindan cagirir). Yalniz gonderilmis satira ve gercek
   * insan tiklamasina (tikGecerli) yazilir; ilk tiklama zamani korunur. Satir yoksa sessizce gecer (adres sizmaz).
   */
  async tikIsle(id: unknown, ua: unknown, simdi = new Date()): Promise<{ sayildi: boolean }> {
    if (typeof id !== 'string' || !/^[a-z0-9]{10,40}$/i.test(id)) return { sayildi: false };
    const h = await this.prisma.epostaHedef.findUnique({ where: { id }, select: { id: true, durum: true, gonderildiAt: true, tiklandiAt: true, acildiAt: true } });
    if (!h || !tikGecerli(typeof ua === 'string' ? ua.slice(0, 500) : '', h.gonderildiAt, simdi)) return { sayildi: false };
    // NEDEN kapali satirda sonOlay korunur: RET/BOUNCE nedeni ("ret-baglanti" vb.) tiklamayla ezilmesin
    const kapali = (KAPALI_DURUMLAR as readonly string[]).includes(h.durum);
    await this.prisma.epostaHedef.update({
      where: { id: h.id },
      // NEDEN acildiAt da: tiklayan acmistir; duz metinde acilma baska yoldan olculmez
      data: { ...(kapali ? {} : { sonOlay: 'click', sonOlayAt: simdi }), ...(h.tiklandiAt ? {} : { tiklandiAt: simdi }), ...(h.acildiAt ? {} : { acildiAt: simdi }) },
    });
    return { sayildi: true };
  }

  /**
   * Gonderen kutunun gelen kutusu: geri donme raporlari (DSN) → BOUNCE; bizim mesajimiza yanit → "ret" ise RET,
   * degilse sonOlay='yanit' (panelde gorunur, satir kapanmaz). Okunmamis isaretine DOKUNULMAZ (kutuyu insan da okur);
   * imlec KV'de. Donus: islenen satir sayisi.
   */
  async gelenKutusuTara(a: SmtpAyar = smtpAyar()): Promise<{ bounce: number; ret: number; yanit: number }> {
    const say = { bounce: 0, ret: 0, yanit: 0 };
    const { imlec, mesajlar } = await this.gelenOku(a, await this.kv(KV_IMAP));
    for (const g of mesajlar) {
      const ustBitis = g.ham.search(/\r?\n\r?\n/);
      const ust = ustBitis > 0 ? g.ham.slice(0, ustBitis) : g.ham;
      const govde = ustBitis > 0 ? g.ham.slice(ustBitis) : '';
      const baslik = (ad: string) => new RegExp(`^${ad}:\\s*((?:.*)(?:\\r?\\n[ \\t].*)*)`, 'im').exec(ust)?.[1]?.replace(/\r?\n[ \t]+/g, ' ').trim() ?? '';
      if (dsnMi({ contentType: baslik('Content-Type'), from: g.kimden, subject: g.konu })) {
        for (const d of dsnAyikla(g.ham)) {
          if (!d.kalici) continue;
          const r = await this.prisma.epostaHedef.updateMany({
            where: { email: d.alici, durum: { notIn: ['RET', 'BOUNCE', 'SPAM', 'HARIC'] } },
            data: { durum: 'BOUNCE', sonOlay: 'bounce', sonOlayAt: new Date(), hata: `Geri döndü (${d.durum})` },
          });
          say.bounce += r.count;
        }
        continue;
      }
      const kimlikler = bizimKimlikler(baslik('In-Reply-To'), baslik('References'));
      let h = kimlikler.length ? await this.prisma.epostaHedef.findFirst({ where: { messageId: { in: kimlikler } } }) : null;
      if (!h && g.kimden) h = await this.prisma.epostaHedef.findUnique({ where: { email: g.kimden.toLowerCase() } });
      if (!h || !h.gonderildiAt) continue;
      if (yanitTuru(g.konu, govde) === 'ret') {
        if ((KAPALI_DURUMLAR as readonly string[]).includes(h.durum)) continue;
        await this.prisma.epostaHedef.update({ where: { id: h.id }, data: { durum: 'RET', sonOlay: 'ret-yanit', sonOlayAt: new Date() } });
        say.ret++;
      } else {
        await this.prisma.epostaHedef.update({ where: { id: h.id }, data: { sonOlay: 'yanit', sonOlayAt: new Date() } });
        say.yanit++;
      }
    }
    await this.kvYaz(KV_IMAP, imlec);
    if (say.bounce || say.ret || say.yanit) this.log.log(`Gelen kutusu: ${say.bounce} geri dönme, ${say.ret} ret, ${say.yanit} yanıt`);
    return say;
  }

  private async mailjetPost(body: unknown): Promise<{ status: number; govde: any }> {
    const auth = 'Basic ' + Buffer.from(`${process.env.MAILJET_API_KEY}:${process.env.MAILJET_SECRET}`).toString('base64');
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), POST_ZAMAN_ASIMI_MS);
    try {
      const res = await fetch(`${MAILJET}/v3.1/send`, { method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
      const text = await res.text();
      let govde: any = null;
      try { govde = text ? mailjetJsonOku(text) : null; } catch { govde = null; }
      return { status: res.status, govde };
    } finally {
      clearTimeout(t);
    }
  }

  // ─── Mailjet olay akisi ───────────────────────────────────────────────

  /**
   * Webhook belirteci: ayri env gerektirmesin diye MAILJET_SECRET'ten turetilir (MAILJET_WEBHOOK_TOKEN verilirse o).
   * Mailjet callback URL'sine ?t=<belirtec> olarak eklenir; olmayan/yanlis istek reddedilir.
   */
  webhookBelirteci(): string | null {
    const acik = process.env.MAILJET_WEBHOOK_TOKEN?.trim();
    if (acik) return acik;
    const secret = process.env.MAILJET_SECRET;
    return secret ? createHash('sha256').update(`ranksup-eposta-webhook:${secret}`).digest('hex').slice(0, 40) : null;
  }

  belirtecGecerli(t: unknown): boolean {
    const beklenen = this.webhookBelirteci();
    if (!beklenen || typeof t !== 'string' || !t) return false;
    // NEDEN ozet: timingSafeEqual farkli BAYT uzunlugunda hata firlatir (ASCII disi t → 500); sabit 32 bayt ozet karsilastir
    const ozet = (x: string) => createHash('sha256').update(x).digest();
    return timingSafeEqual(ozet(t), ozet(beklenen));
  }

  /**
   * NEDEN bizimMesaj ayrimi: eslesme e-posta adresiyle; ayni adrese baska bir Mailjet mesaji da gitmis olabilir.
   * - Acilma/tiklama yalniz BIZIM mesajimizin (CustomID "kurumsal-…:<email>") olayiysa islenir.
   * - Geri donme/spam/ret HER mesajdan kabul edilir (muhafazakar yon: o adrese bir daha yazilmaz).
   * - Bizim mesajimizin olayi SIRADA/belirsiz bir satira gelirse bu TESLIM KANITIDIR → GONDERILDI (ikinci gonderim olmaz);
   *   "gonderiliyor" isareti hicbir zaman yalniz sonOlay ile ezilip satir yeniden gonderilebilir hale getirilmez.
   */
  async olaylariIsle(govde: unknown): Promise<{ islendi: number }> {
    const olaylar = (Array.isArray(govde) ? govde : [govde]).filter((e): e is Record<string, unknown> => !!e && typeof e === 'object');
    let islendi = 0;
    for (const e of olaylar.slice(0, 500)) {
      const g = olayEsle(e);
      if (!g) continue;
      const email = String(e.email ?? '').trim().toLowerCase();
      if (!email) continue;
      const h = await this.prisma.epostaHedef.findUnique({ where: { email } });
      if (!h) continue;
      const bizim = bizimMesaj(e, email);
      if (!bizim && !g.durum) continue; // baska mesajin acilma/tiklamasi bu kampanyanin metrigi degil
      const zaman = olayZamani(e);
      const data: Prisma.EpostaHedefUpdateInput = { sonOlay: g.sonOlay, sonOlayAt: zaman };
      const kapali = (KAPALI_DURUMLAR as readonly string[]).includes(h.durum);
      if (bizim && !kapali && (h.durum === 'SIRADA' || h.durum === 'HATA')) {
        // Teslim kaniti: zaman asimina ugramis ya da belirsiz kalmis gonderim aslinda gitmis
        data.durum = 'GONDERILDI';
        if (!h.gonderildiAt) data.gonderildiAt = zaman;
        data.hata = null;
      }
      if (bizim && g.acildi && !h.acildiAt) data.acildiAt = zaman;
      if (bizim && g.tiklandi && !h.tiklandiAt) data.tiklandiAt = zaman;
      if (g.durum && !kapali) {
        data.durum = g.durum;
        if (!h.gonderildiAt && bizim) data.gonderildiAt = zaman;
      }
      if (g.hata) data.hata = g.hata;
      await this.prisma.epostaHedef.update({ where: { id: h.id }, data });
      islendi++;
    }
    return { islendi };
  }

  /**
   * Mailjet'e olay callback adresini tanit (acilma, tiklama, geri donme, engel, spam, ret). Admin panelinden bir kez.
   * NEDEN Version 1 (tek olay / istek): v2 olaylari toplu gonderir; buyuk bir toplu govde API'nin 10.000 ogelik JSON
   * butcesine takilip 413 alirsa Mailjet tekrar dener ve sonunda adresi askiya alir. Hacmimiz (gunde <= 200) dusuk.
   * NEDEN zorla: callback adresleri HESAP GENELIDIR; ayni turde BASKA bir adres kayitliysa (baska bir sistem) sessizce
   * ezilmez — panel once uyarir, onaylanirsa yazilir.
   */
  async webhookKur(zorla = false): Promise<{ kurulan: string[]; hatalar: string[]; cakisan: Array<{ tur: string; url: string }> }> {
    if (!this.mailjetHazir) return { kurulan: [], hatalar: ['Mailjet anahtarı yok'], cakisan: [] };
    const t = this.webhookBelirteci();
    const base = (process.env.API_PUBLIC_URL || 'https://api.ranksup.ai').replace(/\/+$/, '');
    const url = `${base}/api/eposta/webhooks/mailjet?t=${t}`;
    const auth = 'Basic ' + Buffer.from(`${process.env.MAILJET_API_KEY}:${process.env.MAILJET_SECRET}`).toString('base64');
    const kurulan: string[] = [], hatalar: string[] = [];
    const mevcut = await fetch(`${MAILJET}/v3/REST/eventcallbackurl?Limit=50`, { headers: { authorization: auth } }).then((r) => r.json()).catch(() => ({ Data: [] }));
    const TURLER = ['open', 'click', 'bounce', 'blocked', 'spam', 'unsub'];
    const kayitli = (tur: string) => (mevcut?.Data ?? []).find((d: any) => d.EventType === tur);
    const cakisan = TURLER.map((tur) => ({ tur, url: String(kayitli(tur)?.Url ?? '') }))
      .filter((c) => c.url && !c.url.includes('/api/eposta/webhooks/mailjet'))
      .map((c) => ({ tur: c.tur, url: c.url.replace(/([?&]t=)[^&]+/, '$1***') }));
    if (cakisan.length && !zorla) return { kurulan, hatalar, cakisan };
    for (const tur of TURLER) {
      const eski = kayitli(tur);
      const res = await fetch(`${MAILJET}/v3/REST/eventcallbackurl${eski ? `/${eski.ID}` : ''}`, {
        method: eski ? 'PUT' : 'POST',
        headers: { authorization: auth, 'content-type': 'application/json' },
        body: JSON.stringify({ EventType: tur, Url: url, Version: 1, Status: 'alive', IsBackup: false }),
      }).catch((e) => ({ ok: false, status: 0, text: async () => String(e) }) as any);
      if (res.ok) kurulan.push(tur); else hatalar.push(`${tur}: HTTP ${res.status}`);
    }
    return { kurulan, hatalar, cakisan: [] };
  }
}

/**
 * Gelen kutusunu imlecten sonrasi icin okur (en fazla 200 mesaj, mesaj basina en fazla 256 KB ham metin).
 * NEDEN uid imleci: okunmamis bayragina dokunmadan her mesaj bir kez islenir; UIDVALIDITY degisirse bastan (son 14 gun).
 */
async function imapOku(a: SmtpAyar, sonrasi: string | null): Promise<{ imlec: string; mesajlar: GelenMesaj[] }> {
  const c = new ImapFlow({ host: a.imapHost, port: a.imapPort, secure: true, auth: { user: a.user, pass: a.pass }, logger: false });
  await c.connect();
  try {
    const kilit = await c.getMailboxLock('INBOX');
    try {
      const kutu = c.mailbox && typeof c.mailbox === 'object' ? c.mailbox : null;
      const gecerlilik = String(kutu?.uidValidity ?? '0');
      const [v, u] = (sonrasi ?? '').split(':');
      const son = v === gecerlilik ? Number(u) || 0 : 0;
      const ara = son > 0 ? { uid: `${son + 1}:*` } : { since: new Date(Date.now() - 14 * 86_400_000) };
      const uids = ((await c.search(ara, { uid: true })) || []).filter((x) => x > son).sort((x, y) => x - y).slice(0, 200);
      const mesajlar: GelenMesaj[] = [];
      let enBuyuk = son;
      if (uids.length) {
        for await (const m of c.fetch(uids, { uid: true, envelope: true, source: { maxLength: 256 * 1024 } }, { uid: true })) {
          enBuyuk = Math.max(enBuyuk, m.uid);
          mesajlar.push({
            uid: m.uid,
            kimden: m.envelope?.from?.[0]?.address?.toLowerCase() ?? '',
            konu: m.envelope?.subject ?? '',
            ham: m.source ? m.source.toString('utf8') : '',
          });
        }
      }
      return { imlec: `${gecerlilik}:${enBuyuk}`, mesajlar };
    } finally {
      kilit.release();
    }
  } finally {
    await c.logout().catch(() => undefined);
  }
}
