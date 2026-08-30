import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { LINKEDIN_LABELS as L } from './linkedin-selectors.js';
import {
  type BlockResult,
  type MessagedProspect,
  type OutreachLimits,
  type PlannedAction,
  type TickCounters,
  type TickQueue,
  type UnreadConversation,
  acceptRateWindow,
  cardCompanyMatch,
  companySearchUrl,
  currentCompanyFromCard,
  currentTitleFromCard,
  MAX_SEARCH_PAGES,
  searchUrlWithPage,
  cutAtSidebar,
  delayBetweenActionsMs,
  detectBlock,
  extractProfileUrls,
  extractRef,
  findRef,
  firmaKey,
  headlineNamesOtherCompany,
  isAnonymousMember,
  isFounderOrCLevel,
  isWorkWindow,
  looksLikePersonName,
  istanbulDayStart,
  istanbulParts,
  matchUnreadToProspects,
  nameKey,
  normalizeProfileUrl,
  parseDegree,
  parseSearchResults,
  pickCompanyId,
  pickCompanySlug,
  isTargetTitle,
  researchKademe,
  pickTitleFromCard,
  planTick,
  profileReadDelayMs,
  renderMessage,
  renderNote,
  normalizeKampanya,
  normalizePanelAyarlari,
  applyPanelAyarlari,
  AYAR_TAVAN,
  type PanelAyarlari,
  KAMPANYALAR,
  KAMPANYA_ADI,
  NOTE_MAX_CHARS,
  type Kampanya,
  RESEARCH_KEYWORD_QUERIES,
  researchSearchUrls,
  resolveLimits,
  shouldPause,
  urlMatchesTarget,
} from './linkedin-outreach-rules.js';

/**
 * LinkedIn outreach botu — kurumsal kampanyanin paralel kanali (plan Faz 8).
 *
 * NE: Kisisel kurucu hesabindan, sikı frenli, tam otomatik baglanti istegi
 * (300 karakter not) + kabul sonrasi kisa mesaj + cevap takibi. Cevap gelince
 * insan devralir; bot o kisiye bir daha yazmaz.
 *
 * NASIL: x-curation ile ayni `openclaw browser … --json` koprusu. Girdi
 * olaylari GERCEK (snapshot ref → click/type/press), `evaluate` yalnizca
 * OKUMA (derece, sayfa metni, okunmamis konusmalar). LLM YOK — etiketler
 * linkedin-selectors.ts, kurallar linkedin-outreach-rules.ts (saf, testli).
 *
 * DOGRU KISI GARANTISI: ust karttaki Bağlantı kur / Bekliyor / Mesaj
 * dugmeleri YALNIZ erisilebilirlik etiketinde KISININ ADI geciyorsa tiklanir
 * ("Invite Ayşe Kaya to connect"); snapshot ilk yan panel basligindan kesilir
 * ("Diğer kişiler de baktı"). Bu kisi icin dugme yoksa HICBIR SEY tiklanmaz,
 * kayit FAILED + ekran goruntusu.
 *
 * FRENLER (rules'ta sabit; env ile yalniz asagi): gunde <=20 istek / <=15
 * mesaj, haftada <=80 istek, tick basina <=3 islem, islemler arasi 2-6 dk,
 * profilde 8-20 sn okuma, ayni firmadan gunde <=2, hafta ici 09-18 TR.
 * Ardisik 3 basarisiz MUTASYON (istek/mesaj; okuma adimlari sayaci ne
 * sifirlar ne artirir) / limit / captcha / dogrulama / giris duvari /
 * OLGUNLASMIS kabul orani (<%15, 72 sa–14 gun penceresi, >=20 istek) →
 * servis duraklar (KvStore 'linkedin-outreach:paused') + admin bildirimi
 * (uygulama ici + e-posta). Panelden Devam.
 *
 * KABUL EDILEN RISK: otomasyon LinkedIn kosullarina aykiri; hesap
 * kisitlanabilir. Parola tutulmaz — oturum cerezle aktarilir
 * (scripts/oturum-aktar.mjs --site linkedin). Kisisel veri LOG'A BASILMAZ;
 * loglarda yalniz kayit id'si ve sayilar gecer.
 *
 * KURU MOD (dryRun): profili acar, okur, alanlari doldurur, EKRAN GORUNTUSU
 * alir; Gonder'e BASMAZ, sayaclari oynatmaz. Engel gorurse yine duraklatir
 * (gercek sinyal). Calisma penceresi kuru modda da gecerli (force:true ile
 * asilir — test icin). Istisna: Bağlantı kur tiklaninca not modali acilmadan
 * istek gittiyse (LinkedIn bazen dogrudan gonderir) bu GERCEK olay olarak
 * REQUESTED yazilir.
 */

const KV_PAUSED = 'linkedin-outreach:paused';
const KV_FAILS = 'linkedin-outreach:fails';
const KV_LOCK = 'linkedin-outreach:lock';
const KV_RESEARCH = 'linkedin-outreach:research:'; // + YYYY-MM-DD
/** Zaman asiminda tekrarlanabilir (yan etkisiz) tarayici komutlari */
const READ_RETRY_COMMANDS: ReadonlySet<string> = new Set(['navigate', 'open', 'evaluate', 'snapshot', 'tabs', 'screenshot']);
/** Tek istekte gezilecek en fazla arama linki (her biri ~1 dk/sayfa) */
const MAX_RESEARCH_URLS = 12;
/** Link basina varsayilan sonuc sayfasi (LinkedIn sayfa basina ~10 kisi) */
const VARSAYILAN_SAYFA = 5;
/** Panelde gosterilen kayit sayisi (kuyruk 100+ olabiliyor) */
const PANEL_RECENT_TAKE = 500;
/** Panelden ayarlanan gonderim anahtari ('1' acik / '0' kapali); yoksa env bayragi gecerli */
const KV_ENABLED = 'linkedin-outreach:enabled';
/** Panelden ayarlanan frenler ve calisma penceresi (JSON) */
const KV_AYARLAR = 'linkedin-outreach:ayarlar';
const KV_COMPANY = 'linkedin-outreach:company:'; // + firmaKey → sayisal LinkedIn sirket kimligi
const COMPANY_ID_TTL_MS = 90 * 86_400_000;

const DEFAULT_TIMEOUT_MS = 45_000;
/** Sayfa gecisi sonrasi yerlesme suresi */
const SETTLE_MS = 4_000;
/** Modal / menu acilisi sonrasi */
const UI_MS = 1_800;
/**
 * Kilit omru: cron periyodu 30 dk'dan UZUN (45 dk). NEDEN: TTL == periyot
 * olunca 3 islem x 6 dk bekleme + profil okuma ile 30 dk'yi asan tick'in
 * kilidi bayat sayilip ikinci tick ayni tarayicida kosabiliyordu.
 */
const LOCK_TTL_MS = 45 * 60_000;
/** Gercek tick'lerin rastgele atlanma orani — 30 dk sabit cron'a 20-40 dk ritmi verir */
const JITTER_SKIP_RATIO = 0.25;
const MESSAGING_URL = 'https://www.linkedin.com/messaging/';
const MAX_RESEARCH_HITS = 15; // firma basina kuyruga giren aday; fazlasi loglanir (sessiz kesme yok)
const MAX_IMPORT_ROWS = 5_000;
const QUEUE_TAKE = 60;
/** Ardisik hata sayacina giren islemler — okuma adimlari (reply/accept-check, research) DEGIL */
const MUTATING_ACTIONS: ReadonlySet<PlannedAction['type']> = new Set(['request', 'message']);

/** Ekran goruntuleri: apps/api/data/linkedin/<id>-<adim>.png (src ve dist icin ayni yer; .gitignore'da) */
const SCREENSHOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/linkedin');

/** Yalnizca OKUMA: sayfa metni + derece rozeti ipuclari + url/baslik. Engel/derece tespiti TS tarafinda (rules). */
const READ_PAGE_FN = `() => {
  const body = document.body ? (document.body.innerText || '') : '';
  const dist = [...document.querySelectorAll('.dist-value, .distance-badge, [class*="distance-badge"], [class*="dist-value"]')]
    .map((e) => (e.innerText || '').replace(/\\s+/g, ' ').trim()).filter(Boolean).slice(0, 5);
  return { text: body.slice(0, 20000), dist, url: location.href, title: document.title };
}`;
/** Insan gibi rastgele kaydirma (profil okuma) */
const SCROLL_FN = `() => { window.scrollBy(0, Math.round(window.innerHeight * (0.4 + Math.random() * 0.8))); return window.scrollY; }`;
/** Mesaj kutusu: konusma listesi — metin + okunmamis isareti + profil linkleri + son mesaj zamani (varsa) */
const CONVERSATIONS_FN = `() => {
  const sel = '.msg-conversation-listitem, [data-view-name="messaging-conversation-list-item"], a[href*="/messaging/thread/"]';
  let nodes = [...document.querySelectorAll(sel)];
  if (nodes.length === 0) nodes = [...document.querySelectorAll('li')];
  const out = [];
  for (const el of nodes.slice(0, 80)) {
    const text = (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 300);
    if (!text) continue;
    const cls = [el, ...[...el.querySelectorAll('*')].slice(0, 60)].map((e) => String(e.getAttribute('class') || '')).join(' ');
    const unread = /unread/i.test(cls) || /okunmamış|unread/i.test(text) || !!el.querySelector('.notification-badge, .msg-conversation-card__unread-count');
    const links = [...el.querySelectorAll('a[href*="/in/"]')].map((a) => a.href.split('?')[0]).slice(0, 5);
    const t = el.querySelector('time[datetime]');
    const lastAt = t ? String(t.getAttribute('datetime') || '') : null;
    out.push({ text, unread, links, lastAt });
  }
  return out;
}`;
/** Arama sonucu: profil linkleri + kart metni (ad/unvan cikarimi TS tarafinda) */
const SEARCH_LINKS_FN = `() => {
  // NEDEN bu yol: yeni LinkedIn arayuzunde (30.08.2026) kart <li> degil; profil baglantisi kartin tum metnini
  // sariyor ("Ad Soyad\\n• 2.\\nCTO\\n…"). Kart = yalniz BU profilin baglantilarini iceren en ust ata
  // (ortak baglanti linkleri baska profil → orada durur). Ad = ilk satir, derece isareti temizlenir.
  const norm = (h) => { try { const u = new URL(h, location.href); const m = /^\\/in\\/([^/?#]+)/.exec(u.pathname); return m ? 'https://www.linkedin.com/in/' + m[1] : null; } catch { return null; } };
  const byProfile = new Map();
  for (const a of document.querySelectorAll('a[href*="/in/"]')) {
    const u = norm(a.href);
    if (!u) continue;
    let card = a, el = a.parentElement, depth = 0;
    while (el && depth < 10) {
      const others = [...el.querySelectorAll('a[href*="/in/"]')].map((x) => norm(x.href)).filter((x) => x && x !== u);
      if (others.length) break;
      card = el; el = el.parentElement; depth++;
    }
    const lines = (card.innerText || '').split('\\n').map((l) => l.trim()).filter(Boolean).slice(0, 16);
    const prev = byProfile.get(u);
    if (!prev || lines.length > prev.lines.length) byProfile.set(u, { href: u, lines });
    if (byProfile.size >= 120) break;
  }
  return [...byProfile.values()].filter((c) => c.lines.length >= 2).map((c) => {
    const text = (c.lines[0] || '').replace(/\\s*[•·]\\s*[123]\\.?\\+?.*$/u, '').replace(/\\s+\\b(1st|2nd|3rd)\\b.*$/u, '').trim();
    return { href: c.href, text, card: c.lines.join(' ').slice(0, 400), lines: c.lines };
  });
}`;

