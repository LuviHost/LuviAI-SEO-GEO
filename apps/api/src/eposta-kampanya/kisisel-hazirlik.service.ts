import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { LLMProviderService } from '../llm/llm-provider.service.js';
import { AiCitationService } from '../audit/ai-citation.service.js';
import { probeUrl, describeProbe } from '../audit/axo-fetch.js';
import { normalizeDomain } from '../prospect/prospect-utils.js';
import {
  KISISEL_ASILI_MS, KISISEL_ASISTANLAR, KISISEL_AZAMI_DENEME, KISISEL_GECERLILIK_MS, KISISEL_MODEL, KISISEL_SEMA,
  KISISEL_SISTEM, KISISEL_SURUM, type KisiselInceleme, type KisiselVeri, kisiselKullaniciMesaji, llmCiktisiniDogrula,
  olcumOzeti, sayfaOzeti, sayfaYeterliMi,
} from './kisisel.js';

export type HazirlikSonucu = { hazirlanan: number; incele: number; ertelenen: number; stok: number; neden?: string };
type Sonuc = { durum: 'HAZIR'; veri: KisiselVeri } | { durum: 'INCELE'; inceleme: KisiselInceleme } | { durum: 'TEKRAR'; neden: string };

/** Tek calistirmada en fazla (worker 30 dk'da bir cagirir; her firma ~1 dk) */
const TUR_BASI = 4;

/**
 * Kurumsal kisisel mail hazirligi. Gonderim (EpostaKampanyaService.tick) yalniz HAZIR satirlari alir; bu servis
 * gonderim sirasindaki (iysYuklendiAt) adresleri onceden hazirlar ve gunluk kotanin iki kati kadar stok tutar.
 *
 * Sahiplenme atomik (kisiselDurum null → HAZIRLANIYOR): worker turu ile paneldeki "Hazırla" ayni firmayi iki kez
 * olcup iki kez para harcamaz. Olcum kotadan/haftalik haktan dusmez (sistem satis araci), maliyet saglayici
 * defterine yazilir.
 */
@Injectable()
export class KisiselHazirlikService {
  private readonly log = new Logger(KisiselHazirlikService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LLMProviderService,
    private readonly citation: AiCitationService,
  ) {}

  async hazirla(o: { stokHedefi: number; adet?: number }): Promise<HazirlikSonucu> {
    const simdi = Date.now();
    const taze = new Date(simdi - KISISEL_GECERLILIK_MS);
    // Surec olunce HAZIRLANIYOR'da kalan satir yeniden denensin
    await this.prisma.epostaHedef.updateMany({
      where: { kisiselDurum: 'HAZIRLANIYOR', kisiselAt: { lt: new Date(simdi - KISISEL_ASILI_MS) } },
      data: { kisiselDurum: null },
    });
    const stok = await this.prisma.epostaHedef.count({
      where: { durum: 'SIRADA', sektor: { not: 'ajans' }, kisiselDurum: 'HAZIR', kisiselAt: { gte: taze } },
    });
    const ihtiyac = Math.min(o.adet ?? TUR_BASI, Math.max(0, o.stokHedefi - stok));
    if (ihtiyac === 0) return { hazirlanan: 0, incele: 0, ertelenen: 0, stok, neden: 'Stok yeterli' };

    // Gonderim sirasiyla: hazirlanmamis ya da olcumu eskimis olanlar
    const adaylar = await this.prisma.epostaHedef.findMany({
      where: {
        durum: 'SIRADA',
        sektor: { not: 'ajans' },
        OR: [{ kisiselDurum: null }, { kisiselDurum: 'HAZIR', kisiselAt: { lt: taze } }],
      },
      orderBy: { iysYuklendiAt: 'asc' },
      take: ihtiyac,
      select: { id: true, firma: true, web: true, email: true, kisiselDurum: true, kisisel: true },
    });

    let hazirlanan = 0, incele = 0, ertelenen = 0;
    for (const a of adaylar) {
      const al = await this.prisma.epostaHedef.updateMany({
        where: { id: a.id, durum: 'SIRADA', kisiselDurum: a.kisiselDurum },
        data: { kisiselDurum: 'HAZIRLANIYOR', kisiselAt: new Date() },
      });
      if (al.count !== 1) continue; // baska tur aldi
      const onceki = (a.kisisel && typeof a.kisisel === 'object' ? (a.kisisel as KisiselInceleme) : null);
      let s: Sonuc;
      try {
        s = await this.firmaHazirla({ firma: a.firma, web: a.web, email: a.email });
      } catch (e: any) {
        s = { durum: 'TEKRAR', neden: String(e?.message ?? e).slice(0, 200) };
      }
      if (s.durum === 'HAZIR') {
        hazirlanan++;
        await this.prisma.epostaHedef.update({ where: { id: a.id }, data: { kisisel: s.veri as any, kisiselDurum: 'HAZIR', kisiselAt: new Date() } });
        continue;
      }
      if (s.durum === 'TEKRAR') {
        const deneme = (onceki?.deneme ?? 0) + 1;
        if (deneme < KISISEL_AZAMI_DENEME) {
          ertelenen++;
          await this.prisma.epostaHedef.update({ where: { id: a.id }, data: { kisisel: { neden: s.neden, deneme } as any, kisiselDurum: null, kisiselAt: new Date() } });
          continue;
        }
        s = { durum: 'INCELE', inceleme: { neden: `${KISISEL_AZAMI_DENEME} denemede hazırlanamadı: ${s.neden}`, deneme } };
      }
      incele++;
      await this.prisma.epostaHedef.update({ where: { id: a.id }, data: { kisisel: s.inceleme as any, kisiselDurum: 'INCELE', kisiselAt: new Date() } });
    }
    this.log.log(`Kisisel hazirlik: ${hazirlanan} hazir, ${incele} incele, ${ertelenen} ertelendi (stok ${stok + hazirlanan}/${o.stokHedefi})`);
    return { hazirlanan, incele, ertelenen, stok: stok + hazirlanan };
  }

