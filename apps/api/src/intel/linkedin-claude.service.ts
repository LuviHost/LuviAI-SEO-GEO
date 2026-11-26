import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { LinkedinOutreachService } from './linkedin-outreach.service.js';
import { firmaKey, istanbulDayStart, renderNote } from './linkedin-outreach-rules.js';
import {
  AJAN_CANLI_MS,
  IS_KISI_TAVANI,
  IS_ZAMAN_ASIMI_MS,
  ajanKomutu,
  anahtarDogru,
  anahtarOzeti,
  kisiSonucuGecerli,
  prospectGuncellemesi,
  yeniAnahtar,
  type KisiSonucu,
} from './linkedin-claude.js';

const KV_ANAHTAR = 'linkedin-claude:anahtar-ozeti';
const KV_SON_GORULME = 'linkedin-claude:son-gorulme';
const AKTIF = ['BEKLIYOR', 'CALISIYOR'];

type IsKisi = { id: string; not: string };
type IsSonuc = { id: string; durum: KisiSonucu; aciklama: string; at: string };

/**
 * Claude ile LinkedIn gonderimi — is kuyrugu (bkz. linkedin-claude.ts).
 * Sunucu LinkedIn'e HIC dokunmaz; yalniz panelde onaylanan listeyi tutar ve Mac ajaninin
 * yazdigi sonucu linkedin_prospects kayitlarina isler.
 */
@Injectable()
export class LinkedinClaudeService {
  private readonly log = new Logger(LinkedinClaudeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outreach: LinkedinOutreachService,
  ) {}

  // ── Panel ────────────────────────────────────────────────────

  /** Bugun gonderilebilecek adaylar (kuyruk sirasi) + gunluk kalan kota */
  async adaylar() {
    const limits = await this.outreach.getLimits();
    const gunBasi = istanbulDayStart(new Date());
    const [bugunIstekler, aktifIsler] = await Promise.all([
      this.prisma.linkedinProspect.findMany({ where: { requestedAt: { gte: gunBasi } }, select: { firma: true } }),
      this.prisma.linkedinClaudeIs.findMany({ where: { durum: { in: AKTIF } }, select: { kisiler: true } }),
    ]);
    const kalanBugun = Math.max(0, limits.MAX_REQUESTS_PER_DAY - bugunIstekler.length);
    const firmaSayaci: Record<string, number> = {};
    for (const r of bugunIstekler) firmaSayaci[firmaKey(r.firma)] = (firmaSayaci[firmaKey(r.firma)] ?? 0) + 1;
    const islerde = new Set(aktifIsler.flatMap((i) => (i.kisiler as IsKisi[]).map((k) => k.id)));

    const sec = { id: true, ad: true, soyad: true, firma: true, unvan: true, sektor: true, kademe: true, kampanya: true, profileUrl: true, lastError: true } as const;
    const where = { status: 'QUEUED' as const, kanal: 'LINKEDIN' as const, elle: false };
    const order = [{ kademe: 'asc' as const }, { createdAt: 'asc' as const }];
    const [temiz, hatali] = await Promise.all([
      this.prisma.linkedinProspect.findMany({ where: { ...where, lastError: null }, orderBy: order, take: 60, select: sec }),
      this.prisma.linkedinProspect.findMany({ where: { ...where, lastError: { not: null } }, orderBy: order, take: 20, select: sec }),
    ]);
    const adaylar: Array<{ id: string; ad: string; soyad: string; firma: string; unvan: string | null; profileUrl: string; not: string; lastError: string | null }> = [];
    for (const p of [...temiz, ...hatali]) {
      if (islerde.has(p.id)) continue;
      const fk = firmaKey(p.firma);
      // Ayni firmadan gunde en fazla N (eski botun freni) — listeye alinirken de sayilir
      if ((firmaSayaci[fk] ?? 0) >= limits.SAME_COMPANY_PER_DAY) continue;
      firmaSayaci[fk] = (firmaSayaci[fk] ?? 0) + 1;
      adaylar.push({ id: p.id, ad: p.ad, soyad: p.soyad, firma: p.firma, unvan: p.unvan, profileUrl: p.profileUrl, not: renderNote(p), lastError: p.lastError });
      if (adaylar.length >= 30) break;
    }
    return { kalanBugun, isTavani: IS_KISI_TAVANI, adaylar };
  }

