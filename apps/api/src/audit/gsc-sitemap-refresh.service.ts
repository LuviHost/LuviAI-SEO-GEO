import { Injectable, Logger } from '@nestjs/common';
import { google } from 'googleapis';
import { PrismaService } from '../prisma/prisma.service.js';
import { GscOAuthService } from '../auth/gsc-oauth.service.js';
import { safeFetchText } from '../common/safe-fetch.js';
import { urlHostMatches } from './host-match.js';
import { childSitemaps, newestLastmod, submitKarari } from './sitemap-degisim.js';

/**
 * Gunluk site haritasi yenilemesi — Search Console'a bagli her site (worker GSC_SITEMAP_REFRESH).
 *
 * NEDEN (24.11.2026): RanksUp site haritasini yalniz RanksUp makale yayinlayinca
 * gonderiyordu (ai-indexing-pinger). Musteri kendi sitesini baska yoldan
 * guncelleyince Google'a haber gitmiyordu. Google'in bugun destekledigi kanal
 * Search Console API'sidir (sitemap ping 2023'te kapandi); gonderim dizine almayi
 * garanti etmez, Google site haritasini sirasina alir. API ucretsiz.
 *
 * KURAL: yalniz musterinin Search Console'da ZATEN kayitli tuttugu site haritalari
 * yeniden gonderilir — onun yerine yeni site haritasi eklenmez. Her biri icin en
 * yeni <lastmod> (dizinse ayni sitedeki alt haritalar dahil) son gonderimden
 * yeniyse gonderilir (sitemap-degisim.ts). Tarihsiz, .txt, .gz ve sitenin alan
 * adi disindaki kayitlara dokunulmaz; Google'in sirasinda bekleyen (isPending)
 * atlanir. Site haritasi SSRF korumali okuyucuyla okunur.
 */

export type SitemapEylem = 'gonderildi' | 'degismedi' | 'atlandi' | 'hata';

export interface SitemapSonuc {
  path: string;
  eylem: SitemapEylem;
  neden: string;
}

/** Site basina en fazla kac kayitli site haritasina bakilir */
export const SITE_BASINA_EN_FAZLA = 10;

@Injectable()
export class GscSitemapRefreshService {
  private readonly log = new Logger(GscSitemapRefreshService.name);
  /** Testte degistirilir */
  protected fetchText = safeFetchText;
  protected webmasters = (auth: unknown) => google.webmasters({ version: 'v3', auth: auth as any });
  protected bekle = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  constructor(
    private readonly prisma: PrismaService,
    private readonly gsc: GscOAuthService,
  ) {}

  async runAll(opts: { siteArasiMs?: number } = {}) {
    const siteler = await this.prisma.site.findMany({
      where: { gscRefreshToken: { not: null }, gscPropertyUrl: { not: null } },
      select: { id: true, url: true, gscPropertyUrl: true },
    });
    const ozet = { site: siteler.length, gonderildi: 0, degismedi: 0, atlandi: 0, hata: 0 };
    for (const site of siteler) {
      try {
        for (const s of await this.refreshSite(site)) ozet[s.eylem]++;
      } catch (err: any) {
        ozet.hata++;
        this.log.warn(`[${site.id}] site haritasi yenilemesi: ${String(err?.message ?? err).slice(0, 200)}`);
      }
      await this.bekle(opts.siteArasiMs ?? 2000);
    }
    this.log.log(`GSC site haritasi: ${ozet.site} site · gönderildi ${ozet.gonderildi} · değişmedi ${ozet.degismedi} · atlandı ${ozet.atlandi} · hata ${ozet.hata}`);
    return ozet;
  }

  async refreshSite(site: { id: string; url: string; gscPropertyUrl: string | null }): Promise<SitemapSonuc[]> {
    let host: string;
    try { host = new URL(site.url).hostname; } catch { return []; }
    const client = await this.gsc.getAuthenticatedClient(site.id);
    if (!client || !site.gscPropertyUrl) return [];
    const wm = this.webmasters(client);
    const liste = (await wm.sitemaps.list({ siteUrl: site.gscPropertyUrl })).data.sitemap ?? [];

    const sonuc: SitemapSonuc[] = [];
    for (const sm of liste.slice(0, SITE_BASINA_EN_FAZLA)) {
      const path = typeof sm.path === 'string' ? sm.path : '';
      const atla = (neden: string) => sonuc.push({ path, eylem: 'atlandi', neden });
      if (!/^https?:\/\//i.test(path)) { atla('adres geçersiz'); continue; }
      if (/\.(txt|gz)(\?|$)/i.test(path)) { atla('site haritası XML değil'); continue; }
      if (!urlHostMatches(path, host)) { atla('sitenin alan adında değil'); continue; }
      if (sm.isPending) { atla('Google sırasında bekliyor'); continue; }

      const okuma = await this.enYeniDegisim(path, host);
      if (!okuma.okundu) { atla('site haritası okunamadı'); continue; }
      const karar = submitKarari(okuma.enYeni, sm.lastSubmitted ?? null);
      if (!karar.gonder) { sonuc.push({ path, eylem: 'degismedi', neden: karar.neden }); continue; }
      try {
        await wm.sitemaps.submit({ siteUrl: site.gscPropertyUrl, feedpath: path });
        sonuc.push({ path, eylem: 'gonderildi', neden: karar.neden });
        this.log.log(`[${site.id}] ${path} gönderildi — ${karar.neden}`);
      } catch (err: any) {
        const status = err?.code ?? err?.response?.status;
        sonuc.push({ path, eylem: 'hata', neden: status === 403 ? 'yazma izni yok (Search Console yeniden bağlanmalı)' : String(err?.message ?? err).slice(0, 160) });
      }
    }
    return sonuc;
  }

  /** Site haritasinin ve (dizinse) ayni sitedeki alt haritalarinin en yeni lastmod'u */
  private async enYeniDegisim(url: string, host: string): Promise<{ okundu: boolean; enYeni: Date | null }> {
    const oku = async (u: string) => {
      try {
        const r = await this.fetchText(u, { accept: 'application/xml, text/xml;q=0.9, */*;q=0.5', maxBytes: 10 * 1024 * 1024, timeoutMs: 20_000 });
        return r.ok ? r.text : null;
      } catch { return null; }
    };
    const xml = await oku(url);
    if (!xml) return { okundu: false, enYeni: null };
    let enYeni = newestLastmod(xml);
    for (const cocuk of childSitemaps(xml).filter((u) => urlHostMatches(u, host))) {
      const cx = await oku(cocuk);
      const t = cx ? newestLastmod(cx) : null;
      if (t && (!enYeni || t > enYeni)) enYeni = t;
    }
    return { okundu: true, enYeni };
  }
}
