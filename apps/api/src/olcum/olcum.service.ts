import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { createLimiter, describeProbe, probeUrl, type Probe } from '../audit/axo-fetch.js';
import { parseSiteUrlInput } from '../sites/site-url-policy.js';
import {
  ayniKokenScriptleri,
  gtmKimlikleri,
  olcumBulgulari,
  olcumTespit,
  type OlcumBulgusu,
  type OlcumRaporu,
} from './olcum-tespit.js';

/**
 * Olcum altyapisi taramasi — I/O katmani (tespit saf olcum-tespit.ts).
 * Musterinin sitesi + Rakipler sayfasindaki liste (Brain.competitors, sirayla en fazla RAKIP_SINIRI) icin:
 * ana sayfa → ayni kokenli JS paketleri → sayfada/pakette gecen GTM kapsayicilari (gtm.js).
 *
 * NEDEN arka planda: site basina onlarca istek; Cloudflare 100 sn'de istegi keser (499).
 * POST taramayi baslatir ve hemen doner, panel GET ile durumu okur.
 * NEDEN sirali ve butceli: API'nin bellek tavani 800M (ecosystem.config.cjs); siteler tek tek,
 * site basina en fazla SITE_BAYT_BUTCESI indirilir, metinler tespitten sonra birakilir.
 * NEDEN tablo degil KV: gecmis gerekmiyor, son sonuc yeter; sema/migration degismez.
 */

/**
 * NEDEN 10: 5 iken elle eklenen rakipler (listenin sonuna eklenir) taranmiyordu — en yakin rakipler
 * disarida kaliyordu (05.11). Fazlasi atlanir ve panelde adlariyla yazilir.
 */
export const RAKIP_SINIRI = 10;
const SCRIPT_SINIRI = 25;
const GTM_SINIRI = 3;
const SAYFA_BAYT = 2 * 1024 * 1024;
const SCRIPT_BAYT = 2 * 1024 * 1024;
const GTM_BAYT = 3 * 1024 * 1024;
const SITE_BAYT_BUTCESI = 12 * 1024 * 1024;
/** Tum tarama icin ust sure: asilirsa kalan siteler "olculemedi (sure doldu)" olur */
const TARAMA_SURESI_MS = 8 * 60_000;
/** Ayni site icin yeniden tarama araligi (dis sitelere gereksiz yuk olmasin) */
export const YENIDEN_TARAMA_MS = 10 * 60_000;
const SONUC_TTL_MS = 90 * 24 * 60 * 60_000;
/** Yarim kalan tarama (surec yeniden basladi) bu sureden sonra "calisiyor" sayilmaz */
const CALISMA_ZAMAN_ASIMI_MS = TARAMA_SURESI_MS + 60_000;
const ONBELLEK_MAX_BAYT = 256 * 1024;

export type HedefSonucu = {
  ad: string;
  url: string;
  rakip: boolean;
  durum: 'tamam' | 'olculemedi';
  /** olculemedi ise kisa Turkce neden */
  neden?: string;
  rapor?: OlcumRaporu;
  /** yalniz musterinin kendi sitesi icin */
  bulgular?: OlcumBulgusu[];
  taranan?: { script: number; gtm: number; kesildi: boolean };
};

export type OlcumSonucu = {
  durum: 'calisiyor' | 'tamam';
  baslangic: string;
  bitis?: string;
  hedefler: HedefSonucu[];
  /** RAKIP_SINIRI'ni asan rakipler (taranmadi) */
  atlananRakipler?: string[];
};

type Hedef = { ad: string; url: string; rakip: boolean };

const anahtar = (siteId: string) => `olcum:v1:${siteId}`;

/** Brain.competitors → taranabilir rakip adresleri (IP/port/ic ag kurali site adresiyle ayni) */
export function rakipHedefleri(raw: unknown, siteUrl: string, sinir = RAKIP_SINIRI): Hedef[] {
  return rakipListesi(raw, siteUrl).slice(0, sinir);
}

