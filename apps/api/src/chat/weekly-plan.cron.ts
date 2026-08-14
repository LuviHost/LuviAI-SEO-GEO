import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { acquireCronLock } from '../common/cron-lock.js';
import { ChatService } from './chat.service.js';
import { ActionPlansService } from '../action-plans/action-plans.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { EmailService } from '../email/email.service.js';

/**
 * "Bu haftanin plani" — ZAMANLANMIS TESLIM.
 *
 * Skill zaten calisiyordu ama tamamen pasifti: kullanicinin panele girip
 * butona basmasi gerekiyordu, yani plan ancak hatirlanirsa uretiliyordu.
 * Bu cron Pazartesi sabahi plani kendisi uretir ve uc kanaldan teslim eder:
 *   1) Aksiyon Plani maddeleri (kalici, panelde islenebilir)
 *   2) Bildirim (panel ici)
 *   3) E-posta (haftalik rapor bicimiyle ayni cerceve)
 *
 * KALICILIK KARARI — plan neden Aksiyon Planina yaziliyor:
 * Chat konusmasi da kaydediliyor (ChatService kendi mesajlarini saklar),
 * ama konusma pasif bir metin; kullanicinin uzerinde is yapabilecegi yer
 * Aksiyon Plani. Maddeler source:'chat' ve sourceRef:'weekly-plan:<hafta>:<n>'
 * ile eklenir; sourceRef sayesinde cron iki kez calissa bile (elle tetikleme,
 * yeniden deploy) ayni hafta icin cift madde acilmaz — ActionPlansService.create
 * acik ayni sourceRef'i gorunce mevcut kaydi dondurur.
 */

/** Plan maddesi tavani — skill zaten 5-7 madde yaziyor, fazlasi gurultu */
const MAX_ITEMS_PER_SITE = 7;

/**
 * Site arasi bekleme. Her site bir agent dongusu (6 tool turuna kadar
 * Sonnet cagrisi) demek; 50 site ust uste kosarsa hem rate limit hem de
 * dakikalar icinde toplu maliyet olusur.
 */
const SITE_PAUSE_MS = 5_000;

/** Ucretli plan kademeleri — TRIAL disindaki her sey. */
export const PAID_PLAN_TIERS = ['STARTER', 'PRO', 'AGENCY', 'ENTERPRISE'] as const;

export interface WeeklyPlanCandidate {
  siteId: string;
  siteName: string;
  userId: string;
  userEmail: string;
  userName: string | null;
  userRole: string;
  plan: string;
  subscriptionStatus: string;
}

/**
 * ZAMANLAMA anahtari — INTEL_CRON ile ayni desen, TEK FARKI varsayilani.
 * Intel kapali olmadigi surece calisir; bu cron ise her sitede LLM
 * harcamasi dogurdugu icin ACIKCA acilmadikca calismaz.
 */
export function isWeeklyPlanCronEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.WEEKLY_PLAN_CRON === 'true';
}

/**
 * Ust sinir cozumleme. Gecersiz/negatif deger sessizce 50'ye duser —
 * yanlis yazilmis bir env yuzunden butun siteleri taramak, faturayi
 * kontrolsuz buyutur.
 */
export function resolveMaxSites(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.WEEKLY_PLAN_MAX_SITES);
  if (!Number.isFinite(raw) || raw <= 0) return 50;
  return Math.floor(raw);
}

/** Sahibi ucretli planda mi — trial'a plan uretmiyoruz (maliyet). */
export function isPaidOwner(row: { plan: string; subscriptionStatus: string }): boolean {
  // PAST_DUE/CANCELED odemesi aksamis hesaptir; ucretli isi surdurmuyoruz.
  return (PAID_PLAN_TIERS as readonly string[]).includes(row.plan) && row.subscriptionStatus === 'ACTIVE';
}