  async isOlustur(kisiIds: unknown, kuru: boolean, olusturan: string) {
    const ids = Array.isArray(kisiIds) ? [...new Set(kisiIds.filter((x): x is string => typeof x === 'string'))] : [];
    if (ids.length === 0) throw new BadRequestException('En az bir kişi seçin');
    if (ids.length > IS_KISI_TAVANI) throw new BadRequestException(`Tek seferde en fazla ${IS_KISI_TAVANI} kişi`);
    const aktif = await this.prisma.linkedinClaudeIs.count({ where: { durum: { in: AKTIF } } });
    if (aktif > 0) throw new BadRequestException('Bekleyen ya da süren bir iş var; bitmesini bekleyin ya da iptal edin');
    if (!kuru) {
      const { kalanBugun } = await this.adaylar();
      if (ids.length > kalanBugun) throw new BadRequestException(`Bugün en fazla ${kalanBugun} istek daha gönderilebilir`);
    }
    const kayitlar = await this.prisma.linkedinProspect.findMany({ where: { id: { in: ids } } });
    const uygun = kayitlar.filter((p) => p.status === 'QUEUED' && p.kanal === 'LINKEDIN' && !p.elle);
    if (uygun.length !== ids.length) throw new BadRequestException('Seçilenlerden bazıları artık kuyrukta değil; listeyi yenileyin');
    const sira = new Map(ids.map((id, i) => [id, i]));
    uygun.sort((a, b) => (sira.get(a.id) ?? 0) - (sira.get(b.id) ?? 0));
    const kisiler: IsKisi[] = uygun.map((p) => ({ id: p.id, not: renderNote(p) }));

    const is = await this.prisma.linkedinClaudeIs.create({
      data: { kuru, kisiler, olusturan: olusturan.slice(0, 191) },
      select: { id: true },
    });
    // Eski bot ayni kuyruga dokunmasin (gercek gonderimde iki sistem ayni kisiye istek atabilirdi)
    if (!kuru) await this.outreach.setEnabled(false).catch(() => undefined);
    this.log.log(`Claude isi acildi ${is.id} (${kisiler.length} kisi${kuru ? ', kuru' : ''})`);
    return { id: is.id, kisi: kisiler.length, kuru };
  }

  async iptal(id: string) {
    const r = await this.prisma.linkedinClaudeIs.updateMany({
      where: { id, durum: { in: AKTIF } },
      data: { durum: 'IPTAL', bittiAt: new Date() },
    });
    return { ok: r.count > 0 };
  }

  async durum() {
    const [anahtar, gorulme, isler] = await Promise.all([
      this.prisma.kvStore.findUnique({ where: { key: KV_ANAHTAR } }).catch(() => null),
      this.prisma.kvStore.findUnique({ where: { key: KV_SON_GORULME } }).catch(() => null),
      this.prisma.linkedinClaudeIs.findMany({ orderBy: { createdAt: 'desc' }, take: 10 }),
    ]);
    const ids = [...new Set(isler.flatMap((i) => (i.kisiler as IsKisi[]).map((k) => k.id)))];
    const kisiler = ids.length
      ? await this.prisma.linkedinProspect.findMany({ where: { id: { in: ids } }, select: { id: true, ad: true, soyad: true, firma: true } })
      : [];
    const ad = new Map(kisiler.map((k) => [k.id, `${k.ad} ${k.soyad} · ${k.firma}`]));
    const sonGorulme = gorulme?.value ? new Date(gorulme.value) : null;
    return {
      anahtarVar: !!anahtar,
      ajan: { sonGorulme: sonGorulme?.toISOString() ?? null, canli: !!sonGorulme && Date.now() - sonGorulme.getTime() < AJAN_CANLI_MS },
      isler: isler.map((i) => {
        const sonuc = (i.sonuc as IsSonuc[] | null) ?? [];
        return {
          id: i.id, durum: i.durum, kuru: i.kuru, hata: i.hata, createdAt: i.createdAt, alindiAt: i.alindiAt, bittiAt: i.bittiAt,
          kisiler: (i.kisiler as IsKisi[]).map((k) => {
            const s = sonuc.find((x) => x.id === k.id);
            return { id: k.id, ad: ad.get(k.id) ?? '(silinmiş kayıt)', not: k.not, durum: s?.durum ?? null, aciklama: s?.aciklama ?? null, at: s?.at ?? null };
          }),
        };
      }),
    };
  }

  /** Yeni ajan anahtari: bir kez dondurulur, sunucuda yalniz ozeti kalir (eskisi gecersiz olur) */
  async anahtarOlustur() {
    const anahtar = yeniAnahtar();
    const ozet = anahtarOzeti(anahtar);
    await this.prisma.kvStore.upsert({ where: { key: KV_ANAHTAR }, create: { key: KV_ANAHTAR, value: ozet }, update: { value: ozet } });
    return { anahtar };
  }

  // ── Mac ajani ────────────────────────────────────────────────