/** Sirket arama sayfasi: /company/ baglantilari (slug secimi rules.pickCompanySlug) */
const COMPANY_LINKS_FN = `() => [...document.querySelectorAll('a[href*="/company/"]')].slice(0, 40).map((a) => ({ href: a.href.split('?')[0], text: (a.innerText || '').trim().slice(0, 120) }))`;
/** Sirket sayfasi: "Çalışanları gör" baglantilari (currentCompany=["id"]) */
const COMPANY_ID_FN = `() => [...new Set([...document.querySelectorAll('a[href*="currentCompany"]')].map((a) => a.href))].slice(0, 10)`;

interface PageRead {
  text: string;
  dist: string[];
  url: string;
  title: string;
}

export interface TickAction {
  type: PlannedAction['type'];
  prospectId?: string;
  ok: boolean;
  note?: string;
}

export interface TickResult {
  actions: TickAction[];
  paused?: boolean;
  reason?: string;
  /** Rastgele ritim atlamasi (gercek tick; kuru/elle tick'te yok) */
  skipped?: boolean;
}

export interface TickOptions {
  dryRun?: boolean;
  /** Arastirma hedefi firma adlari (verilmezse arastirma yapilmaz) */
  research?: string[];
  /** Kuru modda calisma penceresini asar (test); gercek tick'te ETKISIZ */
  force?: boolean;
  /** %25 rastgele atlama; varsayilan: gercek tick'te acik, kuru tick'te kapali. Panelden elle tick false verir. */
  jitter?: boolean;
  /**
   * Yalniz arastirma: plan research adimlariyla sinirlanir (istek/mesaj YOK) ve calisma
   * penceresi kontrolu atlanir. NEDEN: kuyruk doldurma gonderim degildir; hafta sonu
   * kuyrugu hazirlayip pazartesi 09:00'da gondermeye baslamak icin.
   */
  researchOnly?: boolean;
}

export interface ImportRow {
  /** MUSTERI | YATIRIMCI | ISBIRLIGI — bos ise MUSTERI */
  kampanya?: string;
  ad?: string;
  soyad?: string;
  firma?: string;
  unvan?: string;
  sektor?: string;
  kademe?: number | string;
  profileUrl?: string;
}

/** Limit / captcha / dogrulama / giris duvari — islem degil SERVIS durur */
class BlockError extends Error {
  constructor(public readonly block: BlockResult) {
    super(`Engel: ${block.kind} ("${block.match ?? ''}")`);
  }
}

/** Ust kart dugmelerinde aranacak ad parcalari (translit; findRef include) */
function nameTokens(p: { ad: string; soyad: string }): string[] {
  return [p.ad, p.soyad].map((s) => nameKey(s ?? '')).filter(Boolean);
}

@Injectable()
export class LinkedinOutreachService {
  private readonly log = new Logger(LinkedinOutreachService.name);
  /** Acik sekme (tick suresince tek sekme; navigate ile gezilir) */
  private tab: string | undefined;
  /** Bu surecin kilit belirteci — yalniz kendi kilidini siler */
  private lockToken: string | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * x-curation kalibi: bu botun KENDI bayragi tek basina belirler (varsayilan
   * KAPALI). OPENCLAW_ENABLED LLM'li arama yolunun bayragidir; burada
   * aranmaz — kopru ayni `openclaw` ikilisi, yoksa ilk komutta hata verir.
   */
  /** Env bayragi — panelden ayar yapilmamissa gecerli olan varsayilan */
  get envEnabled(): boolean {
    return process.env.OPENCLAW_LINKEDIN_OUTREACH_ENABLED === '1';
  }

  /**
   * Gonderim acik mi? Once PANEL ayari (KvStore), yoksa env bayragi.
   * NEDEN KvStore: kullanici botu panelden acip kapatabilmeli — sunucuya girip .env
   * duzenlemek ve pm2 restart gerekmesin (30.08 "panelden baslatalim").
   */
  async isEnabled(): Promise<boolean> {
    const row = await this.prisma.kvStore.findUnique({ where: { key: KV_ENABLED } }).catch(() => null);
    if (row?.value === '1') return true;
    if (row?.value === '0') return false;
    return this.envEnabled;
  }

  /**
   * Yururlukteki frenler: kod sabitleri → env (yalniz asagi) → PANEL ayarlari (tavanlarla kirpili).
   * NEDEN async: panel ayarlari KvStore'da (30.08 "saat ayarlarini panelden yapmak istiyorum").
   */
  async getLimits(): Promise<OutreachLimits> {
    const base = resolveLimits();
    const row = await this.prisma.kvStore.findUnique({ where: { key: KV_AYARLAR } }).catch(() => null);
    if (!row?.value) return base;
    try {
      return applyPanelAyarlari(base, normalizePanelAyarlari(JSON.parse(row.value)));
    } catch {
      return base;
    }
  }

  /** Panelden fren/saat ayarlarini kaydet (gecersiz degerler tavana kirpilir) */
  async setAyarlar(input: unknown): Promise<{ ayarlar: PanelAyarlari; limits: OutreachLimits }> {
    // NEDEN birlestirme: panel yalniz degistirilen alanlari gonderiyor; tam degistirme daha once
    // daraltilmis frenleri sessizce varsayilana dondururdu (30.08 denetimi)
    const mevcut = await this.getAyarlar();
    const ayarlar = { ...mevcut, ...normalizePanelAyarlari(input) };
    const value = JSON.stringify(ayarlar);
    await this.prisma.kvStore.upsert({ where: { key: KV_AYARLAR }, create: { key: KV_AYARLAR, value }, update: { value } });
    this.log.warn(`LinkedIn ayarlari guncellendi: ${value}`);
    return { ayarlar, limits: await this.getLimits() };
  }

  /** Panelde gosterilecek kayitli ayarlar (bos = varsayilan) */
  async getAyarlar(): Promise<PanelAyarlari> {
    const row = await this.prisma.kvStore.findUnique({ where: { key: KV_AYARLAR } }).catch(() => null);
    if (!row?.value) return {};
    try { return normalizePanelAyarlari(JSON.parse(row.value)); } catch { return {}; }
  }

  /** Panelden gonderimi ac/kapat (kalici; env'i ezer) */
  async setEnabled(acik: boolean): Promise<{ enabled: boolean; kaynak: 'panel' }> {
    const value = acik ? '1' : '0';
    await this.prisma.kvStore.upsert({ where: { key: KV_ENABLED }, create: { key: KV_ENABLED, value }, update: { value } });
    this.log.warn(`LinkedIn gonderimi panelden ${acik ? 'ACILDI' : 'KAPATILDI'}`);
    if (acik) {
      await this.notifyAdmin(
        'LinkedIn botu açıldı',
        'Bağlantı istekleri hafta içi 09-18 arasında gönderilmeye başlayacak (günde ≤20 istek, ≤15 mesaj). Panelden "Duraklat" ile durdurabilirsiniz.',
      ).catch(() => undefined);
    }
    return { enabled: acik, kaynak: 'panel' };
  }

  // ── Tick ────────────────────────────────────────────────────