/**
 * Site secimi + kirpma.
 *
 * Sahip bazinda SIRAYLA (round-robin) diziliyor: bir ajansin 40 sitesi
 * listenin basinda toplanirsa tavan dolar ve tek siteli musteriler hic
 * plan alamaz. Bu sekilde once herkesin ilk sitesi, sonra ikinciler...
 * kirpma da en sonda kalan "cok siteli hesabin kuyrugundan" yenir.
 */
export function selectWeeklyPlanSites(
  rows: WeeklyPlanCandidate[],
  maxSites: number,
): { selected: WeeklyPlanCandidate[]; eligible: number; skipped: number } {
  const eligible = rows.filter(isPaidOwner);

  const byOwner = new Map<string, WeeklyPlanCandidate[]>();
  for (const row of eligible) {
    const list = byOwner.get(row.userId);
    if (list) list.push(row);
    else byOwner.set(row.userId, [row]);
  }

  const ordered: WeeklyPlanCandidate[] = [];
  const queues = [...byOwner.values()];
  let round = 0;
  let added = true;
  while (added) {
    added = false;
    for (const queue of queues) {
      const item = queue[round];
      if (item) {
        ordered.push(item);
        added = true;
      }
    }
    round++;
  }

  const cap = Math.max(0, Math.floor(maxSites));
  const selected = ordered.slice(0, cap);
  return { selected, eligible: eligible.length, skipped: ordered.length - selected.length };
}

/**
 * LLM'in urettigi markdown plani Aksiyon Plani maddelerine cevirir.
 *
 * Yalnizca ARDISIK numarali satirlar madde sayilir (1., 2., 3. ...).
 * "2026. yilda" gibi metin icinde gecen sayilar yanlislikla madde
 * olmasin diye siradaki numara beklenenle eslesmek zorunda.
 */