  async ajanDogrula(gelen: string | undefined) {
    const row = await this.prisma.kvStore.findUnique({ where: { key: KV_ANAHTAR } }).catch(() => null);
    if (!anahtarDogru(row?.value, gelen)) throw new ForbiddenException('Ajan anahtarı geçersiz');
    const simdi = new Date().toISOString();
    await this.prisma.kvStore
      .upsert({ where: { key: KV_SON_GORULME }, create: { key: KV_SON_GORULME, value: simdi }, update: { value: simdi } })
      .catch(() => undefined);
  }

  /** Siradaki isi al (atomik). Yoksa null. */
  async isAl() {
    // Uyuyan Mac / coken ajan: uzun suredir CALISIYOR kalan is kilit olmasin
    await this.prisma.linkedinClaudeIs.updateMany({
      where: { durum: 'CALISIYOR', alindiAt: { lt: new Date(Date.now() - IS_ZAMAN_ASIMI_MS) } },
      data: { durum: 'HATA', hata: 'Zaman aşımı: ajan işi bitirmedi', bittiAt: new Date() },
    });
    const is = await this.prisma.linkedinClaudeIs.findFirst({ where: { durum: 'BEKLIYOR' }, orderBy: { createdAt: 'asc' } });
    if (!is) return { is: null };
    const r = await this.prisma.linkedinClaudeIs.updateMany({ where: { id: is.id, durum: 'BEKLIYOR' }, data: { durum: 'CALISIYOR', alindiAt: new Date() } });
    if (r.count === 0) return { is: null };

    const kisiler = is.kisiler as IsKisi[];
    const kayitlar = await this.prisma.linkedinProspect.findMany({ where: { id: { in: kisiler.map((k) => k.id) } } });
    const kayit = new Map(kayitlar.map((p) => [p.id, p]));
    const liste: Array<{ id: string; adSoyad: string; komut: string }> = [];
    for (const k of kisiler) {
      const p = kayit.get(k.id);
      // Onaydan sonra baska yoldan ilerlemis kisiye dokunulmaz (elle yazilmis, atlanmis vb.)
      if (!p || p.status !== 'QUEUED') continue;
      liste.push({
        id: p.id,
        adSoyad: `${p.ad} ${p.soyad}`.trim(),
        komut: ajanKomutu({ ad: p.ad, soyad: p.soyad, firma: p.firma, unvan: p.unvan, profileUrl: p.profileUrl, not: k.not }, is.kuru),
      });
    }
    this.log.log(`Claude isi alindi ${is.id} (${liste.length} kisi)`);
    return { is: { id: is.id, kuru: is.kuru, kisiler: liste } };
  }

  /** Tek kisinin sonucu. Donus: devam edilsin mi (iptal / ENGEL → hayir) */
  async sonucYaz(isId: string, kisiId: string, durum: unknown, aciklama: unknown) {
    if (!kisiSonucuGecerli(durum)) throw new BadRequestException('Geçersiz durum');
    const metin = String(aciklama ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
    const is = await this.prisma.linkedinClaudeIs.findUnique({ where: { id: isId } });
    if (!is) throw new NotFoundException('İş yok');
    const kisi = (is.kisiler as IsKisi[]).find((k) => k.id === kisiId);
    if (!kisi) throw new BadRequestException('Kişi bu işte yok');

    const simdi = new Date();
    const sonuc = [...(((is.sonuc as IsSonuc[] | null) ?? []).filter((s) => s.id !== kisiId)), { id: kisiId, durum, aciklama: metin, at: simdi.toISOString() }];
    const engel = durum === 'ENGEL';
    await this.prisma.linkedinClaudeIs.update({
      where: { id: isId },
      data: {
        sonuc,
        ...(engel && is.durum === 'CALISIYOR' ? { durum: 'HATA', hata: `LinkedIn engeli: ${metin}`.slice(0, 1000), bittiAt: simdi } : {}),
      },
    });

    // Iptal edilmis iste Gonder'e basilmis olabilir: kayit yine de gercegi yansitmali
    const g = prospectGuncellemesi(durum, is.kuru, kisi.not, metin || durum, simdi);
    if (g) await this.prisma.linkedinProspect.updateMany({ where: { id: kisiId, status: 'QUEUED' }, data: g });
    if (engel) this.log.warn(`Claude isi ${isId}: LinkedIn engeli — is durduruldu`);
    return { devam: is.durum === 'CALISIYOR' && !engel };
  }

  async bitir(isId: string, hata: unknown) {
    const h = typeof hata === 'string' && hata.trim() ? hata.trim().slice(0, 1000) : null;
    await this.prisma.linkedinClaudeIs.updateMany({
      where: { id: isId, durum: 'CALISIYOR' },
      data: { durum: h ? 'HATA' : 'BITTI', hata: h, bittiAt: new Date() },
    });
    return { ok: true };
  }
}