  /** Tek firma: site → faaliyet + soru (LLM, dogrulanmis) → iki asistanda olcum. Gonderilebilir degilse INCELE. */
  async firmaHazirla(h: { firma: string; web: string | null; email: string }): Promise<Sonuc> {
    const host = normalizeDomain(h.web || h.email.split('@')[1] || '');
    if (!host) return { durum: 'INCELE', inceleme: { neden: 'Alan adı yok' } };

    const sayfa = await probeUrl(`https://${host}/`, { maxBytes: 1_500_000, timeoutMs: 15_000, accept: 'text/html,application/xhtml+xml' });
    if (sayfa.state === 'unreachable') return { durum: 'TEKRAR', neden: `Site açılmadı (${describeProbe(sayfa)})` };
    if (sayfa.state !== 'ok') return { durum: 'INCELE', inceleme: { neden: sayfa.block?.reason ?? `Ana sayfa okunamadı (${describeProbe(sayfa)})` } };
    const ozet = sayfaOzeti(sayfa.text);
    if (!sayfaYeterliMi(ozet)) return { durum: 'INCELE', inceleme: { neden: 'Ana sayfada firmanın ne yaptığını anlatacak kadar içerik yok' } };

    const res = await this.llm.chat({
      context: 'eposta-kisisel',
      model: KISISEL_MODEL,
      systemPrompt: KISISEL_SISTEM,
      messages: [{ role: 'user', content: kisiselKullaniciMesaji({ firma: h.firma, host, sayfa: ozet }) }],
      maxTokens: 800,
      effort: 'low',
      outputSchema: KISISEL_SEMA,
    });
    if (res.stopReason === 'refusal' || res.stopReason === 'max_tokens') return { durum: 'TEKRAR', neden: `Model: ${res.stopReason}` };
    let raw: unknown = null;
    try { raw = JSON.parse(res.output); } catch { raw = null; }
    const d = llmCiktisiniDogrula(raw, { host, firma: h.firma });
    if (!d.ok) return { durum: 'INCELE', inceleme: { neden: d.neden } };

    // Iki asistan, tek soru, web aramali. Ikisi de olculmezse "siz yoktunuz" tek kaynaga dayanir → gonderilmez.
    const sonuc = await this.citation.runPublicProbes({
      brand: d.marka,
      host,
      queries: [d.soru],
      only: KISISEL_ASISTANLAR.map((x) => x.provider),
    });
    const { asistanlar, adaylar } = olcumOzeti(sonuc, host);
    const maliyet = sonuc.reduce((t, r) => t + (r.cost ?? 0), 0) + (res.costUsd ?? 0);
    if (!asistanlar.every((x) => x.olculdu)) {
      const eksik = asistanlar.filter((x) => !x.olculdu).map((x) => x.ad).join(', ');
      return { durum: 'TEKRAR', neden: `${eksik} ölçülemedi` };
    }
    // Cevaptaki alan adlarindan gercek rakipler (saglayici/kaynak siteler elenir); hata olursa liste bos kalir
    let gecenler: string[] = [];
    if (adaylar.length) {
      const tut = await this.citation
        .classifyRealCompetitors({ brand: d.marka, host, customNiche: d.faaliyet, candidates: adaylar })
        .catch(() => new Set<string>());
      gecenler = adaylar.filter((x) => tut.has(x)).slice(0, 3);
    }
    return {
      durum: 'HAZIR',
      veri: {
        surum: KISISEL_SURUM,
        marka: d.marka,
        faaliyet: d.faaliyet,
        soru: d.soru,
        olcum: { tarih: new Date().toISOString(), asistanlar, gecenler },
        maliyetUsd: Math.round(maliyet * 10_000) / 10_000,
      },
    };
  }
}