  /**
   * Bir tur: duraklatma → ritim (jitter) → saat penceresi → kilit → sayaclar
   * → plan → en fazla 3 islem.
   */
  async tick(opts: TickOptions = {}): Promise<TickResult> {
    const dryRun = !!opts.dryRun;
    if (!(await this.isEnabled())) {
      return { actions: [], reason: 'Kapalı: gönderim panelden (ya da OPENCLAW_LINKEDIN_OUTREACH_ENABLED=1 ile) açılmalı' };
    }
    const pausedReason = await this.pausedReason();
    if (pausedReason !== null) return { actions: [], paused: true, reason: pausedReason };

    // NEDEN: cron sabit 30 dk; %25 atlama ile fiili ritim 30/60 dk karisir (20-40 dk hedefine yakin, kalip yok)
    const jitter = opts.jitter ?? !dryRun;
    if (jitter && Math.random() < JITTER_SKIP_RATIO) {
      return { actions: [], skipped: true, reason: 'Rastgele atlandı (ritim: sabit 30 dk yerine 20-40 dk)' };
    }

    const limits = await this.getLimits();
    const bypassWindow = dryRun && opts.force === true;
    if (!bypassWindow && !isWorkWindow(new Date(), limits) && !opts.researchOnly) {
      return { actions: [], reason: `Çalışma penceresi dışı (hafta içi 09-18 Europe/Istanbul)${dryRun ? ' — kuru tick için force:true' : ''}` };
    }
    const kilit = await this.acquireLock();
    if (!kilit) return { actions: [], reason: 'Başka bir tick çalışıyor' };

    try {
      const { counters, requestsMatured, acceptedMatured } = await this.counters();
      const pre = shouldPause({ consecutiveFails: counters.fails, requestsMatured, acceptedMatured }, limits);
      if (pre.pause) {
        await this.pauseWithNotice(pre.reason!);
        return { actions: [], paused: true, reason: pre.reason };
      }

      const queue = await this.buildQueue(opts.research);
      // yalniz arastirma: istek/mesaj plana girmez (kota arastirmaya kalir)
      const plan = planTick(counters, queue, limits, { researchOnly: opts.researchOnly === true });
      if (plan.length === 0) return { actions: [], reason: 'Yapılacak iş yok' };
      this.log.log(`LinkedIn tick${dryRun ? ' (kuru)' : ''}: ${plan.map((p) => p.type).join(', ')}`);

      const actions: TickAction[] = [];
      try {
        for (let i = 0; i < plan.length; i++) {
          if (i > 0) await sleep(dryRun ? 1_000 : delayBetweenActionsMs());
          const planned = plan[i];
          // NEDEN her adimda yeniden kontrol: tick 17:57'de baslayip islemler arasi 2-6 dk beklerken
          // pencere kapaniyor, 18:09'da hala istek gidiyordu (30.08 denetimi). Okuma adimlari serbest.
          if (!dryRun && MUTATING_ACTIONS.has(planned.type) && !bypassWindow && !isWorkWindow(new Date(), limits)) {
            actions.push({ type: planned.type, prospectId: 'prospectId' in planned ? planned.prospectId : undefined, ok: false, note: 'Çalışma penceresi kapandı — bu işlem yapılmadı' });
            break;
          }
          const prospectId = 'prospectId' in planned ? planned.prospectId : undefined;
          const mutating = MUTATING_ACTIONS.has(planned.type);
          try {
            const res = await this.runAction(planned, dryRun, limits);
            actions.push(res);
            // Sayac YALNIZ basarili mutasyonla sifirlanir — okuma adimi hep "ok" doner, freni bosa cikarmasin
            if (!dryRun && res.ok && mutating) await this.setFails(0);
          } catch (err: any) {
            const msg = String(err?.message ?? err).slice(0, 500);
            await this.screenshot(prospectId ?? planned.type, err instanceof BlockError ? 'engel' : 'hata');
            if (err instanceof BlockError) {
              const reason = `${err.message}${dryRun ? ' (kuru tick)' : ''}`;
              await this.pauseWithNotice(reason);
              // lastError yazilir, status kalir: Devam'dan sonra siraya SONDAN girer (buildQueue), kilitlenme olmaz
              if (prospectId && !dryRun) await this.setError(prospectId, msg, false);
              actions.push({ type: planned.type, prospectId, ok: false, note: msg });
              return { actions, paused: true, reason };
            }
            this.log.warn(`LinkedIn ${planned.type}${prospectId ? ` [${prospectId}]` : ''} hata: ${msg}`);
            actions.push({ type: planned.type, prospectId, ok: false, note: msg });
            if (dryRun) continue;
            if (prospectId) await this.setError(prospectId, msg, true);
            if (!mutating) continue; // okuma adimi hatasi ardisik sayaca girmez
            const fails = await this.bumpFails();
            const sp = shouldPause({ consecutiveFails: fails, requestsMatured, acceptedMatured }, limits);
            if (sp.pause) {
              await this.pauseWithNotice(`${sp.reason} — son hata: ${msg.slice(0, 160)}`);
              return { actions, paused: true, reason: sp.reason };
            }
          }
        }
      } finally {
        await this.closeTab();
      }
      return { actions };
    } finally {
      await this.releaseLock(kilit);
    }
  }

  private async runAction(a: PlannedAction, dryRun: boolean, limits: OutreachLimits): Promise<TickAction> {
    switch (a.type) {
      case 'reply-check': return this.replyCheck(dryRun);
      case 'message': return this.sendMessage(a.prospectId, dryRun);
      case 'accept-check': return this.acceptCheck(a.prospectIds, dryRun);
      case 'request': return this.sendRequest(a.prospectId, dryRun);
      case 'research': return this.research(a.firma, dryRun, limits);
    }
  }

  // ── (1) Istek ───────────────────────────────────────────────

  private async sendRequest(id: string, dryRun: boolean): Promise<TickAction> {
    const p = await this.prisma.linkedinProspect.findUnique({ where: { id } });
    if (!p || p.status !== 'QUEUED') return { type: 'request', prospectId: id, ok: false, note: 'kayıt QUEUED değil' };
    const who = nameTokens(p);
    if (who.length === 0) throw new Error('kayıtta ad yok — üst kart eşlemesi yapılamaz');

    await this.goto(p.profileUrl);
    await this.humanRead(dryRun);
    const page = await this.readPage();
    this.assertNoBlock(page);

    const degree = parseDegree(page.text, page.dist);
    if (degree === 1) {
      if (!dryRun) await this.prisma.linkedinProspect.update({ where: { id }, data: { status: 'ACCEPTED', acceptedAt: new Date(), lastError: null } });
      return { type: 'request', prospectId: id, ok: true, note: 'zaten 1. derece → ACCEPTED' };
    }

    // Ust kart: yan panel kesilir, dugme etiketinde KISININ ADI sart
    let top = cutAtSidebar(await this.snapshot());
    if (this.pendingFor(top, who)) {
      if (!dryRun) await this.prisma.linkedinProspect.update({ where: { id }, data: { status: 'REQUESTED', requestedAt: new Date(), lastError: null } });
      return { type: 'request', prospectId: id, ok: true, note: 'istek zaten bekliyor → REQUESTED' };
    }

    let connect = this.connectFor(top, who);
    if (!connect) {
      // Takip et birincilse "Baglanti kur" Daha fazla menusunde (menu ust kartin icinde acilir)
      const more = findRef(top, L.daha, { role: 'button' });
      if (more) {
        await this.click(more);
        await sleep(UI_MS);
        top = cutAtSidebar(await this.snapshot());
        connect = this.connectFor(top, who);
      }
    }
    if (!connect) {
      // HICBIR SEY tiklanmaz: ilk bulunan "bağlantı kur" yan paneldeki yabanciya ait olabilir
      await this.press('Escape').catch(() => undefined);
      throw new Error('top card connect yok — bu kişi adına "Bağlantı kur" düğmesi bulunamadı (yan panel dışlandı)');
    }
    if (dryRun) {
      // KURU TICK GONDERMEZ: "Bağlantı kur" tiklanirsa LinkedIn bazi profillerde daveti NOTSUZ dogrudan
      // gonderiyor (30.08 denetimi) — panel "GÖNDERMEZ" dedigi halde gercek davet cikardi. Kuru modda
      // dugme yalnizca BULUNUR, tiklanmaz; not metni yine uretilip kanit olarak dondurulur.
      const kuruNot = renderNote(p);
      await this.press('Escape').catch(() => undefined);
      const kuruShot = await this.screenshot(id, 'kuru-hazir');
      return {
        type: 'request',
        prospectId: id,
        ok: true,
        note: `kuru: "Bağlantı kur" bulundu, TIKLANMADI · not (${kuruNot.length}/${NOTE_MAX_CHARS}): ${kuruNot.slice(0, 120)}…${kuruShot ? ` (${path.basename(kuruShot)})` : ''}`,
      };
    }
    await this.click(connect);
    await sleep(UI_MS);

    // Modal DOM sonuna eklenir → kesme YOK
    let snap = await this.snapshot();
    const addNote = findRef(snap, L.notEkle, { role: 'button' }) ?? findRef(snap, L.notEkle);
    if (!addNote) {
      // Modal acilmadi: LinkedIn istegi dogrudan gondermis olabilir → yeniden oku, kisi icin "Bekliyor" varsa REQUESTED (not yok)
      await sleep(UI_MS);
      const again = cutAtSidebar(await this.snapshot());
      if (this.pendingFor(again, who)) {
        const shot = await this.screenshot(id, 'sent-nonote');
        await this.prisma.linkedinProspect.update({
          where: { id },
          data: { status: 'REQUESTED', requestedAt: new Date(), noteText: null, screenshotPath: shot, lastError: null },
        });
        return { type: 'request', prospectId: id, ok: true, note: 'istek not modalı açılmadan gitti → REQUESTED (not yok)' };
      }
      throw new Error('"Not ekle" düğmesi bulunamadı');
    }
    await this.click(addNote);
    await sleep(UI_MS);

    snap = await this.snapshot();
    const textboxExclude = [...L.aramaKutusu, 'Mesaj yaz', 'Write a message'];
    const box = findRef(snap, L.notAlani, { role: 'textbox', exclude: textboxExclude, pick: 'last' })
      ?? findRef(snap, [], { role: 'textbox', exclude: textboxExclude, pick: 'last' });
    if (!box) throw new Error('Not alanı bulunamadı');
    const note = renderNote(p);
    await this.type(box, note);
    await sleep(800);
    let shot = await this.screenshot(id, 'note');

    snap = await this.snapshot();
    const send = findRef(snap, L.gonder, { role: 'button', exact: true }) ?? findRef(snap, L.gonder, { role: 'button' });
    if (!send) throw new Error('"Gönder" düğmesi bulunamadı');
    await this.click(send);
    // NEDEN once DB: "Gönder"e basildiktan sonra okuma/ekran goruntusu patlarsa davet YINE DE gitmis olur;
    // once REQUESTED yazilmazsa gunluk/haftalik kota bu daveti saymaz ve kisi kuyrukta kalip TEKRAR davet alir
    // (30.08 denetimi). Kayit hemen yazilir, kanit alanlari sonra tamamlanir.
    await this.prisma.linkedinProspect.update({
      where: { id },
      data: { status: 'REQUESTED', requestedAt: new Date(), noteText: note, screenshotPath: shot, lastError: null },
    });
    await sleep(2_500);
    const after = await this.readPage();
    this.assertNoBlock(after); // haftalik limit uyarisi gonderim ANINDA cikar (tum metinde aranir)
    shot = (await this.screenshot(id, 'sent')) ?? shot;
    await this.prisma.linkedinProspect.update({ where: { id }, data: { screenshotPath: shot } }).catch(() => undefined);
    return { type: 'request', prospectId: id, ok: true, note: 'istek gönderildi' };
  }

