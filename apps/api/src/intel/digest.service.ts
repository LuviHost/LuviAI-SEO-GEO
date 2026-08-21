import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { EmailService } from '../email/email.service.js';
import { LLMProviderService } from '../llm/llm-provider.service.js';
import { SettingsService } from '../settings/settings.service.js';
import {
  GRADE_LABEL_TR,
  STATUS_LABEL_TR,
  type ClaimStatus,
  type EvidenceGrade,
} from './evidence-grade.js';

/**
 * Ozet — sistemin insanla temas ettigi yer. GUNDE BIR KEZ uretilir ve
 * e-postayla gonderilir; kullanicinin sisteme bakmasi gereken tek an
 * budur.
 *
 * Govde DETERMINISTIK uretilir (sayilar, durum degisimleri, alintilar):
 * ozetin kendisi halusinasyon kaynagi olmamali, cunku ekip bu metni
 * toplantida dayanak olarak kullanacak. LLM yalnizca en uste kisa bir
 * editor notu yazar ve o notun altinda dayandigi maddeler zaten acik
 * halde durur.
 *
 * ONCELIK SIRASI: durum degisimleri > yeni mitler > yeni dogrulamalar >
 * kayda deger yeni kanitlar. "Ne degisti" her zaman "ne var"dan onemli.
 */

const FALLBACK_MODEL = 'claude-haiku-4-5';

@Injectable()
export class IntelDigestService {
  private readonly log = new Logger(IntelDigestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly llm: LLMProviderService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Donem ozetini uretir, kaydeder ve (istenirse) e-postalar.
   * Ayni donem icin ikinci cagri var olan kaydin uzerine yazar.
   */
  async build(period: 'daily' | 'weekly', send = true): Promise<{ id: string; body: string; stats: any }> {
    const days = period === 'daily' ? 1 : 7;
    const since = new Date(Date.now() - days * 86_400_000);
    const date = startOfUtcDay(new Date());

    const [changedClaims, newEvidence, itemStats, sourceHealth] = await Promise.all([
      // Donem icinde HUKMU degisen iddialar.
      //
      // updatedAt DEGIL lastChangedAt: recomputeAll() her gece tum defteri
      // yeniden tartiyor ve eskiden deger degismese bile update() cagirdigi
      // icin @updatedAt her satirda tazeleniyordu. Sonuc: bu suzgec 745
      // iddianin tamamini esliyor, "Curutulen iddialar" bolumu o gunun
      // mitlerini degil defterdeki TUM mitleri listeliyordu. Modulun kendi
      // ilkesi bunun tersi: "Ne degisti her zaman ne var'dan onemli".
      this.prisma.intelClaim.findMany({
        where: { lastChangedAt: { gte: since } },
        orderBy: [{ confidence: 'asc' }],
        include: {
          evidences: {
            orderBy: { weight: 'desc' },
            take: 3,
            select: {
              grade: true, stance: true, quote: true, weight: true, sampleSize: true,
              item: { select: { url: true, title: true, publishedAt: true, source: { select: { name: true, tier: true } } } },
            },
          },
          _count: { select: { evidences: true } },
        },
      }),
      this.prisma.intelEvidence.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { weight: 'desc' },
        take: 15,
        include: {
          claim: { select: { slug: true, statement: true, status: true } },
          item: { select: { url: true, title: true, source: { select: { name: true } } } },
        },
      }),
      this.prisma.intelItem.groupBy({
        by: ['status'],
        where: { createdAt: { gte: since } },
        _count: true,
      }),
      this.prisma.intelSource.findMany({
        where: { OR: [{ enabled: false }, { failCount: { gt: 0 } }, { lastError: { not: null } }] },
        select: { key: true, name: true, enabled: true, failCount: true, lastError: true },
      }),
    ]);

    const stats = {
      period,
      collected: itemStats.reduce((n, s) => n + s._count, 0),
      byStatus: Object.fromEntries(itemStats.map((s) => [s.status, s._count])),
      claimsTouched: changedClaims.length,
      newEvidence: newEvidence.length,
      unhealthySources: sourceHealth.length,
    };

    const editorNote = await this.editorNote(changedClaims, period).catch((err) => {
      this.log.warn(`Editor notu uretilemedi: ${err.message}`);
      return null;
    });

    const body = this.render({ period, changedClaims, newEvidence, stats, sourceHealth, editorNote });