/** Tekilsiz, gecerli tum rakipler (sirasi Rakipler sayfasindaki gibi) */
export function rakipListesi(raw: unknown, siteUrl: string): Hedef[] {
  if (!Array.isArray(raw)) return [];
  const kendi = hostOf(siteUrl);
  const gorulen = new Set<string>(kendi ? [kendi] : []);
  const out: Hedef[] = [];
  for (const c of raw) {
    if (!c || typeof c !== 'object') continue;
    const r = c as { name?: unknown; url?: unknown };
    if (typeof r.url !== 'string' || !r.url.trim()) continue;
    let u: URL;
    try {
      u = parseSiteUrlInput(r.url);
    } catch {
      continue;
    }
    const host = u.hostname.replace(/^www\./, '');
    if (gorulen.has(host)) continue;
    gorulen.add(host);
    out.push({ ad: typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 80) : host, url: `${u.protocol}//${u.host}/`, rakip: true });
  }
  return out;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

@Injectable()
export class OlcumService {
  private readonly log = new Logger(OlcumService.name);
  /** ayni surecte ayni site icin ikinci tarama baslamasin */
  private readonly suren = new Set<string>();

  constructor(private readonly prisma: PrismaService) {}

  async son(siteId: string): Promise<OlcumSonucu | null> {
    const row = await this.prisma.kvStore.findUnique({ where: { key: anahtar(siteId) } }).catch(() => null);
    if (!row || (row.expiresAt && row.expiresAt.getTime() < Date.now())) return null;
    try {
      const s = JSON.parse(row.value) as OlcumSonucu;
      // surec tarama sirasinda yeniden basladiysa "calisiyor" sonsuza kalmasin
      if (s.durum === 'calisiyor' && Date.now() - Date.parse(s.baslangic) > CALISMA_ZAMAN_ASIMI_MS && !this.suren.has(siteId)) {
        return { ...s, durum: 'tamam', bitis: s.baslangic };
      }
      return s;
    } catch {
      return null;
    }
  }

  /**
   * Taramayi arka planda baslatir; hemen doner. Zaten suruyorsa ya da son tarama YENIDEN_TARAMA_MS'den
   * yeniyse yeni tarama baslatmaz, mevcut sonucu doner (baslatildi:false).
   */
  async baslat(siteId: string): Promise<{ baslatildi: boolean; sonuc: OlcumSonucu | null }> {
    const site = await this.prisma.site.findUnique({
      where: { id: siteId },
      select: { id: true, url: true, name: true, brain: { select: { competitors: true } } },
    });
    if (!site) throw new NotFoundException('Site bulunamadı');
    const mevcut = await this.son(siteId);
    if (this.suren.has(siteId) || (mevcut?.durum === 'calisiyor')) return { baslatildi: false, sonuc: mevcut };
    if (mevcut?.bitis && Date.now() - Date.parse(mevcut.bitis) < YENIDEN_TARAMA_MS) return { baslatildi: false, sonuc: mevcut };

    const rakipler = rakipListesi(site.brain?.competitors, site.url);
    const hedefler: Hedef[] = [
      { ad: site.name || hostOf(site.url) || site.url, url: site.url, rakip: false },
      ...rakipler.slice(0, RAKIP_SINIRI),
    ];
    const atlanan = rakipler.slice(RAKIP_SINIRI).map((r) => r.ad);
    const baslangic: OlcumSonucu = {
      durum: 'calisiyor', baslangic: new Date().toISOString(), hedefler: [],
      ...(atlanan.length ? { atlananRakipler: atlanan } : {}),
    };
    this.suren.add(siteId);
    await this.yaz(siteId, baslangic);
    void this.calistir(siteId, hedefler, baslangic)
      .catch((err) => this.log.warn(`[olcum] ${siteId} tarama hatasi: ${err?.message ?? err}`))
      .finally(() => this.suren.delete(siteId));
    return { baslatildi: true, sonuc: baslangic };
  }

