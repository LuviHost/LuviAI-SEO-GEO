import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { EpostaHedefDurum, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { parseCsv, toCsv } from '../prospect/prospect-utils.js';
import { kimlikEnv, kimlikSorunlari, mailjetMesaj, mesajDenetimi, type Alici } from '../prospect/eposta-sablon.js';
import {
  ACIK_DURUMLAR, KAPALI_DURUMLAR, bizimMesaj, firmaAnahtari, mailjetJsonOku, type IceAktarSatir, frenNedeni, gonderimPenceresinde, iceAktarSatiri, olayEsle, olayZamani,
  trAyBasi, trGun, trGunBasi, turKotasi,
} from './eposta-kurallar.js';

const KV_ACIK = 'eposta-kampanya:acik';
const KV_DURAKLAT = 'eposta-kampanya:duraklatildi';
const KV_KILIT = 'eposta-kampanya:kilit';
/**
 * Yazma-oncesi isaret: "gonderiliyor:<tur belirteci>". Satirlar POST'tan ONCE bu isaretle SAHIPLENILIR (kosullu
 * updateMany), yalniz kendi isaretini tasiyan satirlar gonderilir ve sonuc yalniz o isaret hala duruyorsa yazilir.
 * Kalirsa "belirsiz" (gitmis olabilir) — bir daha gonderilmez.
 */
const GONDERILIYOR = 'gonderiliyor';
/** sonOlay sutun genisligi (schema.prisma VarChar(64)) — isaret buna sigmali, yoksa MySQL strict modda guncelleme duser */
export const SON_OLAY_MAX = 64;
const MAILJET = 'https://api.mailjet.com';
/** Saatlik/yarim saatlik tur basina en fazla — gunluk kota gune yayilsin, tek seferde 200 gitmesin */
const TUR_BASI = 40;
const KILIT_SURE_MS = 10 * 60 * 1000;
const POST_ZAMAN_ASIMI_MS = 45_000;

export type TickSonuc = { gonderildi: number; hata: number; neden: string };

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

  constructor(private readonly prisma: PrismaService) {}

  private get gunlukKota(): number { return Number(process.env.EPOSTA_GUNLUK_KOTA) || 200; }
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

  async devam(): Promise<{ ok: true }> {
    await this.prisma.kvStore.deleteMany({ where: { key: KV_DURAKLAT } });
    return { ok: true };
  }

  // ─── Panel ozeti ──────────────────────────────────────────────────────

  async overview(f: { durum?: string; sektor?: string; q?: string; sayfa?: number } = {}) {
    const simdi = new Date();
    const yedi = new Date(simdi.getTime() - 7 * 86_400_000);
    const [acik, duraklatma, gruplar, bugun, ay, acilan, tiklanan, partiler, son7] = await Promise.all([
      this.isAcik(),
      this.kv(KV_DURAKLAT),
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

    const sorunlar = this.mailjetHazir ? kimlikSorunlari(kimlikEnv(), ['ajans', 'diger', 'finans']) : ['MAILJET_API_KEY / MAILJET_SECRET sunucu .env dosyasında yok'];
    return {
      acik,
      duraklatma,
      pencerede: gonderimPenceresinde(simdi),
      hazir: sorunlar.length === 0,
      sorunlar,
      kota: { bugun, gunluk: this.gunlukKota, ay, aylik: this.aylikKota },
      sayilar,
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
    const durak = await this.kv(KV_DURAKLAT);
    if (durak) return bos(`Duraklatıldı: ${durak}`);
    const simdi = new Date();
    if (!opts.zorla && !gonderimPenceresinde(simdi)) return bos('Gönderim penceresi dışında (hafta içi 10-17)');
    if (!this.mailjetHazir) { await this.duraklat('Mailjet anahtarı yok'); return bos('Mailjet anahtarı yok'); }

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

      const fren = frenNedeni(await this.son7Gun(new Date(simdi.getTime() - 7 * 86_400_000)));
      if (fren) { await this.duraklat(fren); return bos(fren); }

      const [bugun, ay] = await Promise.all([
        this.prisma.epostaHedef.count({ where: { gonderildiAt: { gte: trGunBasi(simdi) } } }),
        this.prisma.epostaHedef.count({ where: { gonderildiAt: { gte: trAyBasi(simdi) } } }),
      ]);
      const adet = turKotasi({ bugunGonderilen: bugun, ayGonderilen: ay, gunluk: this.gunlukKota, aylik: this.aylikKota, turBasi: TUR_BASI });
      if (adet === 0) return bos(`Kota doldu (bugün ${bugun}/${this.gunlukKota}, ay ${ay}/${this.aylikKota})`);

      const uygun = { durum: 'SIRADA' as const, OR: [{ sonOlay: null }, { NOT: { sonOlay: { startsWith: GONDERILIYOR } } }] };
      const adaylar = await this.prisma.epostaHedef.findMany({ where: uygun, orderBy: { iysYuklendiAt: 'asc' }, take: adet, select: { id: true } });
      if (adaylar.length === 0) return bos('Sırada adres yok (İYS partisi onayı bekleniyor olabilir)');

      // SAHIPLEN: yalniz hala SIRADA ve isaretsiz olanlar (arada HARIC/RET yapilan ya da baska turun aldigi dusurulur)
      const isaret = `${GONDERILIYOR}:${belirtec}`;
      if (isaret.length > SON_OLAY_MAX) throw new Error(`isaret ${isaret.length} karakter > ${SON_OLAY_MAX}`);
      const kampanya = `kurumsal-${trGun(simdi).slice(0, 7)}`;
      await this.prisma.epostaHedef.updateMany({
        where: { id: { in: adaylar.map((a) => a.id) }, ...uygun },
        data: { sonOlay: isaret, sonOlayAt: new Date(), kampanya },
      });
      const hedefler = await this.prisma.epostaHedef.findMany({ where: { sonOlay: isaret, durum: 'SIRADA' }, orderBy: { iysYuklendiAt: 'asc' } });
      if (hedefler.length === 0) return bos('Sahiplenilecek adres kalmadı');
      const isaretiKaldir = () => this.prisma.epostaHedef.updateMany({ where: { sonOlay: isaret }, data: { sonOlay: null, sonOlayAt: null } });

      // Metin + yasal denetim: kimlik eksik, hitap kurulamadi ya da footer/ret linki yoksa HIC gonderme, duraklat
      const kimlik = kimlikEnv();
      let mesajlar: ReturnType<typeof mailjetMesaj>[];
      try {
        const sorunlar = kimlikSorunlari(kimlik, hedefler.map((h) => h.sektor));
        if (sorunlar.length) throw new Error(sorunlar.join(' · '));
        mesajlar = hedefler.map((h) => {
          const alici: Alici = { email: h.email, ad: '', soyad: '', firma: h.firma, sektor: h.sektor, varyant: h.varyant, marka: h.marka ?? undefined };
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