    const existing = await this.prisma.intelDigest.findUnique({
      where: { period_date: { period, date } },
      select: { id: true },
    });

    const digest = existing
      ? await this.prisma.intelDigest.update({
          where: { id: existing.id },
          data: { body, stats: stats as any },
        })
      : await this.prisma.intelDigest.create({
          data: { period, date, body, stats: stats as any },
        });

    if (send) {
      await this.sendEmail(digest.id, period, body, stats).catch((err) => {
        this.log.warn(`Ozet e-postasi gonderilemedi: ${err.message}`);
      });
    }

    return { id: digest.id, body, stats };
  }

  // ────────────────────────────────────────────────────────────
  //  GOVDE
  // ────────────────────────────────────────────────────────────

  private render(ctx: {
    period: 'daily' | 'weekly';
    changedClaims: any[];
    newEvidence: any[];
    stats: any;
    sourceHealth: any[];
    editorNote: string | null;
  }): string {
    const { period, changedClaims, newEvidence, stats, sourceHealth, editorNote } = ctx;
    const L: string[] = [];
    const title = period === 'daily' ? 'Günlük İstihbarat Özeti' : 'Haftalık İstihbarat Özeti';

    L.push(`# ${title} — ${new Date().toISOString().slice(0, 10)}`);
    L.push('');

    if (editorNote) {
      L.push(`> ${editorNote.replace(/\n+/g, ' ')}`);
      L.push('');
    }

    L.push(
      `**${stats.collected}** yeni yayın tarandı · ` +
      `**${stats.byStatus?.ANALYZED ?? 0}** analiz edildi · ` +
      `**${stats.newEvidence}** yeni kanıt · ` +
      `**${stats.claimsTouched}** iddia güncellendi`,
    );
    L.push('');

    // ── Öncelik 1: mitler ve doğrulamalar ──
    const byStatus = (s: ClaimStatus) => changedClaims.filter((c) => c.status === s);

    const myths = byStatus('MYTH');
    if (myths.length > 0) {
      L.push('## ⚠️ Çürütülen iddialar (MİT)');
      L.push('');
      L.push('_Yaygın inanışın aksine kanıt bunları çürütüyor. Toplantıda karşı taraf sormadan sen söyle._');
      L.push('');
      for (const c of myths) L.push(...this.claimBlock(c));
    }

    const confirmed = byStatus('CONFIRMED');
    if (confirmed.length > 0) {
      L.push('## ✅ Doğrulanan iddialar');
      L.push('');
      for (const c of confirmed) L.push(...this.claimBlock(c));
    }

    const contested = byStatus('CONTESTED');
    if (contested.length > 0) {
      L.push('## ⚖️ Çekişmeli');
      L.push('');
      L.push('_İki yönde de kanıt var — koşullu konuş._');
      L.push('');
      for (const c of contested) L.push(...this.claimBlock(c));
    }

    const stale = byStatus('STALE');
    if (stale.length > 0) {
      L.push('## 🕰️ Bayatlayan iddialar');
      L.push('');
      for (const c of stale) {
        L.push(`- **${c.statement}** — son kanıt ${c.lastEvidenceAt?.toISOString().slice(0, 10) ?? 'bilinmiyor'}. Yeniden doğrulanmalı.`);
      }
      L.push('');
    }

    const emerging = byStatus('EMERGING');
    if (emerging.length > 0) {
      L.push('## 🌱 Yeni sinyaller (kanıt henüz zayıf)');
      L.push('');
      for (const c of emerging.slice(0, 10)) {
        L.push(`- ${c.statement} _(${c._count?.evidences ?? 0} kanıt)_`);
      }
      L.push('');
    }

    // ── Öncelik 2: en güçlü yeni kanıtlar ──
    if (newEvidence.length > 0) {
      L.push('## 📄 Dönemin en güçlü kanıtları');
      L.push('');
      for (const e of newEvidence.slice(0, 8)) {
        const grade = GRADE_LABEL_TR[e.grade as EvidenceGrade] ?? e.grade;
        const stance = e.stance === 'refutes' ? 'çürütüyor' : e.stance === 'supports' ? 'destekliyor' : 'kısmen';
        const n = e.sampleSize ? `, N=${e.sampleSize.toLocaleString('tr-TR')}` : '';
        L.push(`- [${e.item.title}](${e.item.url}) — ${e.item.source.name} · **${grade}**${n} · _${e.claim.statement}_ iddiasını ${stance} (ağırlık ${e.weight})`);
      }
      L.push('');
    }

    // ── Ürün etkisi: hangi bulgu neyi ilgilendiriyor ──
    const withAreas = changedClaims.filter(
      (c) => Array.isArray(c.productAreas) && c.productAreas.length > 0 && c.actionStatus === 'OPEN',
    );
    if (withAreas.length > 0) {
      L.push('## 🔧 Ürün tarafında bakılacaklar');
      L.push('');
      for (const c of withAreas.slice(0, 10)) {
        L.push(`- \`${(c.productAreas as string[]).join('`, `')}\` → ${c.statement} _(${STATUS_LABEL_TR[c.status as ClaimStatus] ?? c.status})_`);
      }
      L.push('');
    }

    if (sourceHealth.length > 0) {
      L.push('## 🔌 Kaynak sağlığı');
      L.push('');
      for (const s of sourceHealth) {
        const state = !s.enabled ? 'DEVRE DIŞI' : s.failCount > 0 ? `${s.failCount} hata` : 'uyarı';
        L.push(`- ${s.name} — ${state}${s.lastError ? `: ${String(s.lastError).slice(0, 120)}` : ''}`);
      }
      L.push('');
    }

    if (changedClaims.length === 0 && newEvidence.length === 0) {
      L.push('_Bu dönemde iddia defterini değiştiren bir gelişme olmadı._');
      L.push('');
    }

    return L.join('\n');
  }

  private claimBlock(c: any): string[] {
    const L: string[] = [];
    L.push(`### ${c.statement}`);
    L.push('');
    L.push(`\`${c.slug}\` · ${STATUS_LABEL_TR[c.status as ClaimStatus] ?? c.status} · ${this.confidenceLabel(c.confidence, c.status)} · ${c._count?.evidences ?? 0} kanıt (destek ${c.supportWeight} / karşıt ${c.refuteWeight})`);
    L.push('');
    if (c.guidance) {
      L.push(`**Nasıl kullanılır:** ${c.guidance}`);
      L.push('');
    }
    for (const e of (c.evidences ?? []).slice(0, 3)) {
      const grade = GRADE_LABEL_TR[e.grade as EvidenceGrade] ?? e.grade;
      const arrow = e.stance === 'refutes' ? '✗' : e.stance === 'supports' ? '✓' : '~';
      const n = e.sampleSize ? ` N=${e.sampleSize.toLocaleString('tr-TR')}` : '';
      L.push(`- ${arrow} **${grade}**${n} — [${e.item.source.name}](${e.item.url})`);
      if (e.quote) L.push(`  > ${String(e.quote).slice(0, 300).replace(/\n+/g, ' ')}`);
    }
    L.push('');
    return L;
  }

  /**
   * Guven degerinin OKUNABILIR karsiligi.
   *
   * confidence -1..+1 arasinda ve isareti yonu tasiyor: eksi = kaniti
   * curutuyor, arti = destekliyor. Eskiden mutlak deger basiliyordu, bu
   * yuzden confidence = -1.0 olan bir MIT e-postada "guven %100" goruunuyor
   * ve "bu iddiaya %100 guveniliyor" gibi okunuyordu. Kastedilen tam tersi:
   * "curutuldugunden %100 eminiz".
   *
   * Hesap degismedi, yalnizca etiket duruma gore ayrisiyor.
   */
  private confidenceLabel(confidence: number, status: string): string {
    const pct = Math.round(Math.abs(confidence ?? 0) * 100);
    if (status === 'MYTH') return `çürütme gücü %${pct}`;
    if (status === 'CONFIRMED') return `doğrulama gücü %${pct}`;
    // CONTESTED / EMERGING / STALE — yon belirsiz, isaretli ham deger daha
    // durust: okuyan hangi tarafa egildigini gorsun.
    const signed = (confidence ?? 0) >= 0 ? `+${pct}` : `−${pct}`;
    return `denge ${signed}`;
  }

  /**
   * Editor notu — 2-3 cumle. Modele YALNIZCA hesaplanmis durumlar
   * verilir; yorum yapmasi istenir, olgu uretmesi degil.
   */
  private async editorNote(claims: any[], period: string): Promise<string | null> {
    const notable = claims.filter((c) => ['MYTH', 'CONFIRMED', 'CONTESTED'].includes(c.status));
    if (notable.length === 0) return null;

    const model = (await this.settings.getString('MODEL_INTEL_TRIAGE').catch(() => null))?.trim() || FALLBACK_MODEL;
    const lines = notable
      .slice(0, 15)
      .map((c) => `- [${c.status}] ${c.statement} (güven ${c.confidence})`)
      .join('\n');

    const res = await this.llm.chat({
      context: 'intel-digest',
      model,
      systemPrompt:
        'Sen bir GEO/SEO/ASO platformunun arastirma editorusun. Verilen iddia durumlarina bakarak ' +
        `${period === 'daily' ? 'gunun' : 'haftanin'} en onemli cikarimini 2-3 cumleyle yaz. ` +
        'Turkce yaz. Yeni olgu UYDURMA — yalnizca verilen maddeleri yorumla. ' +
        'Onemli bir sey yoksa bunu durustce soyle. Baslik yazma, dogrudan paragrafa gec.',
      messages: [{ role: 'user', content: lines }],
      maxTokens: 500,
      effort: 'low',
    });

    return res.output.trim() || null;
  }

  // ────────────────────────────────────────────────────────────
  //  E-POSTA
  // ────────────────────────────────────────────────────────────

  private async sendEmail(digestId: string, period: string, body: string, stats: any): Promise<void> {
    const to = (await this.settings.getString('INTEL_DIGEST_TO').catch(() => null))?.trim()
      || process.env.INTEL_DIGEST_TO
      || null;

    if (!to) {
      this.log.log('INTEL_DIGEST_TO tanimli degil — ozet yalnizca panelde');
      return;
    }

    const subject = `RanksUp İstihbarat — ${period === 'daily' ? 'Günlük' : 'Haftalık'} Özet (${stats.claimsTouched} iddia)`;
    const res = await this.email.sendRaw({ to, subject, html: markdownToHtml(body) });
    if (res.ok) {
      await this.prisma.intelDigest.update({ where: { id: digestId }, data: { emailedAt: new Date() } });
    }
  }

  async latest(period?: string) {
    return this.prisma.intelDigest.findFirst({
      where: period ? { period } : undefined,
      orderBy: { date: 'desc' },
    });
  }
}