  private async calistir(siteId: string, hedefler: Hedef[], s: OlcumSonucu): Promise<void> {
    const bitisZamani = Date.now() + TARAMA_SURESI_MS;
    const sonuclar: HedefSonucu[] = [];
    for (const h of hedefler) {
      const r = Date.now() >= bitisZamani
        ? { ...h, durum: 'olculemedi' as const, neden: 'Tarama süresi doldu.' }
        : await this.hedefiTara(h, bitisZamani).catch((err): HedefSonucu => ({ ...h, durum: 'olculemedi', neden: `Tarama hatası: ${String(err?.message ?? err).slice(0, 120)}` }));
      sonuclar.push(r);
      // ara sonuc: panel ilerlemeyi gorsun
      await this.yaz(siteId, { ...s, hedefler: sonuclar });
    }
    await this.yaz(siteId, { ...s, durum: 'tamam', bitis: new Date().toISOString(), hedefler: sonuclar });
  }

  /** Tek site: ana sayfa → JS paketleri → GTM kapsayicilari. Disari yalniz GET; form/olay tetiklenmez. */
  async hedefiTara(h: Hedef, bitisZamani = Date.now() + TARAMA_SURESI_MS, fetcher?: Parameters<typeof probeUrl>[2]): Promise<HedefSonucu> {
    const sayfa = await probeUrl(h.url, { maxBytes: SAYFA_BAYT, timeoutMs: 15_000, accept: 'text/html,application/xhtml+xml' }, fetcher);
    if (sayfa.state !== 'ok') return { ...h, durum: 'olculemedi', neden: sayfa.block?.reason ?? `Ana sayfa okunamadı (${describeProbe(sayfa)}).` };
    let butce = SITE_BAYT_BUTCESI - sayfa.text.length;
    let kesildi = false;
    const limit = createLimiter(3);
    const getir = (url: string, maxBytes: number) => limit(async (): Promise<Probe | null> => {
      if (butce <= 0 || Date.now() >= bitisZamani) {
        kesildi = true;
        return null;
      }
      const p = await probeUrl(url, { maxBytes: Math.min(maxBytes, butce), timeoutMs: 10_000, accept: '*/*' }, fetcher);
      butce -= p.text.length;
      if (p.truncated) kesildi = true;
      return p.state === 'ok' ? p : null;
    });

    const scriptler = ayniKokenScriptleri(sayfa.text, sayfa.finalUrl || h.url, SCRIPT_SINIRI);
    const js = (await Promise.all(scriptler.map((u) => getir(u, SCRIPT_BAYT)))).filter((p): p is Probe => !!p).map((p) => p.text);
    const gtm: Record<string, string> = {};
    for (const id of gtmKimlikleri([sayfa.text, ...js], GTM_SINIRI)) {
      const p = await getir(`https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(id)}`, GTM_BAYT);
      if (p) gtm[id] = p.text;
    }
    const rapor = olcumTespit({ html: sayfa.text, js, gtm });
    return {
      ...h, durum: 'tamam', rapor,
      ...(h.rakip ? {} : { bulgular: olcumBulgulari(rapor) }),
      taranan: { script: js.length, gtm: Object.keys(gtm).length, kesildi },
    };
  }

  private async yaz(siteId: string, s: OlcumSonucu): Promise<void> {
    const value = JSON.stringify(s);
    if (Buffer.byteLength(value, 'utf8') > ONBELLEK_MAX_BAYT) {
      this.log.warn(`[olcum] ${siteId} sonuc cok buyuk, yazilmadi`);
      return;
    }
    const expiresAt = new Date(Date.now() + SONUC_TTL_MS);
    await this.prisma.kvStore
      .upsert({ where: { key: anahtar(siteId) }, create: { key: anahtar(siteId), value, expiresAt }, update: { value, expiresAt } })
      .catch((err) => this.log.warn(`[olcum] sonuc yazilamadi: ${err.message}`));
  }
}