  /** "Bekliyor"/"Pending, click to withdraw invitation sent to X" — kisinin adiyla (exact YOK) */
  private pendingFor(topSnapshot: string, who: string[]): string | null {
    return findRef(topSnapshot, L.bekliyor, { role: 'button', include: who });
  }

  /** Bu kisi icin "Bağlantı kur" — dugme ya da menu ogesi; etikette ad sart */
  private connectFor(topSnapshot: string, who: string[]): string | null {
    return findRef(topSnapshot, L.baglantiKur, { role: 'button', include: who })
      ?? findRef(topSnapshot, L.baglantiKur, { role: 'menuitem', include: who });
  }

  // ── (2) Kabul kontrolu ──────────────────────────────────────

  private async acceptCheck(ids: string[], dryRun: boolean): Promise<TickAction> {
    let checked = 0;
    let accepted = 0;
    for (const id of ids) {
      const p = await this.prisma.linkedinProspect.findUnique({ where: { id } });
      if (!p || p.status !== 'REQUESTED') continue;
      await this.goto(p.profileUrl);
      await sleep(dryRun ? 1_500 : 2_000 + Math.round(Math.random() * 2_000));
      const page = await this.readPage();
      this.assertNoBlock(page);
      checked++;
      const shot = await this.screenshot(id, 'accept-check');
      if (parseDegree(page.text, page.dist) === 1) {
        accepted++;
        if (!dryRun) {
          await this.prisma.linkedinProspect.update({
            where: { id },
            data: { status: 'ACCEPTED', acceptedAt: new Date(), lastError: null, ...(shot ? { screenshotPath: shot } : {}) },
          });
        }
      }
    }
    return { type: 'accept-check', ok: true, note: `${checked} profil bakıldı, ${accepted} kabul${dryRun ? ' (kuru)' : ''}` };
  }

  // ── (3) Mesaj ───────────────────────────────────────────────