// ═══════════════════════════════════════════════════════════════

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Ozet markdown'i icin kucuk bir donusturucu. Tam bir markdown motoru
 * degil — yalnizca render()'in urettigi bicimleri karsilar (baslik,
 * liste, alinti, kalin, link, kod). Disaridan icerik almadigi icin
 * yuzey dar ve ongorulebilir.
 */
export function markdownToHtml(md: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const inline = (s: string) =>
    esc(s)
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:#2563eb;text-decoration:none">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code style="background:#f1f5f9;padding:1px 5px;border-radius:4px;font-size:13px">$1</code>')
      .replace(/_([^_]+)_/g, '<em>$1</em>');

  const out: string[] = [];
  let inList = false;

  const closeList = () => {
    if (inList) { out.push('</ul>'); inList = false; }
  };

  for (const line of md.split('\n')) {
    const t = line.trim();

    if (!t) { closeList(); continue; }

    if (t.startsWith('### ')) { closeList(); out.push(`<h3 style="margin:24px 0 6px;font-size:17px">${inline(t.slice(4))}</h3>`); continue; }
    if (t.startsWith('## ')) { closeList(); out.push(`<h2 style="margin:32px 0 10px;font-size:20px;border-bottom:1px solid #e2e8f0;padding-bottom:6px">${inline(t.slice(3))}</h2>`); continue; }
    if (t.startsWith('# ')) { closeList(); out.push(`<h1 style="margin:0 0 16px;font-size:24px">${inline(t.slice(2))}</h1>`); continue; }

    if (t.startsWith('> ')) {
      closeList();
      out.push(`<blockquote style="margin:12px 0;padding:10px 14px;border-left:3px solid #94a3b8;background:#f8fafc;color:#475569">${inline(t.slice(2))}</blockquote>`);
      continue;
    }

    if (t.startsWith('- ')) {
      if (!inList) { out.push('<ul style="margin:8px 0;padding-left:20px">'); inList = true; }
      out.push(`<li style="margin:5px 0;line-height:1.55">${inline(t.slice(2))}</li>`);
      continue;
    }

    closeList();
    out.push(`<p style="margin:10px 0;line-height:1.6">${inline(t)}</p>`);
  }
  closeList();

  return `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;max-width:720px;margin:0 auto;padding:28px 20px">${out.join('\n')}</body></html>`;
}