export function parsePlanItems(
  markdown: string,
  limit = MAX_ITEMS_PER_SITE,
): Array<{ title: string; description: string }> {
  const lines = String(markdown ?? '').split('\n');
  const items: Array<{ title: string; body: string[] }> = [];
  let expected = 1;

  for (const line of lines) {
    const m = /^\s{0,3}(?:#{1,4}\s*)?(\d{1,2})[.)]\s+(.*\S)\s*$/.exec(line);
    if (m && Number(m[1]) === expected) {
      expected++;
      items.push({ title: cleanInline(m[2]), body: [] });
      continue;
    }
    if (items.length > 0) items[items.length - 1].body.push(line);
  }

  const out: Array<{ title: string; description: string }> = [];
  for (const item of items) {
    // ActionPlansService baslik icin en az 3 karakter istiyor
    if (item.title.length < 3) continue;
    out.push({
      title: item.title.length > 300 ? `${item.title.slice(0, 299)}…` : item.title,
      description: item.body.join('\n').trim().slice(0, 5000),
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** Markdown vurgu isaretlerini temizler — baslik duz metin olarak saklanir */
function cleanInline(text: string): string {
  return text
    .replace(/\*\*/g, '')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** ISO hafta etiketi — sourceRef'in tekillik anahtari */
export function isoWeekTag(now: Date): string {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return `${date.getUTCFullYear()}-w${String(week).padStart(2, '0')}`;
}

@Injectable()
export class WeeklyPlanCron {
  private readonly log = new Logger(WeeklyPlanCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chat: ChatService,
    private readonly actionPlans: ActionPlansService,
    private readonly notifications: NotificationsService,
    private readonly email: EmailService,
  ) {}

  /** Pazartesi 06:00 (TR) — hafta baslamadan plan masada olsun */
  @Cron('0 6 * * 1', { timeZone: 'Europe/Istanbul' })
  async weeklyPlans(): Promise<void> {
    if (!isWeeklyPlanCronEnabled()) return;
    // API ve worker ayni AppModule'u bootstrap ediyor — kilit olmazsa her
    // site icin iki kez LLM cagrisi yapilir.
    if (!(await acquireCronLock(this.prisma, 'weekly-plan', 'weekly'))) return;

    await this.run();
  }

  /**
   * Cron govdesi — kilitten ayri tutuldu ki elle/test tetiklemesi
   * kilit semantigini atlamadan cagrilabilsin.
   */
  async run(): Promise<{ produced: number; failed: number; skipped: number }> {
    const maxSites = resolveMaxSites();

    const rows = await this.prisma.site.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        userId: true,
        user: { select: { email: true, name: true, role: true, plan: true, subscriptionStatus: true } },
      },
    });

    const candidates: WeeklyPlanCandidate[] = rows.map((r) => ({
      siteId: r.id,
      siteName: r.name,
      userId: r.userId,
      userEmail: r.user.email,
      userName: r.user.name,
      userRole: r.user.role,
      plan: r.user.plan,
      subscriptionStatus: r.user.subscriptionStatus,
    }));

    const { selected, eligible, skipped } = selectWeeklyPlanSites(candidates, maxSites);
    if (selected.length === 0) {
      this.log.log('Haftalik plan: uygun site yok');
      return { produced: 0, failed: 0, skipped };
    }
    // Sessiz kirpma yok — atlanan siteler goruntulenebilir olmali
    if (skipped > 0) {
      this.log.warn(
        `Haftalik plan: ${eligible} uygun siteden ${selected.length} tanesi islenecek, ` +
        `${skipped} site WEEKLY_PLAN_MAX_SITES=${maxSites} tavani nedeniyle ATLANDI`,
      );
    }

    const weekTag = isoWeekTag(new Date());
    let produced = 0;
    let failed = 0;

    for (let i = 0; i < selected.length; i++) {
      const site = selected[i];
      try {
        await this.produceForSite(site, weekTag);
        produced++;
      } catch (err: any) {
        failed++;
        this.log.error(`Haftalik plan uretilemedi (${site.siteId}): ${err.message}`);
      }
      if (i < selected.length - 1) await sleep(SITE_PAUSE_MS);
    }

    this.log.log(`Haftalik plan: ${produced} site islendi, ${failed} hata, ${skipped} atlandi`);
    return { produced, failed, skipped };
  }

  private async produceForSite(site: WeeklyPlanCandidate, weekTag: string): Promise<void> {
    // Mevcut chat yolu — ayri bir LLM cagrisi yazilmadi ki skill prompt'u,
    // tool seti, token muhasebesi ve konusma kaydi tek yerden yonetilsin.
    const result = await this.chat.sendMessage(
      site.siteId,
      { id: site.userId, role: site.userRole, plan: site.plan },
      { skill: 'weekly-plan' },
    );

    const planText = result.message.content ?? '';
    const parsed = parsePlanItems(planText);

    // Madde cikarilamadiysa plan kaybolmasin: tam metni tek madde olarak sakla
    const items = parsed.length > 0
      ? parsed
      : [{ title: `Haftalık plan (${weekTag})`, description: planText.slice(0, 5000) }];

    for (let n = 0; n < items.length; n++) {
      await this.actionPlans.create(site.siteId, {
        title: items[n].title,
        description: items[n].description,
        source: 'chat',
        sourceRef: `weekly-plan:${weekTag}:${n + 1}`,
        impact: n < 2 ? 'high' : 'medium',
        meta: { skill: 'weekly-plan', conversationId: result.conversationId, week: weekTag },
      });
    }

    const link = `/sites/${site.siteId}/action-plan`;
    await this.notifications.create({
      userId: site.userId,
      type: 'SYSTEM',
      title: `Bu haftanın planı hazır — ${site.siteName}`,
      body: `${items.length} madde Aksiyon Planına eklendi.\n\n${planText.slice(0, 1500)}`,
      link,
      refKind: 'chat_weekly_plan',
      refId: result.conversationId,
      channels: ['inapp'],
    });

    await this.email.send({
      userId: site.userId,
      to: site.userEmail,
      template: 'weekly_plan',
      data: {
        name: site.userName,
        siteName: site.siteName,
        siteId: site.siteId,
        weekTag,
        items: items.map((it) => it.title),
      },
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