  private async sendMessage(id: string, dryRun: boolean): Promise<TickAction> {
    const p = await this.prisma.linkedinProspect.findUnique({ where: { id } });
    if (!p || p.status !== 'ACCEPTED') return { type: 'message', prospectId: id, ok: false, note: 'kayıt ACCEPTED değil' };
    const who = nameTokens(p);
    if (who.length === 0) throw new Error('kayıtta ad yok — üst kart eşlemesi yapılamaz');

    await this.goto(p.profileUrl);
    await this.humanRead(dryRun);
    const page = await this.readPage();
    this.assertNoBlock(page);

    // Yalniz DUGME, etikette kisinin adi ("Message Ayşe Kaya" / "Ayşe Kaya adlı kişiye mesaj gönder");
    // link fallback YOK — nav'daki "Mesajlaşma" linki yakalaniyordu
    let snap = await this.snapshot();
    const msgBtn = findRef(cutAtSidebar(snap), L.mesaj, { role: 'button', include: who });
    if (!msgBtn) throw new Error('bu kişi adına "Mesaj" düğmesi bulunamadı (1. derece değil mi?)');
    await this.click(msgBtn);
    await sleep(UI_MS + 800);

    // Mesaj kutusu: tiklanan dugmeden SONRA gelen textbox; arama kutulari her durumda dislanir
    snap = await this.snapshot();
    let box = findRef(snap, L.mesajKutusu, { role: 'textbox', after: msgBtn, exclude: L.aramaKutusu, pick: 'last' })
      ?? findRef(snap, [], { role: 'textbox', after: msgBtn, exclude: L.aramaKutusu, pick: 'last' });
    if (!box && !snapshotHasRef(snap, msgBtn)) {
      // Dugme ref'i yeni snapshot'ta yok (ref'ler yenilendi): yalniz ACIK ETIKETLI yazma kutusu ve alici adi gorunuyorsa
      const recipientShown = findRef(snap, [], { include: who }) !== null;
      if (recipientShown) box = findRef(snap, ['Mesaj yaz', 'Write a message'], { role: 'textbox', exclude: L.aramaKutusu, pick: 'last' });
    }
    if (!box) throw new Error('Mesaj kutusu bulunamadı (düğmeden sonra etiketli textbox yok)');

    const message = renderMessage(p);
    // Enter mesaji GONDERIR — satir sonlari Shift+Enter ile
    const lines = message.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]) await this.type(box, lines[i]);
      if (i < lines.length - 1) await this.press('Shift+Enter');
    }
    await sleep(800);
    let shot = await this.screenshot(id, 'message');

    if (dryRun) {
      // Taslak kalmasin: tumunu sec + sil, sonra kapat
      await this.press('Control+a').catch(() => undefined);
      await this.press('Backspace').catch(() => undefined);
      await this.press('Escape').catch(() => undefined);
      return { type: 'message', prospectId: id, ok: true, note: `kuru: mesaj dolduruldu, GÖNDERİLMEDİ${shot ? ` (${path.basename(shot)})` : ''}` };
    }

    snap = await this.snapshot();
    const send = findRef(snap, L.gonder, { role: 'button', exact: true, after: box }) ?? findRef(snap, L.gonder, { role: 'button', after: box })
      ?? findRef(snap, L.gonder, { role: 'button', exact: true, pick: 'last' });
    if (!send) throw new Error('"Gönder" düğmesi bulunamadı');
    await this.click(send);
    await sleep(2_000);
    shot = (await this.screenshot(id, 'sent-message')) ?? shot;

    await this.prisma.linkedinProspect.update({
      where: { id },
      data: { status: 'MESSAGED', messagedAt: new Date(), messageText: message, screenshotPath: shot, lastError: null },
    });
    return { type: 'message', prospectId: id, ok: true, note: 'mesaj gönderildi' };
  }

  // ── (4) Cevap kontrolu ──────────────────────────────────────

  private async replyCheck(dryRun: boolean): Promise<TickAction> {
    await this.goto(MESSAGING_URL);
    await sleep(SETTLE_MS + 1_000);
    const page = await this.readPage();
    this.assertNoBlock(page);
    const res = await this.browser<{ result?: UnreadConversation[] }>(['evaluate', '--fn', CONVERSATIONS_FN]);
    const convs = Array.isArray(res?.result) ? res!.result! : [];
    await this.screenshot('inbox', istanbulParts(new Date()).ymd);

    const messaged: MessagedProspect[] = await this.prisma.linkedinProspect.findMany({
      where: { status: 'MESSAGED' },
      select: { id: true, ad: true, soyad: true, firma: true, profileUrl: true, messagedAt: true },
    });
    const { replied, ambiguous } = matchUnreadToProspects(convs, messaged);
    const unreadN = convs.filter((c) => c.unread).length;
    if (dryRun) return { type: 'reply-check', ok: true, note: `kuru: ${unreadN} okunmamış, ${replied.length} cevap, ${ambiguous.length} belirsiz` };

    for (const id of replied) {
      const p = messaged.find((m) => m.id === id)!;
      await this.prisma.linkedinProspect.update({ where: { id }, data: { status: 'REPLIED', repliedAt: new Date(), lastError: null } });
      await this.notifyAdmin(
        `LinkedIn cevabı: ${p.ad} ${p.soyad}, ${p.firma ?? ''}`.trim(),
        'Mesajınıza cevap geldi. Bot bu kişiye bir daha yazmaz — konuşmayı siz sürdürün; ret istiyorsa panelden "Atla".',
      );
    }
    // Adas: REPLIED YAPILMAZ, kayda not + tek bildirim (insan mesaj kutusuna bakar)
    for (const id of ambiguous) {
      await this.setError(id, 'Cevap olabilir: aynı ad-soyadlı birden çok MESSAGED kayıt, firma/profil ile ayrılamadı — mesaj kutusuna elle bakın', false);
    }
    if (ambiguous.length > 0) {
      await this.notifyAdmin(
        `LinkedIn: ${ambiguous.length} belirsiz cevap eşleşmesi`,
        'Aynı ad-soyadlı birden çok kayıt var; hangisinin cevap verdiği anlaşılamadı. Mesaj kutusuna bakıp panelden ilgili kaydı işaretleyin (Atla / elle).',
      );
    }
    return { type: 'reply-check', ok: true, note: `${unreadN} okunmamış, ${replied.length} cevap → REPLIED${ambiguous.length ? `, ${ambiguous.length} belirsiz (not düşüldü)` : ''}` };
  }

  // ── (0) Arastirma ───────────────────────────────────────────

  /**
   * LinkedIn sayisal sirket kimligi (currentCompany facet'i icin). KvStore'da 90 gun onbellek.
   * Akis: sirket aramasi → slug (rules.pickCompanySlug) → sirket sayfasi → "Çalışanları gör"
   * baglantisindan kimlik (rules.pickCompanyId). Bulunamazsa null → anahtar kelime yedegi.
   */
  private async resolveCompanyId(firma: string): Promise<string | null> {
    const key = KV_COMPANY + firmaKey(firma);
    const cached = await this.prisma.kvStore.findUnique({ where: { key } }).catch(() => null);
    if (cached?.value && (!cached.expiresAt || cached.expiresAt > new Date())) return cached.value;

    await this.goto(companySearchUrl(firma));
    await sleep(SETTLE_MS);
    this.assertNoBlock(await this.readPage());
    const links = await this.browser<{ result?: Array<{ href: string; text: string }> }>(['evaluate', '--fn', COMPANY_LINKS_FN]);
    const slug = pickCompanySlug(links?.result ?? [], firma);
    if (!slug) { this.log.debug(`sirket kimligi: "${firma}" icin sirket sayfasi bulunamadi`); return null; }

    await this.goto(`https://www.linkedin.com/company/${encodeURIComponent(slug)}/`);
    await sleep(SETTLE_MS);
    this.assertNoBlock(await this.readPage());
    const hrefs = await this.browser<{ result?: string[] }>(['evaluate', '--fn', COMPANY_ID_FN]);
    const id = pickCompanyId(hrefs?.result ?? []);
    if (!id) { this.log.debug(`sirket kimligi: "${firma}" (/company/${slug}/) sayfasinda calisan baglantisi yok`); return null; }
    await this.prisma.kvStore.upsert({
      where: { key },
      create: { key, value: id, expiresAt: new Date(Date.now() + COMPANY_ID_TTL_MS) },
      update: { value: id, expiresAt: new Date(Date.now() + COMPANY_ID_TTL_MS) },
    }).catch(() => undefined);
    this.log.log(`sirket kimligi: "${firma}" → /company/${slug}/ (${id})`);
    return id;
  }

  private async research(firma: string, dryRun: boolean, limits: OutreachLimits, kampanya: Kampanya = 'MUSTERI'): Promise<TickAction> {
    const companyId = await this.resolveCompanyId(firma).catch((err: any) => {
      if (err instanceof BlockError) throw err;
      this.log.warn(`sirket kimligi cozumlenemedi ("${firma}"): ${err?.message ?? err} — anahtar kelime yedegi`);
      return null;
    });
    const facet = Boolean(companyId);
    const hits: Array<{ ad: string; soyad: string; unvan: string; profileUrl: string }> = [];
    const seen = new Set<string>();
    let elenen = 0;
    let firmaDisi = 0;
    let linkN = 0;

    // NEDEN erken cikis yok: her terim ayri arama (kullanici karari); C-level terimleri kotayi doldursa da
    // pazarlama terimleri de gezilir, siralama/kesme en sonda yapilir
    for (const url of researchSearchUrls(firma, companyId)) {
      await this.goto(url);
      await sleep(SETTLE_MS + 1_000);
      const page = await this.readPage();
      this.assertNoBlock(page);

      // Once deterministik DOM okuma; bos donerse snapshot metni (regex)
      const links = await this.browser<{ result?: Array<{ href: string; text: string; card: string; lines?: string[] }> }>(['evaluate', '--fn', SEARCH_LINKS_FN]);
      linkN += links?.result?.length ?? 0;
      for (const l of links?.result ?? []) {
        const u = normalizeProfileUrl(l.href);
        if (!u || seen.has(u)) continue;
        const name = l.text.trim();
        if (isAnonymousMember(name) || !looksLikePersonName(name)) continue;
        if (!/^[\p{Lu}][\p{L}.'-]+(?:\s+[\p{Lu}][\p{L}.'-]+)+$/u.test(name)) continue;
        const parts = name.split(/\s+/);
        const lines = l.lines ?? l.card.split(/\s{2,}|·/);
        // NEDEN: "Mevcut: Papara şirketinde Director of Growth" satiri gercek pozisyon unvanidir; baslik
        // ("Growth") kisa/serbest olabilir → kademe icin Mevcut unvani tercih edilir
        const unvan = currentTitleFromCard(lines) || pickTitleFromCard(lines, name);
        seen.add(u);
        // NEDEN filtre: arama muhendis/QA/IK dahil herkesi getirir; yalniz hedef unvanlar (C-level/kurucu/pazarlama)
        if (!isTargetTitle(unvan)) { elenen++; continue; }
        // NEDEN firma filtresi (yedek modda): anahtar kelime firmayi her yerde bulur ("Geçmiş: Papara …", yetenekler);
        // kart su anki firmayi gostermiyorsa aday degil. Facet modunda currentCompany zaten bunu garanti eder.
        const cm = cardCompanyMatch(lines, firma, unvan);
        if (!facet) {
          if (cm === 'past' || cm === 'none') { firmaDisi++; continue; }
        } else if (cm === 'none' && headlineNamesOtherCompany(unvan, firma)) {
          // Facet: kayit firmada ama baslik baska sirketteki asil rolu anlatiyor ("Co-Founder at Finfree Co")
          firmaDisi++; continue;
        } else if (cm !== 'current' && cm !== 'headline' && isFounderOrCLevel(unvan)) {
          // Facet: "Co-Founder" / "CEO" basligi ama kartta firma kaniti yok → buyuk ihtimalle yan girisim
          // (Migros'ta 3 "Co-Founder", 30.08). Gercek CEO/kurucuda "Mevcut: <firma> şirketinde CEO" satiri cikar.
          firmaDisi++; continue;
        }
        hits.push({ ad: parts.slice(0, -1).join(' '), soyad: parts[parts.length - 1], unvan: unvan.slice(0, 160), profileUrl: u });
      }
      if (hits.length === 0 && (links?.result?.length ?? 0) === 0) {
        const snap = await this.snapshot(['--urls']);
        // Snapshot yolunda kart satiri yok → firma yalniz basliktan dogrulanabilir ('headline'); facet modunda gerekmez
        for (const h of parseSearchResults(snap).filter((x) => isTargetTitle(x.unvan) && (facet || cardCompanyMatch([], firma, x.unvan) === 'headline')).slice(0, MAX_RESEARCH_HITS)) if (!seen.has(h.profileUrl)) { seen.add(h.profileUrl); hits.push(h); }
        if (hits.length === 0) {
          // Kisisel veri loga basilmaz: yalniz sayi
          const nameless = extractProfileUrls(snap).length;
          if (nameless > 0) this.log.debug(`arastirma: ${nameless} isimsiz profil URL'si atlandi`);
        }
      }
    }
    // NEDEN siralama: sayfa sirasi rastgele; karar vericiler (kademe 1) kotaya once girsin
    hits.sort((a, b) => researchKademe(a.unvan) - researchKademe(b.unvan));
    const kesilen = Math.max(0, hits.length - MAX_RESEARCH_HITS);
    hits.splice(MAX_RESEARCH_HITS);
    this.log.log(`arastirma "${firma}" (${facet ? `facet ${companyId}` : 'anahtar kelime yedegi'}, ${RESEARCH_KEYWORD_QUERIES.length} ayri arama): ${linkN} link, ${elenen} unvan disi, ${firmaDisi} firma disi, ${hits.length} aday${kesilen ? `, ${kesilen} aday kota (${MAX_RESEARCH_HITS}) disinda kaldi` : ''}`);
    await this.screenshot('research', firmaKey(firma).replace(/\s+/g, '-').slice(0, 40) || 'firma');

    if (dryRun) return { type: 'research', ok: true, note: `kuru: "${firma}" → ${hits.length} aday (yazılmadı)` };

    let created = 0;
    for (const h of hits) {
      try {
        await this.prisma.linkedinProspect.create({
          data: { ad: h.ad, soyad: h.soyad, firma, unvan: h.unvan || null, sektor: null, kademe: researchKademe(h.unvan), profileUrl: h.profileUrl, status: 'QUEUED', kampanya },
        });
        created++;
      } catch {
        // profileUrl zaten var — atla
      }
    }
    await this.bumpResearch(limits);
    return { type: 'research', ok: true, note: `"${firma}" → ${hits.length} aday, ${created} yeni QUEUED` };
  }

  /**
   * Kullanicinin verdigi LinkedIn KISI ARAMA linklerini gezip aday yazar (gonderim YOK).
   * NEDEN: firma adiyla otomatik arama her zaman istenen kitleyi getirmiyor; kullanici kendi
   * filtresini (unvan, konum, sektor, baglanti derecesi) LinkedIn'de kurup linki yapistiriyor.
   * Firma bilgisi kartin "Mevcut:" satirindan cikarilir; cikmayan aday KAYDEDILMEZ (firma zorunlu).
   */
  async researchUrls(
    urls: string[],
    opts: { kampanya?: Kampanya | string; sektor?: string | null; dryRun?: boolean; sayfa?: number } = {},
  ): Promise<{ ok: boolean; reason?: string; sonuclar: Array<{ url: string; sayfa?: number; aday: number; yeni: number; elenen: number; firmasiz: number; hata?: string }> }> {
    // NEDEN enabled kontrolu YOK: OPENCLAW_LINKEDIN_OUTREACH_ENABLED "gonderim izni" bayragidir; link
    // taramasi yalniz okur ve kuyruga yazar, LinkedIn'e istek/mesaj gondermez. Bayrak kapaliyken de
    // kuyruk hazirlanabilmeli (30.08: panelden verilen link sessizce "bot kapali" ile dondu).
    if (process.env.OPENCLAW_ENABLED === '0') return { ok: false, reason: 'OpenClaw kapalı (OPENCLAW_ENABLED=0)', sonuclar: [] };
    const paused = await this.pausedReason();
    if (paused !== null) return { ok: false, reason: `Servis duraklatıldı: ${paused}`, sonuclar: [] };
    const temiz = urls.map((u) => String(u ?? '').trim()).filter(Boolean).slice(0, MAX_RESEARCH_URLS);
    if (temiz.length === 0) return { ok: false, reason: 'Geçerli arama linki yok', sonuclar: [] };

    const kampanya = normalizeKampanya(opts.kampanya);
    const sektor = (opts.sektor ?? '').trim() || null;
    const dryRun = opts.dryRun === true;
    // Kac sonuc sayfasi gezilecek (LinkedIn sayfa basina ~10 kisi gosterir)
    const sayfaSayisi = Math.max(1, Math.min(MAX_SEARCH_PAGES, Math.floor(Number(opts.sayfa) || VARSAYILAN_SAYFA)));
    const kilit = await this.acquireLock();
    if (!kilit) return { ok: false, reason: 'Başka bir tick çalışıyor', sonuclar: [] };
    const sonuclar: Array<{ url: string; sayfa?: number; aday: number; yeni: number; elenen: number; firmasiz: number; hata?: string }> = [];
    try {
      const limits = await this.getLimits();
      dis: for (const url of temiz) {
        for (let sayfa = 1; sayfa <= sayfaSayisi; sayfa++) {
          const sayfaUrl = searchUrlWithPage(url, sayfa);
          // Kilit hala bizde mi? Degilse baskasi (cron tick) devraldi → ayni tarayicida cakismayalim
          if (!(await this.renewLock(kilit))) {
            sonuclar.push({ url, sayfa, aday: 0, yeni: 0, elenen: 0, firmasiz: 0, hata: 'Kilit devredildi — tarama durduruldu' });
            break dis;
          }
          // Gunluk tarama freni: sayfa basina uygulanir (bumpResearch tavana oturunca durur)
          if ((await this.researchCountToday()) >= limits.MAX_RESEARCH_PER_DAY) {
            sonuclar.push({ url, sayfa, aday: 0, yeni: 0, elenen: 0, firmasiz: 0, hata: `Günlük tarama sınırı (${limits.MAX_RESEARCH_PER_DAY}) doldu` });
            break dis;
          }
          try {
            const r = await this.researchOneUrl(sayfaUrl, { kampanya, sektor, dryRun });
            sonuclar.push({ ...r, url, sayfa });
            await this.bumpResearch(limits);
            // NEDEN erken cikis: sonuc kalmadiysa (bos sayfa) sonraki sayfalar da bostur
            if (r.kart === 0) break;
          } catch (err: any) {
            const msg = String(err?.message ?? err).slice(0, 300);
            sonuclar.push({ url, sayfa, aday: 0, yeni: 0, elenen: 0, firmasiz: 0, hata: msg });
            if (err instanceof BlockError) {
              await this.pauseWithNotice(err.message);
              break dis;
            }
            break; // bu linkte sonraki sayfalari deneme
          }
          // Sayfalar arasi insan ritmi
          await sleep(dryRun ? 800 : Math.round(delayBetweenActionsMs() / 3));
        }
        await sleep(dryRun ? 1_000 : delayBetweenActionsMs());
      }
    } finally {
      await this.closeTab().catch(() => undefined);
      await this.releaseLock(kilit);
    }
    return { ok: true, sonuclar };
  }

  /** Tek arama sayfasi: kartlari oku → hedef unvan + firma filtresi → QUEUED yaz */
  private async researchOneUrl(
    url: string,
    opts: { kampanya: Kampanya; sektor: string | null; dryRun: boolean },
  ): Promise<{ url: string; aday: number; yeni: number; elenen: number; firmasiz: number; kart: number }> {
    await this.goto(url);
    await sleep(SETTLE_MS + 1_000);
    this.assertNoBlock(await this.readPage());

    const links = await this.browser<{ result?: Array<{ href: string; text: string; card: string; lines?: string[] }> }>(['evaluate', '--fn', SEARCH_LINKS_FN]);
    const seen = new Set<string>();
    const hits: Array<{ ad: string; soyad: string; unvan: string; firma: string; profileUrl: string }> = [];
    let elenen = 0;
    let firmasiz = 0;
    for (const l of links?.result ?? []) {
      const u = normalizeProfileUrl(l.href);
      if (!u || seen.has(u)) continue;
      const name = l.text.trim();
      if (isAnonymousMember(name) || !looksLikePersonName(name)) continue;
      if (!/^[\p{Lu}][\p{L}.'-]+(?:\s+[\p{Lu}][\p{L}.'-]+)+$/u.test(name)) continue;
      seen.add(u);
      const lines = l.lines ?? l.card.split(/\s{2,}|·/);
      const unvan = currentTitleFromCard(lines) || pickTitleFromCard(lines, name);
      if (!isTargetTitle(unvan)) { elenen++; continue; }
      // Firma karttan: kullanicinin linki firma facet'i icermeyebilir (ör. keywords=CEO)
      const firma = currentCompanyFromCard(lines, unvan);
      if (!firma) { firmasiz++; continue; }
      const parts = name.split(/\s+/);
      hits.push({ ad: parts.slice(0, -1).join(' '), soyad: parts[parts.length - 1], unvan: unvan.slice(0, 160), firma, profileUrl: u });
    }
    const kart = links?.result?.length ?? 0;
    hits.sort((a, b) => researchKademe(a.unvan) - researchKademe(b.unvan));
    this.log.log(`arastirma (link): ${kart} kart, ${elenen} unvan disi, ${firmasiz} firmasiz, ${hits.length} aday`);
    await this.screenshot('research-url', String(seen.size));

    let yeni = 0;
    if (!opts.dryRun) {
      for (const h of hits) {
        try {
          await this.prisma.linkedinProspect.create({
            data: {
              ad: h.ad, soyad: h.soyad, firma: h.firma, unvan: h.unvan || null, sektor: opts.sektor,
              kademe: researchKademe(h.unvan), profileUrl: h.profileUrl, status: 'QUEUED', kampanya: opts.kampanya,
            },
          });
          yeni++;
        } catch {
          // profileUrl zaten var — atla
        }
      }
    }
    return { url, aday: hits.length, yeni, elenen, firmasiz, kart };
  }

  /**
   * Panelde gosterilecek sablon onizlemesi: her kampanya icin ornek kisiyle uretilmis
   * baglanti notu + mesaj. NEDEN: kullanici kampanyayi secerken ne gonderilecegini
   * gormeden karar veremiyordu (30.08 "mesaj sablonlari nerede?").
   */
  sablonOnizleme(ornek?: { ad?: string; soyad?: string; firma?: string; sektor?: string | null }) {
    const p = {
      ad: ornek?.ad?.trim() || 'Ayşe',
      soyad: ornek?.soyad?.trim() || 'Demir',
      firma: ornek?.firma?.trim() || 'Örnek Şirket',
      sektor: ornek?.sektor ?? null,
    };
    return KAMPANYALAR.map((k) => {
      const not = renderNote({ ...p, kampanya: k });
      return {
        kampanya: k,
        ad: KAMPANYA_ADI[k],
        not,
        notUzunluk: not.length,
        notSinir: NOTE_MAX_CHARS,
        mesaj: renderMessage({ ...p, kampanya: k }),
        // Panelde vurgulamak icin: metindeki hangi parcalar kisiye gore degisiyor
        ornek: { kisi: `${p.ad} ${p.soyad}`, firma: p.firma },
      };
    });
  }

  /** Toplu kampanya degistirme (panelden secim) — yalniz henuz istek gitmemis kayitlar */
  async setKampanya(ids: string[], kampanya?: string | null): Promise<{ updated: number }> {
    const k = normalizeKampanya(kampanya);
    // NEDEN yalniz QUEUED: istek/mesaj gonderilmis kisinin sablonu degistirilirse kanit metniyle celisir
    const r = await this.prisma.linkedinProspect.updateMany({ where: { id: { in: ids }, status: 'QUEUED' }, data: { kampanya: k } });
    return { updated: r.count };
  }

  // ── Panel / API ─────────────────────────────────────────────

  async overview() {
    const limits = await this.getLimits();
    const now = new Date();
    const dayStart = istanbulDayStart(now);
    const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
    const win = acceptRateWindow(now);
    const [requestsToday, messagesToday, requestsWeek, queued, requestsMatured, acceptedMatured, recent, byStatus, byFirmaRaw, pausedReason, enabled, ayarlar, ilkKuyruk] = await Promise.all([
      this.prisma.linkedinProspect.count({ where: { requestedAt: { gte: dayStart } } }),
      this.prisma.linkedinProspect.count({ where: { messagedAt: { gte: dayStart } } }),
      this.prisma.linkedinProspect.count({ where: { requestedAt: { gte: weekAgo } } }),
      this.prisma.linkedinProspect.count({ where: { status: 'QUEUED' } }),
      this.prisma.linkedinProspect.count({ where: { requestedAt: { gte: win.from, lte: win.to } } }),
      this.prisma.linkedinProspect.count({ where: { requestedAt: { gte: win.from, lte: win.to }, acceptedAt: { not: null } } }),
      // NEDEN 500: panel 50 kayitla kesiliyordu, kuyruktaki 100+ adayin cogu gorunmuyordu (30.08 kullanici bildirimi)
      this.prisma.linkedinProspect.findMany({ orderBy: [{ status: 'asc' }, { firma: 'asc' }, { kademe: 'asc' }, { updatedAt: 'desc' }], take: PANEL_RECENT_TAKE }),
      this.prisma.linkedinProspect.groupBy({ by: ['status'], _count: true }),
      this.prisma.linkedinProspect.groupBy({ by: ['firma', 'status'], _count: true }),
      this.pausedReason(),
      this.isEnabled(),
      this.getAyarlar(),
      this.prisma.linkedinProspect.findFirst({
        where: { status: 'QUEUED' },
        orderBy: { createdAt: 'asc' },
        select: { ad: true, soyad: true, firma: true, sektor: true },
      }).catch(() => null),
    ]);
    return {
      enabled,
      /** Bayrak nereden geliyor: panel ayari mi env mi (panelde gosterilir) */
      enabledSource: enabled === this.envEnabled ? 'env' : 'panel',
      paused: pausedReason !== null,
      pauseReason: pausedReason ?? undefined,
      workWindow: isWorkWindow(now, limits),
      today: { requests: requestsToday, messages: messagesToday },
      week: { requests: requestsWeek },
      queued,
      // Alan adi panel sozlesmesi icin sabit; deger OLGUN pencere orani (72 sa–14 gun), 20 istek altinda null
      acceptRate7d: requestsMatured >= limits.ACCEPT_RATE_MIN_REQUESTS ? acceptedMatured / requestsMatured : null,
      acceptRateWindow: 'matured-72h-14d' as const,
      acceptRateBase: { requests: requestsMatured, accepted: acceptedMatured, minRequests: limits.ACCEPT_RATE_MIN_REQUESTS },
      byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count])),
      // Kampanya sablonlari (panelde onizleme) — KUYRUKTAKI ILK kisiyle uretilir (yoksa ornek kisi).
      // NEDEN gercek kayit: panelde sabit "Ayşe Demir" gorunce "sablonda isim degisiyor mu?" sorusu
      // dogdu (30.08); gercek adla gostermek soruyu ortadan kaldiriyor.
      sablonlar: this.sablonOnizleme(ilkKuyruk ?? undefined),
      // Panelden degistirilebilen ayarlar ve guvenlik tavanlari
      ayarlar,
      ayarTavan: AYAR_TAVAN,
      // Firma bazli dagilim (panel ozet seridi): { firma, toplam, kuyrukta }
      byFirma: Object.values(
        byFirmaRaw.reduce<Record<string, { firma: string; toplam: number; kuyrukta: number }>>((acc, r) => {
          const k = r.firma;
          acc[k] ??= { firma: k, toplam: 0, kuyrukta: 0 };
          acc[k].toplam += r._count;
          if (r.status === 'QUEUED') acc[k].kuyrukta += r._count;
          return acc;
        }, {}),
      ).sort((a, b) => b.kuyrukta - a.kuyrukta || a.firma.localeCompare(b.firma, 'tr')),
      recentTotal: Object.values(Object.fromEntries(byStatus.map((s) => [s.status, s._count as number]))).reduce((a: number, b: number) => a + b, 0),
      limits,
      recent,
    };
  }

  /** profileUrl tekil; ayni URL guncellenir (status'a DOKUNULMAZ), kopya olusmaz */
  async importRows(rows: ImportRow[]): Promise<{ upserted: number; skipped: number }> {
    let upserted = 0;
    let skipped = 0;
    for (const r of (rows ?? []).slice(0, MAX_IMPORT_ROWS)) {
      const profileUrl = normalizeProfileUrl(r.profileUrl);
      const ad = (r.ad ?? '').trim().slice(0, 80);
      const soyad = (r.soyad ?? '').trim().slice(0, 80);
      const firma = (r.firma ?? '').trim().slice(0, 160);
      if (!profileUrl || !ad || !firma) { skipped++; continue; }
      const kademeN = Number(r.kademe);
      const unvan = (r.unvan ?? '').trim().slice(0, 160) || null;
      const sektor = (r.sektor ?? '').trim().toLocaleLowerCase('tr').slice(0, 64) || null;
      const kampanya = normalizeKampanya((r as { kampanya?: string }).kampanya);
      const data = { ad, soyad, firma, unvan, sektor, kademe: kademeN === 2 ? 2 : 1, kampanya };
      // NEDEN update'te bos alanlar atlanir: sutunu olmayan bir CSV yeniden aktarilinca mevcut
      // kaydin unvan/sektor bilgisi siliniyordu (30.08 denetimi)
      const update: Record<string, unknown> = { ad, soyad, firma, kademe: data.kademe };
      if (unvan) update.unvan = unvan;
      if (sektor) update.sektor = sektor;
      if ((r as { kampanya?: string }).kampanya) update.kampanya = kampanya;
      await this.prisma.linkedinProspect.upsert({
        where: { profileUrl },
        create: { ...data, profileUrl },
        update,
      });
      upserted++;
    }
    return { upserted, skipped };
  }

  async pause(reason?: string): Promise<{ ok: true }> {
    await this.setPaused((reason ?? '').trim() || 'Elle duraklatıldı');
    return { ok: true };
  }

  async resume(): Promise<{ ok: true }> {
    await this.prisma.kvStore.deleteMany({ where: { key: KV_PAUSED } });
    await this.setFails(0);
    this.log.log('LinkedIn outreach devam ettirildi');
    return { ok: true };
  }

  async skip(id: string): Promise<{ ok: boolean }> {
    const r = await this.prisma.linkedinProspect.updateMany({ where: { id }, data: { status: 'SKIPPED' } });
    return { ok: r.count > 0 };
  }

  // ── Sayaclar / durum ────────────────────────────────────────

  private async counters(): Promise<{ counters: TickCounters & { fails: number }; requestsMatured: number; acceptedMatured: number }> {
    const now = new Date();
    const dayStart = istanbulDayStart(now);
    const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
    const win = acceptRateWindow(now);
    const [requestsToday, messagesToday, requestsWeek, requestsMatured, acceptedMatured, todayRows, failsRow, researchRow] = await Promise.all([
      this.prisma.linkedinProspect.count({ where: { requestedAt: { gte: dayStart } } }),
      this.prisma.linkedinProspect.count({ where: { messagedAt: { gte: dayStart } } }),
      this.prisma.linkedinProspect.count({ where: { requestedAt: { gte: weekAgo } } }),
      this.prisma.linkedinProspect.count({ where: { requestedAt: { gte: win.from, lte: win.to } } }),
      this.prisma.linkedinProspect.count({ where: { requestedAt: { gte: win.from, lte: win.to }, acceptedAt: { not: null } } }),
      this.prisma.linkedinProspect.findMany({ where: { requestedAt: { gte: dayStart } }, select: { firma: true } }),
      this.prisma.kvStore.findUnique({ where: { key: KV_FAILS } }).catch(() => null),
      this.prisma.kvStore.findUnique({ where: { key: KV_RESEARCH + istanbulParts(now).ymd } }).catch(() => null),
    ]);
    const companyRequestsToday: Record<string, number> = {};
    for (const r of todayRows) {
      const k = firmaKey(r.firma);
      companyRequestsToday[k] = (companyRequestsToday[k] ?? 0) + 1;
    }
    return {
      counters: {
        requestsToday,
        messagesToday,
        requestsWeek,
        researchToday: Number(researchRow?.value ?? 0) || 0,
        companyRequestsToday,
        fails: Number(failsRow?.value ?? 0) || 0,
      },
      requestsMatured,
      acceptedMatured,
    };
  }

  /**
   * Kuyruk. QUEUED sirasi: once lastError'u OLMAYANLAR (kademe, eklenme),
   * sonra hata notu olanlar. NEDEN: engel (captcha vb.) yiyen kayit lastError
   * alir ama QUEUED kalir; Devam'dan sonra yine ilk secilirse ayni engel →
   * ayni duraklatma (kilitlenme). MySQL'de NULL siralamasi tasinabilir
   * olmadigindan iki sorgu.
   */
  private async buildQueue(research?: string[]): Promise<TickQueue> {
    const sel = { id: true, firma: true } as const;
    const order = [{ kademe: 'asc' as const }, { createdAt: 'asc' as const }];
    const [accepted, requested, fresh, messagedCount] = await Promise.all([
      this.prisma.linkedinProspect.findMany({ where: { status: 'ACCEPTED' }, orderBy: { acceptedAt: 'asc' }, take: 20, select: sel }),
      this.prisma.linkedinProspect.findMany({ where: { status: 'REQUESTED' }, orderBy: { requestedAt: 'asc' }, take: 20, select: sel }),
      this.prisma.linkedinProspect.findMany({ where: { status: 'QUEUED', lastError: null }, orderBy: order, take: QUEUE_TAKE, select: sel }),
      this.prisma.linkedinProspect.count({ where: { status: 'MESSAGED' } }),
    ]);
    const retry = fresh.length < QUEUE_TAKE
      ? await this.prisma.linkedinProspect.findMany({ where: { status: 'QUEUED', lastError: { not: null } }, orderBy: order, take: QUEUE_TAKE - fresh.length, select: sel })
      : [];
    const researchTargets = (research ?? []).map((s) => String(s).trim()).filter(Boolean).slice(0, 10);
    return { accepted, requested, queued: [...fresh, ...retry], messagedCount, researchTargets };
  }

  private async pausedReason(): Promise<string | null> {
    const row = await this.prisma.kvStore.findUnique({ where: { key: KV_PAUSED } }).catch(() => null);
    return row ? row.value : null;
  }

  private async setPaused(reason: string): Promise<void> {
    await this.prisma.kvStore.upsert({
      where: { key: KV_PAUSED },
      create: { key: KV_PAUSED, value: reason.slice(0, 1000) },
      update: { value: reason.slice(0, 1000) },
    });
    this.log.warn(`LinkedIn outreach duraklatıldı: ${reason.slice(0, 200)}`);
  }

  private async pauseWithNotice(reason: string): Promise<void> {
    await this.setPaused(reason);
    await this.notifyAdmin('LinkedIn botu duraklatıldı', `${reason}\n\nNedeni giderip /admin/linkedin sayfasından "Devam" deyin.`);
  }

  private async setFails(n: number): Promise<void> {
    await this.prisma.kvStore.upsert({ where: { key: KV_FAILS }, create: { key: KV_FAILS, value: String(n) }, update: { value: String(n) } });
  }

  private async bumpFails(): Promise<number> {
    const row = await this.prisma.kvStore.findUnique({ where: { key: KV_FAILS } }).catch(() => null);
    const n = (Number(row?.value ?? 0) || 0) + 1;
    await this.setFails(n);
    return n;
  }

  /** Bugunku arastirma sayaci (Istanbul gunu) */
  private async researchCountToday(): Promise<number> {
    const key = KV_RESEARCH + istanbulParts(new Date()).ymd;
    const row = await this.prisma.kvStore.findUnique({ where: { key } }).catch(() => null);
    return Number(row?.value ?? 0) || 0;
  }

  private async bumpResearch(limits: OutreachLimits): Promise<void> {
    const key = KV_RESEARCH + istanbulParts(new Date()).ymd;
    const row = await this.prisma.kvStore.findUnique({ where: { key } }).catch(() => null);
    const n = Math.min(limits.MAX_RESEARCH_PER_DAY, (Number(row?.value ?? 0) || 0) + 1);
    await this.prisma.kvStore.upsert({
      where: { key },
      create: { key, value: String(n), expiresAt: new Date(Date.now() + 2 * 86_400_000) },
      update: { value: String(n) },
    });
  }

  private async setError(id: string, msg: string, failStatus: boolean): Promise<void> {
    await this.prisma.linkedinProspect
      .update({ where: { id }, data: { lastError: msg.slice(0, 1000), ...(failStatus ? { status: 'FAILED' } : {}) } })
      .catch(() => undefined);
  }

  /**
   * Es zamanli tick kilidi (worker cron + panelden elle tick ayni anda
   * kosmasin — tek tarayici, tek hesap). KvStore unique key; deger bu surece
   * ozel rastgele belirtec — yalniz kendi kilidimizi sileriz (NEDEN: sahipsiz
   * kilit, bayat sanilip silinen kilidin ardindan gelen release'in YENI
   * sahibin kilidini de silmesine yol aciyordu). Bayat (expiresAt gecmis)
   * kilit degeriyle birlikte silinir.
   */
  /**
   * Kilidi al ve TOKEN dondur. NEDEN token dondurulur (servis alaninda tutulmaz): ayni surecte iki is
   * cakistiginda (uzun link taramasi + cron tick) eski is, yeni isin kilidini siliyordu (30.08 denetimi).
   * Kilidi yalnizca token sahibi birakabilir/yenileyebilir.
   */
  private async acquireLock(attempt = 0): Promise<string | null> {
    const now = new Date();
    const token = randomUUID();
    try {
      await this.prisma.kvStore.create({ data: { key: KV_LOCK, value: token, expiresAt: new Date(now.getTime() + LOCK_TTL_MS) } });
      this.lockToken = token;
      return token;
    } catch {
      if (attempt >= 1) return null;
      const row = await this.prisma.kvStore.findUnique({ where: { key: KV_LOCK } }).catch(() => null);
      if (row?.expiresAt && row.expiresAt.getTime() < now.getTime()) {
        await this.prisma.kvStore.deleteMany({ where: { key: KV_LOCK, value: row.value } }).catch(() => undefined);
        return this.acquireLock(attempt + 1);
      }
      return null;
    }
  }

  /**
   * Uzun isler icin kilit omrunu uzat (heartbeat). NEDEN: 45 dk'lik TTL, 12 link x 10 sayfa taramasindan
   * kisa kaliyordu; cron tick kilidi bayat sayip AYNI tarayicida gonderime giriyordu (30.08 denetimi).
   * Kilit baskasina gectiyse false doner → cagiran isi durdurur.
   */
  private async renewLock(token: string): Promise<boolean> {
    const r = await this.prisma.kvStore
      .updateMany({ where: { key: KV_LOCK, value: token }, data: { expiresAt: new Date(Date.now() + LOCK_TTL_MS) } })
      .catch(() => ({ count: 0 }));
    return r.count > 0;
  }

  private async releaseLock(token?: string): Promise<void> {
    const t = token ?? this.lockToken;
    if (this.lockToken === t) this.lockToken = undefined;
    if (!t) return;
    await this.prisma.kvStore.deleteMany({ where: { key: KV_LOCK, value: t } }).catch(() => undefined);
  }

  /** Duraklatma ve cevap bildirimleri e-postayla da gider (insan devralmali) */
  private async notifyAdmin(title: string, body: string, channels: Array<'inapp' | 'email'> = ['inapp', 'email']): Promise<void> {
    try {
      const admin = await this.prisma.user.findFirst({ where: { role: 'ADMIN' }, orderBy: { createdAt: 'asc' }, select: { id: true } });
      if (!admin) { this.log.warn('Bildirim icin ADMIN kullanici yok'); return; }
      await this.notifications.create({ userId: admin.id, type: 'SYSTEM', title, body, link: '/admin/linkedin', channels });
    } catch (err: any) {
      this.log.warn(`Bildirim yazilamadi: ${err?.message ?? err}`);
    }
  }

  // ── Tarayici ────────────────────────────────────────────────

  /** URL → baslik → govde basi (rules.detectBlock); haftalik limit tum metinde */
  private assertNoBlock(page: PageRead): void {
    const b = detectBlock(page.text, { url: page.url, title: page.title });
    if (b.blocked) throw new BlockError(b);
  }

  /** Ilk cagrida sekme acar, sonrakilerde ayni sekmede gezer */
  private async goto(url: string): Promise<void> {
    if (!this.tab) {
      const opened = await this.browser<{ tabId?: string; targetId?: string }>(['open', url]);
      this.tab = opened?.tabId ?? opened?.targetId ?? 'acik';
    } else {
      try {
        await this.browser(['navigate', url]);
      } catch (err: any) {
        // NEDEN: tunel uzerinden LinkedIn arama sayfasi gateway'in navigate suresini (20 sn) asabiliyor
        // (29.08.2026 Getir turu); sayfa cogu zaman yine de yuklenmistir → URL dogrulanir, degilse bir kez daha
        if (!/timeout|zaman aşımı/iu.test(String(err?.message ?? err))) throw err;
        await sleep(SETTLE_MS);
        const here = await this.readPage().catch(() => null);
        if (!urlMatchesTarget(here?.url, url)) await this.browser(['navigate', url]);
      }
    }
    await sleep(SETTLE_MS);
  }

  /**
   * Sekmeyi kapat. `open` id dondurmediyse sekme sizmasin: `tabs` ile
   * linkedin sekmesi bulunur, o da olmazsa argumansiz `close` (aktif sekme).
   */
  private async closeTab(): Promise<void> {
    if (!this.tab) return;
    const t = this.tab;
    this.tab = undefined;
    if (t !== 'acik') {
      await this.browser(['close', t]).catch(() => undefined);
      return;
    }
    const tabs = await this.browser<any>(['tabs']).catch(() => null);
    const list: any[] = Array.isArray(tabs) ? tabs : Array.isArray(tabs?.tabs) ? tabs.tabs : [];
    const li = list.find((x) => /linkedin\.com/i.test(String(x?.url ?? '')));
    const id = li?.tabId ?? li?.targetId ?? li?.id;
    if (id) await this.browser(['close', String(id)]).catch(() => undefined);
    else await this.browser(['close']).catch(() => undefined);
  }

  /** Profilde insan gibi okuma: 8-20 sn + rastgele kaydirma (kuru modda kisa) */
  private async humanRead(dryRun: boolean): Promise<void> {
    const total = dryRun ? 3_000 : profileReadDelayMs();
    const steps = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < steps; i++) {
      await sleep(Math.round(total / steps));
      await this.browser(['evaluate', '--fn', SCROLL_FN]).catch(() => undefined);
    }
  }

  private async readPage(): Promise<PageRead> {
    const res = await this.browser<{ result?: PageRead }>(['evaluate', '--fn', READ_PAGE_FN]);
    const r = res?.result;
    if (!r || typeof r.text !== 'string') throw new Error('Sayfa okunamadı (evaluate boş döndü)');
    return { text: r.text, dist: Array.isArray(r.dist) ? r.dist : [], url: r.url ?? '', title: r.title ?? '' };
  }

  /** ai snapshot metni (ref'ler icinde). --json ciktisinda `snapshot` alani; yoksa ham stdout. */
  private async snapshot(extra: string[] = []): Promise<string> {
    const res = await this.browser<any>(['snapshot', ...extra]);
    if (!res) return '';
    if (typeof res === 'string') return res;
    if (typeof res.snapshot === 'string') return res.snapshot;
    if (typeof res.text === 'string') return res.text;
    if (Array.isArray(res.nodes)) return res.nodes.map((n: any) => JSON.stringify(n)).join('\n');
    return JSON.stringify(res);
  }

  private async click(ref: string): Promise<void> {
    await this.browser(['click', ref]);
  }

  private async type(ref: string, text: string): Promise<void> {
    await this.browser(['type', ref, text]);
  }

  private async press(key: string): Promise<void> {
    await this.browser(['press', key]);
  }

  /**
   * Ekran goruntusu — kanit. OpenClaw kendi yoluna yazar; ayni makinedeyse
   * data/linkedin/<id>-<adim>.png'ye kopyalanir. Hata islemi DUSURMEZ (null).
   */
  private async screenshot(id: string, step: string): Promise<string | null> {
    try {
      const res = await this.browser<{ path?: string }>(['screenshot']);
      const src = res?.path;
      if (!src) return null;
      const safe = `${id}-${step}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120);
      const dest = path.join(SCREENSHOT_DIR, `${safe}.png`);
      try {
        if (fs.existsSync(src)) {
          fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
          fs.copyFileSync(src, dest);
          return dest.slice(-255);
        }
      } catch {
        // kopyalanamadi — OpenClaw'in yolu kalir
      }
      return String(src).slice(-255);
    } catch (err: any) {
      this.log.debug(`screenshot atlandi: ${err?.message ?? err}`);
      return null;
    }
  }

  /**
   * x-curation ile ayni kopru: openclaw browser <args> --json --timeout.
   * NEDEN tekrar: ters tunel uzerinden gateway RPC zaman asimi (navigate 20 sn / evaluate 25 sn, CLI --timeout'u
   * dinlemiyor) ara ara dusuyor (30.08 Akbank/Yapı Kredi turu). Yalniz SALT-OKUMA komutlar bir kez tekrarlanir;
   * click/type/press/fill asla (cift tiklama = cift istek).
   */
  private async browser<T = any>(args: string[]): Promise<T | null> {
    try {
      return await this.browserOnce<T>(args);
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      // NEDEN genis kalip: tunel uzerinden hem RPC zaman asimi hem ani kapanma (1006 abnormal closure)
      // goruluyor; ikisi de gecici — yalniz SALT-OKUMA komutlarda tekrar
      if (!READ_RETRY_COMMANDS.has(args[0]) || !/gateway timeout|gateway closed|abnormal closure|1006|ECONNREFUSED|socket hang up|GatewayTransportError|zaman aşımı/iu.test(msg)) throw err;
      this.log.debug(`openclaw browser ${args[0]} zaman asimi — 5 sn sonra tekrar`);
      await sleep(5_000);
      return await this.browserOnce<T>(args);
    }
  }

  private browserOnce<T = any>(args: string[]): Promise<T | null> {
    const bin = process.env.OPENCLAW_BIN ?? 'openclaw';
    const full = ['browser', ...args, '--json', '--timeout', String(DEFAULT_TIMEOUT_MS)];
    // NEDEN LinkedIn'e ozel gateway: VPS IP'sini LinkedIn dakikalar icinde 429/redirect ile kesiyor
    // (29.08.2026). Tarayici konut IP'sindeki bir makinede (SSH ters tunel) kosar; X kurasyonu
    // sunucudaki profili kullanmaya devam eder.
    const url = process.env.OPENCLAW_LINKEDIN_GATEWAY_URL || process.env.OPENCLAW_GATEWAY_URL;
    const token = process.env.OPENCLAW_LINKEDIN_TOKEN || process.env.OPENCLAW_TOKEN;
    const profile = process.env.OPENCLAW_LINKEDIN_BROWSER_PROFILE;
    if (url) full.push('--url', url);
    if (token) full.push('--token', token);
    if (profile) full.push('--browser-profile', profile);
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      const proc = spawn(bin, full, { stdio: ['ignore', 'pipe', 'pipe'] });
      const timer = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error(`openclaw browser ${args[0]} zaman aşımı`)); }, DEFAULT_TIMEOUT_MS + 15_000);
      proc.stdout.on('data', (c: Buffer) => { if (stdout.length < 4_000_000) stdout += c.toString('utf8'); });
      proc.stderr.on('data', (c: Buffer) => { if (stderr.length < 8_000) stderr += c.toString('utf8'); });
      proc.on('error', (e) => { clearTimeout(timer); reject(new Error(`openclaw çalıştırılamadı (${bin}): ${e.message}`)); });
      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) return reject(new Error(`openclaw browser ${args[0]} çıkış ${code}: ${stderr.slice(0, 300)}`));
        const s = stdout.trim();
        if (!s) return resolve(null);
        const start = s.indexOf('{');
        try { resolve(JSON.parse(start >= 0 ? s.slice(start) : s)); } catch { resolve(s as unknown as T); }
      });
    });
  }
}

/** Snapshot'ta bu ref hala var mi (ref'ler yenilenmis olabilir) */
function snapshotHasRef(snapshot: string, ref: string): boolean {
  return snapshot.split(/\r?\n/).some((l) => extractRef(l) === ref);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
