'use client';

import { ARTICLE_STATUS_LABEL, label } from '@/lib/labels';
import { siteHref } from '@/lib/site-routes';
import {
  overwriteRemoteEditsConfirm, pollJob, publishJobOutcome, publishOutcomeView, publishedEntryView, rememberRemoteSkips,
  type PublishTargetResult, type RemoteSkipMemo,
} from '@/lib/publish-result';
import {
  canForgetEntry, currentArticleMarkdown, forgetEntryConfirm, manualUpdateNote, manualUpdateReason, missingCopyNote,
} from '@/lib/manual-update';
import {
  articleContentHash, initialPublishSelection, leftOutLiveConfirm, leftOutLiveCopies, liveSiteEntries, publishSelectionWarnings,
  targetDisplayName, targetTypeLabel,
} from '@/lib/publish-targets';
import { showNotice } from '@/lib/notice';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { toast } from 'sonner';
import { ArrowLeft, Download, Send, ExternalLink, Calendar, Clock, FileText, ImageIcon, Wrench, User, Gauge, Settings2, HelpCircle, RotateCw, Copy, CheckCircle2 } from 'lucide-react';
import { api, type PublishedEntryMutation } from '@/lib/api';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { PipelineProgress } from '@/components/pipeline-progress';
import { InfoTooltip } from '@/components/info-tooltip';
import { StatusBanner } from '@/components/ui/status-banner';
import { useConfirm } from '@/components/ui/confirm-dialog';

/**
 * "## Sıkça Sorulan Sorular" altındaki H3 sorularını ve cevap paragraflarını
 * parse eder. Pipeline DB'ye `faqs` yazmadığı için fallback.
 */
function extractFaqsFromMarkdown(md: string): { q: string; a: string }[] {
  if (!md) return [];
  const faqHeader = md.match(/^##\s+(?:Sıkça\s+Sorulan\s+Sorular|S(?:S|Ş)S|FAQ)\s*$/im);
  if (!faqHeader || faqHeader.index === undefined) return [];
  const after = md.slice(faqHeader.index + faqHeader[0].length);
  const nextH2 = after.search(/^##\s+/m);
  const section = nextH2 === -1 ? after : after.slice(0, nextH2);

  const faqs: { q: string; a: string }[] = [];
  const re = /^###\s+(.+?)\s*$/gm;
  const matches = [...section.matchAll(re)];
  for (let i = 0; i < matches.length; i++) {
    const q = matches[i][1].trim();
    const start = matches[i].index! + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index! : section.length;
    const a = section.slice(start, end).trim().replace(/\n{2,}/g, '\n\n');
    if (q && a) faqs.push({ q, a });
  }
  return faqs;
}

/** Markdown -> HTML (front matter ve FAQ kapsam dahil). */
function renderMarkdownToHtml(md: string): string {
  if (!md) return '';
  // Frontmatter blogunu (varsa) at — render etme
  const stripped = md.replace(/^---\n[\s\S]+?\n---\n+/, '');
  // marked raw HTML'i sanitize ETMEZ; icerik pipeline uretimi olsa da
  // ayni sink kalibinin tamaminda DOMPurify uygulanir (XSS savunmasi).
  return DOMPurify.sanitize(marked.parse(stripped, { async: false }) as string);
}

const STATUS_VARIANT: Record<string, any> = {
  DRAFT: 'secondary',
  GENERATING: 'warning',
  EDITING: 'warning',
  REVIZE_NEEDED: 'destructive',
  READY_TO_PUBLISH: 'default',
  PUBLISHED: 'success',
  FAILED: 'destructive',
  ARCHIVED: 'outline',
};

// Tahmini adimlar (PipelineProgress sureye gore simule eder) — yayincinin GERCEK sirasi
// (api articles/publisher.service.ts publishArticle). Eski liste yayinci hic yapmadigi
// "URL erisilebilir mi kontrol" adimini tamamlanmis gosteriyordu. Gercek sonuc is
// kaydindan okunup ayrica bildirilir (lib/publish-result.ts).
const PUBLISH_STEPS = [
  { label: 'Yayın öncesi kontrol', sublabel: 'Kalite kontrolü ve iç bağlantılar', durationMs: 4000 },
  { label: 'Kapak görseli', sublabel: 'Kapak görseli yoksa üretilir', durationMs: 8000 },
  { label: 'Yayın hedefine gönderiliyor', sublabel: 'Yazı seçili hedeflere yükleniyor', durationMs: 12000 },
  { label: 'Sonuç bekleniyor', sublabel: 'Her hedefin yanıtı okunuyor', durationMs: 4000 },
];

const HERO_PLACEHOLDER_LINE_RE = /^[ \t]*!\[[^\]]*\]\(\s*placeholder-hero\.webp\s*\)[ \t]*(?:\r?\n|$)/gim;

/** 90 puanlik editor olcegi 16ab0d9 ile geldi (3 Agustos 2026 23:25 +03:00) */
const EDITOR_SCALE_90_SINCE = Date.parse('2026-08-03T20:25:08Z');

/**
 * Editor skorunun paydasi. Bugunku editor 9 kategori x 10 = 90 uzerinden puanlar
 * (api pipeline.service EDITOR_MAX_SCORE); eski "/100" hicbir zaman dogru
 * degildi. 16ab0d9'dan onceki hat 60 uzerinden puanliyordu. Yeni hattin her
 * kosusu agentOutputs.geoGate yazar; ajan ciktisi olup geoGate'i olmayan kayit
 * eski hattandir. Ajan ciktisi hic yoksa (ceviri skoru kaynaktan kopyalar)
 * kayit tarihine bakilir.
 */
function editorScoreMax(article: { agentOutputs?: unknown; createdAt?: string | Date | null }): 60 | 90 {
  const outputs = (article.agentOutputs && typeof article.agentOutputs === 'object'
    ? article.agentOutputs
    : {}) as { geoGate?: unknown; writer?: unknown };
  if (outputs.geoGate) return 90;
  if (outputs.writer) return 60;
  const created = article.createdAt ? new Date(article.createdAt).getTime() : NaN;
  return Number.isFinite(created) && created < EDITOR_SCALE_90_SINCE ? 60 : 90;
}

export default function ArticleDetailPage() {
  const params = useParams();
  const siteId = params.id as string;
  const articleId = params.articleId as string;

  const [article, setArticle] = useState<any>(null);
  const [targets, setTargets] = useState<any[]>([]);
  // Hedef listesi okunamadi: kaydin hedefi "silinmis" sayilmaz (lib/manual-update.ts)
  const [targetsError, setTargetsError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [selectedTargets, setSelectedTargets] = useState<Set<string>>(new Set());
  // Kullanici hedef secimini elle degistirdiyse tazeleme onu ezmez (yayindan sonra sifirlanir)
  const selectionTouched = useRef(false);
  // Yazinin guncel metninin izi (api articleContentHash ile ayni, lib/publish-targets.ts):
  // secilmeyen canli kopyanin eski metinle kalip kalmayacagi kaydin contentHash'iyle
  // karsilastirilarak soylenir. Hesaplanamazsa null — panel eskilik iddia etmez.
  const [contentHash, setContentHash] = useState<string | null>(null);
  // Bu oturumdaki son yayinda WordPress'te elle duzenlendigi ya da kaydi baska yaziyi
  // gosterdigi icin atlanan hedefler (sozlesme C2) — Yayin Gecmisi kesin not ve eylem gosterir
  const [remoteSkips, setRemoteSkips] = useState<Record<string, RemoteSkipMemo>>({});
  const [stuckPage, setStuckPage] = useState<any | null>(null);
  const [qaRunning, setQaRunning] = useState(false);
  // Elle guncelleme eylemi suren yayin kaydi (targetId) — cift tiklama ikinci istek atmasin
  const [entryBusy, setEntryBusy] = useState<string | null>(null);
  const confirm = useConfirm();
  // Sayfadan cikilinca yayin isinin yoklamasi dursun, gec gelen sonuc state yazmasin
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const refresh = async () => {
    try {
      const [a, t] = await Promise.all([
        api.getArticle(siteId, articleId),
        api.listPublishTargets(siteId).then(
          (list) => ({ list: Array.isArray(list) ? list : [], ok: true }),
          () => ({ list: [] as any[], ok: false }),
        ),
      ]);
      setArticle(a);
      setTargets(t.list);
      setTargetsError(!t.ok);
      // Onsecim (lib/publish-targets.ts): yazi sitede yayindaysa yazinin yayinda oldugu
      // AKTIF hedefler, degilse (yalniz Markdown ZIP disa aktarimi dahil) aktif varsayilan.
      // API secimi AYNEN uygular (D1): kaldirilan canli kopya icin yayindan once uyarilir.
      // Eskiden varsayilan (pasif olsa da) seciliyordu: yazi baska hedefte yayindayken
      // yayin varsayilanda kopya aciyordu.
      if (!selectionTouched.current) setSelectedTargets(new Set(initialPublishSelection(a?.publishedTo, t.list)));

      // ENH#6 — Bu article icin stuck page kaydi var mi?
      try {
        const stuckList = await api.listStuckPages(siteId);
        const match = stuckList.find((s: any) => s.articleId === articleId && (s.status === 'DETECTED' || s.status === 'FAILED'));
        setStuckPage(match ?? null);
      } catch {/* sessizce gec */}
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, [siteId, articleId]);

  useEffect(() => {
    let gecerli = true;
    setContentHash(null);
    if (!article) return;
    void articleContentHash(article).then((h) => { if (gecerli) setContentHash(h); });
    return () => { gecerli = false; };
  }, [article?.title, article?.metaTitle, article?.metaDescription, article?.bodyMd]);

  // Pipeline DB'ye bodyHtml/faqs yazmıyor — markdown'dan client-side türet.
  // Her iki yol da sanitize edilir: bodyHtml DB'den gelse de sink tek standarttan geçer.
  const renderedHtml = useMemo<string>(() => {
    if (article?.bodyHtml) return DOMPurify.sanitize(article.bodyHtml as string);
    // Eski makalelerde yazar şablonunun "![Hero](placeholder-hero.webp)" satırı kalmış olabilir
    // (api articles/hero-placeholder.ts ile aynı kural) — önizlemede kırık görsel olarak çıkıyordu.
    if (article?.bodyMd) return renderMarkdownToHtml((article.bodyMd as string).replace(HERO_PLACEHOLDER_LINE_RE, ''));
    return '';
  }, [article?.bodyHtml, article?.bodyMd]);

  const fallbackFaqs = useMemo<{ q: string; a: string }[]>(() => {
    const dbFaqs = (article?.faqs as any[]) ?? [];
    if (dbFaqs.length > 0) return dbFaqs as any;
    return article?.bodyMd ? extractFaqsFromMarkdown(article.bodyMd as string) : [];
  }, [article?.faqs, article?.bodyMd]);

  const downloadMarkdown = () => {
    if (!article?.bodyMd) {
      toast.error('Markdown içeriği yok');
      return;
    }
    const fm = article.frontmatter ?? {};
    const fmStr =
      Object.keys(fm).length > 0
        ? `---\n${Object.entries(fm).map(([k, v]) => `${k}: ${typeof v === 'string' ? `"${v}"` : JSON.stringify(v)}`).join('\n')}\n---\n\n`
        : `---\ntitle: "${article.title}"\nslug: ${article.slug}\ndate: ${new Date(article.createdAt).toISOString()}\n---\n\n`;

    const blob = new Blob([fmStr + article.bodyMd], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${article.slug || 'article'}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('Markdown indirildi');
  };

  const downloadHtml = () => {
    const body = renderedHtml;
    if (!body) {
      toast.error('İçerik henüz oluşmadı');
      return;
    }
    const css = `
*, *::before, *::after { box-sizing: border-box; }
:root {
  --bg: #ffffff;
  --fg: #0f172a;
  --muted: #475569;
  --brand: #6c5ce7;
  --border: #e2e8f0;
  --code-bg: #f1f5f9;
  --quote-bg: #faf9ff;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #0f172a; --fg: #f1f5f9; --muted: #94a3b8; --border: #1e293b; --code-bg: #1e293b; --quote-bg: #1e1b4b; }
}
html, body { margin: 0; padding: 0; background: var(--bg); color: var(--fg); }
body { font: 16px/1.7 -apple-system, BlinkMacSystemFont, "Segoe UI", "SF Pro Text", system-ui, sans-serif; }
.luvi-article { max-width: 720px; margin: 48px auto; padding: 0 20px; }
.luvi-article h1 { font-size: 2.1rem; line-height: 1.2; margin: 0 0 1.2rem; letter-spacing: -0.01em; }
.luvi-article h2 { font-size: 1.5rem; line-height: 1.25; margin: 2.6rem 0 0.8rem; padding-top: 0.4rem; }
.luvi-article h3 { font-size: 1.18rem; line-height: 1.3; margin: 1.8rem 0 0.5rem; }
.luvi-article h4 { font-size: 1.05rem; margin: 1.4rem 0 0.4rem; }
.luvi-article p { margin: 0 0 1.1rem; }
.luvi-article a { color: var(--brand); text-decoration: underline; text-underline-offset: 2px; }
.luvi-article a:hover { text-decoration-thickness: 2px; }
.luvi-article ul, .luvi-article ol { margin: 0 0 1.2rem; padding-left: 1.4rem; }
.luvi-article li { margin: 0.35rem 0; }
.luvi-article blockquote {
  margin: 1.4rem 0; padding: 1rem 1.2rem; background: var(--quote-bg);
  border-left: 4px solid var(--brand); border-radius: 8px; color: var(--fg);
}
.luvi-article blockquote p:last-child { margin-bottom: 0; }
.luvi-article code {
  font: 0.92em/1.5 ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, monospace;
  background: var(--code-bg); padding: 2px 5px; border-radius: 4px;
}
.luvi-article pre {
  background: var(--code-bg); padding: 1rem 1.2rem; border-radius: 10px;
  overflow-x: auto; margin: 1.2rem 0;
}
.luvi-article pre code { background: transparent; padding: 0; }
.luvi-article table {
  width: 100%; border-collapse: collapse; margin: 1.4rem 0; font-size: 0.95rem;
}
.luvi-article th, .luvi-article td {
  border: 1px solid var(--border); padding: 8px 12px; text-align: left;
}
.luvi-article th { background: var(--code-bg); font-weight: 600; }
.luvi-article img { max-width: 100%; height: auto; border-radius: 10px; margin: 1.2rem 0; }
.luvi-article hr { border: 0; border-top: 1px solid var(--border); margin: 2.4rem 0; }
.luvi-meta {
  font-size: 0.82rem; color: var(--muted); padding-bottom: 1.4rem;
  margin-bottom: 1.8rem; border-bottom: 1px solid var(--border);
}
.luvi-meta span + span::before { content: " · "; margin: 0 0.4rem; }
.luvi-footer {
  margin-top: 4rem; padding-top: 1.4rem; border-top: 1px solid var(--border);
  font-size: 0.78rem; color: var(--muted); text-align: center;
}
.luvi-footer a { color: var(--brand); text-decoration: none; }
`.trim();

    const meta = [
      article.persona && `<span>👤 ${article.persona}</span>`,
      article.wordCount && `<span>📄 ${article.wordCount} kelime</span>`,
      article.readingTime && `<span>⏱ ${article.readingTime} dk okuma</span>`,
      `<span>📅 ${new Date(article.createdAt).toLocaleDateString('tr-TR')}</span>`,
    ].filter(Boolean).join('');

    const html = `<!DOCTYPE html>
<html lang="${article.language || 'tr'}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${article.metaTitle ?? article.title}</title>
<meta name="description" content="${article.metaDescription ?? ''}">
<meta property="og:title" content="${article.title}">
<meta property="og:description" content="${article.metaDescription ?? ''}">
<meta property="og:type" content="article">
${article.schemaMarkup ? `<script type="application/ld+json">${JSON.stringify(article.schemaMarkup)}</script>` : ''}
<style>${css}</style>
</head>
<body>
<article class="luvi-article">
${meta ? `<div class="luvi-meta">${meta}</div>` : ''}
${body}
<div class="luvi-footer">RanksUp tarafından üretildi · <a href="https://ranksup.ai">ranksup.ai</a></div>
</article>
</body>
</html>`;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${article.slug || 'article'}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('HTML indirildi');
  };

  const toggleTarget = (id: string) => {
    selectionTouched.current = true;
    setSelectedTargets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** Bu hedef listesinin disarida biraktigi canli kopyalar (D1: API oraya yazmaz) */
  const leftOutFor = (ids: Iterable<string>) =>
    leftOutLiveCopies(ids, article?.publishedTo, targets, { contentHash, articleStatus: article?.status });

  /**
   * targetIds verilmezse secili hedefler. overwriteRemoteEdits (sozlesme C1) yalniz
   * yayincinin az once 'live_entry_edited' dedigi hedef icin, onay penceresinden sonra
   * (overwriteRemote); otomasyon ve siradan yayin bunu hic gondermez.
   * Sozlesme D1: API listeyi AYNEN uygular. Liste yazinin yayinda oldugu bir kopyayi
   * disarida birakiyor ve o kopyanin metni eskiyse yayindan ONCE sorulur (eski metinle
   * kalir, RanksUp isaretler). leftOutConfirmed: cagiran bunu kendi onay penceresinde
   * zaten sordu (QA engeline ragmen yayin). Uzerine yazma tek bir kopyaya yonelik
   * eylemdir; diger kopyalarin durumu az onceki yayinda soylendi, yeniden sorulmaz.
   */
  const publish = async (opts: { overrideQa?: boolean; overwriteRemoteEdits?: boolean; targetIds?: string[]; leftOutConfirmed?: boolean } = {}) => {
    const ids = opts.targetIds ?? Array.from(selectedTargets);
    if (ids.length === 0) {
      toast.error('En az bir yayın hedefi seç');
      return;
    }
    // QA Gate on kontrolu: BLOCKED ise once kullaniciya blocker'lari goster
    if (!opts.overrideQa && article?.qaStatus === 'BLOCKED') {
      toast.error('QA gate yayını engelledi — aşağıdaki QA raporuna bak veya "Yine de Yayınla" kullan');
      return;
    }
    if (!opts.overwriteRemoteEdits && !opts.leftOutConfirmed) {
      const c = leftOutLiveConfirm(leftOutFor(ids));
      if (c && !(await confirm(c))) return;
    }
    setPublishing(true);
    try {
      const job = await api.publishArticle(siteId, articleId, ids, opts.overrideQa, opts.overwriteRemoteEdits);
      toast.message(
        opts.overwriteRemoteEdits ? 'Üzerine yazma kuyruğa alındı' : opts.overrideQa ? 'QA engeline rağmen yayın kuyruğa alındı' : 'Yayın kuyruğa alındı',
        { description: 'Sonuç hazır olunca burada göstereceğiz.' },
      );
      // Sonuc is kaydindan: hedef bazinda yayinlandi / atlandi / hata — hata metni API'den,
      // oldugu gibi (lib/publish-result.ts). Eskiden 28 sn sonra yalniz sayfa yenileniyordu;
      // basarisiz ya da atlanan yayin hic gorunmuyordu.
      const snap = job?.dbJobId ? await pollJob(() => api.getJob(job.dbJobId), { isAlive: () => alive.current }) : null;
      if (!alive.current) return;
      const nameOf = (r: PublishTargetResult) => targetDisplayName(targets, r.targetId, r.targetType);
      const outcome = publishJobOutcome(snap);
      const view = publishOutcomeView(outcome, nameOf);
      for (const n of view.notices) showNotice(n);
      if (view.remoteEdited) {
        showNotice({
          ...view.remoteEdited.notice,
          description: `${view.remoteEdited.notice.description ?? ''} İstersen Yayın Geçmişi’nden WordPress’teki değişikliklerin üzerine yazabilirsin.`.trim(),
        });
      }
      // Secilmeyen canli kopyalar (D1) yalniz musterinin hedef sectigi yayinda soylenir;
      // tek hedefe yonelik dugmelerde (yeniden yayin, uzerine yazma) secim yok
      if (view.notSelected && !opts.targetIds) showNotice(view.notSelected.notice);
      if (outcome.kind === 'done') {
        setRemoteSkips((prev) => rememberRemoteSkips(prev, outcome.results, !!opts.overrideQa));
      }
      // Yayindan sonra onsecim yeniden yazinin canli hedeflerinden kurulur
      selectionTouched.current = false;
      await refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      if (alive.current) setPublishing(false);
    }
  };

  /**
   * WordPress'te elle duzenlenmis canli yazinin uzerine yazma — yalniz bu oturumda
   * yayincinin 'live_entry_edited' dedigi hedefte sunulur ve once onay ister: musterinin
   * kendi WordPress duzenlemeleri yazidan cikar. Ilk yayin QA engeline ragmen yapildiysa
   * ayni karar tasinir (yoksa ikinci istek QA'da durur).
   */
  const overwriteRemote = async (targetId: string, name: string, overrideQa: boolean) => {
    const c = overwriteRemoteEditsConfirm([name]);
    if (!(await confirm({ ...c, danger: true }))) return;
    await publish({ targetIds: [targetId], overwriteRemoteEdits: true, overrideQa });
  };

  // ── Elle guncelleme (lib/manual-update.ts) ──
  // Hedef yaziyi yerinde guncelleyemedigi icin eski surum yayinda kalan kayit:
  // musteri guncel metni hedef paneline yapistirir ve isaretler, ya da yaziyi orada
  // sildiyse kaydi unutur. Sunucu yazinin guncel status + publishedTo'sunu doner.
  const applyEntryMutation = (res: PublishedEntryMutation | null): boolean => {
    if (!res || !Array.isArray(res.publishedTo)) return false;
    setArticle((prev: any) => (prev
      ? { ...prev, publishedTo: res.publishedTo, ...(typeof res.status === 'string' && res.status ? { status: res.status } : {}) }
      : prev));
    return true;
  };

  /** Musteri kopyayi kendisi ele aldi: o hedefin son-yayin hafizasi (uzerine yaz teklifi) kalkar */
  const forgetRemoteSkip = (targetId: string) => {
    setRemoteSkips((prev) => {
      if (!(targetId in prev)) return prev;
      const next = { ...prev };
      delete next[targetId];
      return next;
    });
  };

  const markEntryUpdated = async (targetId: string, name: string) => {
    setEntryBusy(targetId);
    try {
      const res = await api.markPublishedEntryUpdated(siteId, articleId, targetId);
      if (!alive.current) return;
      if (!applyEntryMutation(res)) await refresh();
      forgetRemoteSkip(targetId);
      toast.success(`${name}: elle güncellendi olarak işaretlendi.`);
    } catch (err: any) {
      toast.error(err.message);
      // Kayit baska sekmede degismis olabilir (404): ekran sunucudaki hale donsun
      if (err?.status === 404 && alive.current) void refresh();
    } finally {
      if (alive.current) setEntryBusy(null);
    }
  };

  const forgetEntry = async (targetId: string, name: string) => {
    // Geri alinamaz sonucu var: hedefe sonraki yayin yeni yazi acar (eski yazi duruyorsa kopya)
    const c = forgetEntryConfirm(name);
    if (!(await confirm({ ...c, danger: true }))) return;
    setEntryBusy(targetId);
    try {
      const res = await api.forgetPublishedEntry(siteId, articleId, targetId);
      if (!alive.current) return;
      if (!applyEntryMutation(res)) await refresh();
      forgetRemoteSkip(targetId);
      toast.success(`${name}: kayıt unutuldu.`, { description: 'Bu hedefe bir sonraki yayın yeni bir yazı açar.' });
    } catch (err: any) {
      toast.error(err.message);
      if (err?.status === 404 && alive.current) void refresh();
    } finally {
      if (alive.current) setEntryBusy(null);
    }
  };

  /**
   * Guncel metni panoya kopyalar: zengin metin (text/html, editore bicimiyle yapisir) +
   * duz metin yedegi (Markdown). Kaynak bodyMd: bodyHtml yalniz basarili yayinda
   * yazilir, elle guncelleme bekleyen yazida hedefteki ESKI metin olabilir
   * (currentArticleMarkdown notu). Clipboard.write + ClipboardItem yalniz guvenli
   * baglamda ve Baseline 2024 tarayicilarda var (MDN Clipboard.write; W3C Clipboard
   * API §7.2 [SecureContext] ClipboardItem, §7.2.4 supports(): text/plain, text/html
   * zorunlu turler); yoksa writeText ile yalniz Markdown.
   */
  const copyCurrentText = async () => {
    const md = currentArticleMarkdown(article?.bodyMd);
    if (!md) {
      toast.error('Kopyalanacak metin yok');
      return;
    }
    try {
      if (typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function') {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([renderMarkdownToHtml(md)], { type: 'text/html' }),
            'text/plain': new Blob([md], { type: 'text/plain' }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(md);
      }
      toast.success('Güncel metin kopyalandı', {
        description: 'Hedef panelindeki yazının içeriğini bununla değiştir; başlık ya da meta açıklama da değiştiyse onları da güncelle.',
      });
    } catch {
      toast.error('Metin kopyalanamadı', {
        description: 'Tarayıcı panoya erişime izin vermedi; yukarıdaki Markdown düğmesiyle indirebilirsin.',
      });
    }
  };

  const runQaCheck = async () => {
    setQaRunning(true);
    try {
      const res = await api.runArticleQaCheck(siteId, articleId);
      toast.success(
        res.status === 'PASS' ? 'QA temiz — yayına engel yok'
        : res.status === 'WARN' ? `QA: ${res.warnings.length} uyarı (yayın serbest)`
        : `QA: ${res.blockers.length} blocker — yayın engellendi`,
      );
      await refresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setQaRunning(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!article) {
    return (
      <Card>
        <CardContent className="p-12 text-center">
          <p className="text-muted-foreground mb-4">Makale bulunamadı.</p>
          <Button asChild variant="outline">
            <Link href={siteHref(siteId, 'articles') as any}>
              <ArrowLeft className="h-4 w-4 mr-1.5" aria-hidden /> İçeriklere dön
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const publishedTo = (article.publishedTo as any[]) ?? [];
  // Secim canli kopyayi disarida birakiyor ya da yeni bir kopya acacak mi (lib/publish-targets.ts);
  // disarida kalan kopyanin eski metinle kalip kalmayacagi yazinin guncel iziyle soylenir
  const selectionWarnings = publishSelectionWarnings(selectedTargets, article.publishedTo, targets, {
    targetsKnown: !targetsError,
    contentHash,
    articleStatus: article.status,
  });
  // Yazinin sitede yayinda oldugu hedefler — dugmelerde "yayında" etiketi
  const siteLiveTargetIds = new Set(liveSiteEntries(article.publishedTo, targets).map((e) => e.targetId));

  return (
    <div className="space-y-5 sm:space-y-6 max-w-5xl mx-auto">
      <div>
        <Link
          href={siteHref(siteId, 'articles') as any}
          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          İçerikler
        </Link>
        <div className="flex items-start justify-between gap-4 flex-wrap mt-3">
          <div className="flex-1 min-w-0">
            {/* Tek h1 layout'taki PageHeader'da — makale basligi h2 (text-h6 ustune cikmaz) */}
            <h2 className="text-h6 font-semibold leading-snug">{article.title}</h2>
            <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
              <Badge variant={STATUS_VARIANT[article.status] ?? 'outline'}>{label(ARTICLE_STATUS_LABEL, article.status)}</Badge>
              {article.persona && (
                <span className="inline-flex items-center gap-1">
                  <User className="h-3 w-3" aria-hidden />
                  {article.persona}
                </span>
              )}
              {article.wordCount && (
                <span className="inline-flex items-center gap-1">
                  <FileText className="h-3 w-3" />
                  {article.wordCount} kelime
                </span>
              )}
              {article.readingTime && (
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {article.readingTime} dk okuma
                </span>
              )}
              <span className="inline-flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {new Date(article.createdAt).toLocaleDateString('tr-TR')}
              </span>
              {article.editorScore != null && (
                <span className="inline-flex items-center gap-1">
                  <Gauge className="h-3 w-3" aria-hidden />
                  <InfoTooltip term="Editor Score">Editör skoru</InfoTooltip>: {article.editorScore}/{editorScoreMax(article)}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {publishing && (
        <PipelineProgress
          title="Yayın işlemi devam ediyor"
          steps={PUBLISH_STEPS}
          running={publishing}
        />
      )}

      {/* QA Gate — yayin oncesi son kontrol raporu */}
      {(() => {
        const qaReport: any = article.qaReport ?? null;
        const blockers: any[] = Array.isArray(qaReport?.blockers) ? qaReport.blockers : [];
        const warnings: any[] = Array.isArray(qaReport?.warnings) ? qaReport.warnings : [];
        const qaStatus: string | null = article.qaStatus ?? null;
        if (!qaStatus && article.status !== 'READY_TO_PUBLISH' && article.status !== 'PUBLISHED') return null;
        const tone = qaStatus === 'BLOCKED' ? 'danger' : qaStatus === 'WARN' ? 'warning' : qaStatus === 'PASS' ? 'success' : 'info';
        const title =
          qaStatus === 'BLOCKED' ? 'Yayın engellendi — makalede çözülmemiş sorunlar var'
          : qaStatus === 'WARN' ? 'QA uyarıları — yayın serbest, gözden geçirmen önerilir'
          : qaStatus === 'PASS' ? 'QA temiz — uydurma atıf, kaynaksız iddia veya yer tutucu yok'
          : 'QA kontrolü henüz yapılmadı';
        return (
          <StatusBanner
            tone={tone}
            title={title}
            action={
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={runQaCheck} disabled={qaRunning}>
                  <RotateCw className={`h-3.5 w-3.5 mr-1.5 ${qaRunning ? 'animate-spin' : ''}`} aria-hidden />
                  {qaRunning ? 'Kontrol ediliyor…' : qaStatus ? 'Yeniden kontrol et' : 'QA kontrolü yap'}
                </Button>
                {qaStatus === 'BLOCKED' && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-danger/40 text-danger hover:bg-danger/10 hover:text-danger"
                    onClick={async () => {
                      // QA engelini asmak geri alinamaz bir yayin — once acik onay. API secimi
                      // aynen uygular (D1): metin YALNIZ secili hedeflerde yayinlanir; secilmeyen
                      // canli kopya eski metinle kalacaksa ayni pencerede soylenir (ikinci pencere yok)
                      const disarida = leftOutLiveConfirm(leftOutFor(selectedTargets));
                      const ok = await confirm({
                        title: 'QA engeline rağmen yayınlansın mı?',
                        description: `Bu makalede ${blockers.length} çözülmemiş sorun var (uydurma atıf, kaynaksız iddia veya yer tutucu olabilir). Yayınlanan içerik seçili hedeflerde herkese açık olur.${disarida ? ` ${disarida.description}` : ''}`,
                        confirmLabel: 'Yine de yayınla',
                        danger: true,
                      });
                      if (ok) publish({ overrideQa: true, leftOutConfirmed: true });
                    }}
                    disabled={publishing || selectedTargets.size === 0}
                  >
                    Yine de yayınla
                  </Button>
                )}
              </div>
            }
          >
            {qaReport?.checkedAt && (
              <p className="text-label">Son kontrol: {new Date(qaReport.checkedAt).toLocaleString('tr-TR')}</p>
            )}
            {blockers.length > 0 && (
              <ul className="mt-2 space-y-1">
                {blockers.map((b: any, i: number) => (
                  <li key={i} className="text-xs text-foreground">
                    <span className="font-semibold text-danger">Engel:</span> {b.detail}
                    {b.excerpt && <span className="text-muted-foreground font-mono"> — &quot;{b.excerpt}&quot;</span>}
                  </li>
                ))}
              </ul>
            )}
            {warnings.length > 0 && (
              <ul className="mt-2 space-y-1">
                {warnings.map((w: any, i: number) => (
                  <li key={i} className="text-xs text-foreground">
                    <span className="font-semibold text-warning">Uyarı:</span> {w.detail}
                    {w.excerpt && <span className="text-muted-foreground font-mono"> — &quot;{w.excerpt}&quot;</span>}
                  </li>
                ))}
              </ul>
            )}
          </StatusBanner>
        );
      })()}

      {/* ENH#6 — Stuck page banner: bu makale Google'da #4-15 araliginda kaldi. Etki metni
          dogrulanmamis "24-48 saat" yerine olculen sey (api stuck_page_recovered bildirimiyle ayni);
          yerinde guncellenemeyen hedefte kurtarma oneri kaydeder (stuck-page-recovery.service.ts) */}
      {stuckPage && (
        <StatusBanner
          tone="warning"
          title={`Bu sayfa Google'da ${Math.round(stuckPage.position)}. sırada — kurtarmaya uygun.`}
          action={
            <Button size="sm" variant="outline" asChild>
              <Link href={siteHref(siteId, 'stuckPages') as any}>
                <Wrench className="h-3.5 w-3.5 mr-1.5" aria-hidden /> Takılı sayfalar
              </Link>
            </Button>
          }
        >
          Son 30 gün: {stuckPage.impressions.toLocaleString('tr-TR')} gösterim, TO %{(stuckPage.ctr * 100).toFixed(2)}.
          AI ile cümle düzeyinde onarım başlığı ve yapıyı bozmaz; etkisi 30 gün sonra otomatik ölçülür. RanksUp yazıyı takılı adreste güvenle güncelleyemezse (yazı sitende değiştirilmiş, kayıtlı adres takılı adresle eşleşmiyor ya da yayın hedefi yazıyı yerinde güncelleyemiyor) değişiklikler öneri olarak kaydedilir.
        </StatusBanner>
      )}

      <Card>
        <CardContent className="p-5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h3 className="font-semibold mb-1">Yayınla</h3>
              <p className="text-xs text-muted-foreground">
                {targets.length === 0
                  ? 'Henüz yayın hedefi yok. Önce site ayarlarından bir hedef ekle.'
                  : `${selectedTargets.size} / ${targets.length} hedef seçildi`}
              </p>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button variant="outline" onClick={downloadMarkdown} disabled={!article.bodyMd}>
                <Download className="h-4 w-4 mr-2" /> Markdown
              </Button>
              <Button variant="outline" onClick={downloadHtml} disabled={!renderedHtml}>
                <Download className="h-4 w-4 mr-2" /> HTML
              </Button>
              {targets.length === 0 ? (
                <Button asChild>
                  <Link href={siteHref(siteId, 'publishTargets') as any}>+ Yayın Hedefi Ekle</Link>
                </Button>
              ) : (
                <Button onClick={() => publish()} disabled={publishing || selectedTargets.size === 0}>
                  <Send className="h-4 w-4 mr-2" />
                  {publishing ? 'Yayınlanıyor…' : 'Yayınla'}
                </Button>
              )}
            </div>
          </div>

          {targets.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {targets.map((t) => {
                const checked = selectedTargets.has(t.id);
                // Yazi bu hedefte yayinda: dugme kapatilirsa (D1) bu yayin oraya yazmaz — uyari asagida
                const yayinda = siteLiveTargetIds.has(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={checked}
                    onClick={() => toggleTarget(t.id)}
                    disabled={!t.isActive}
                    title={yayinda && t.isActive ? 'Yazı bu hedefte yayında. Seçimi kaldırırsan bu yayın oraya yazmaz.' : undefined}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors border ${
                      checked
                        ? 'bg-brand text-white border-brand'
                        : 'bg-card border-border hover:border-brand/50'
                    } ${!t.isActive ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {t.name} <span className="opacity-75">· {targetTypeLabel(t.type)}</span>
                    {yayinda && <span className="ml-1 opacity-75">(yayında)</span>}
                    {t.isDefault && <span className="ml-1 opacity-75">(varsayılan)</span>}
                    {!t.isActive && <span className="ml-1 opacity-75">(pasif)</span>}
                  </button>
                );
              })}
            </div>
          )}
          {selectionWarnings.length > 0 && (
            <div className="mt-3 rounded-md border border-warning/30 bg-warning/5 p-3 space-y-1" role="note">
              {selectionWarnings.map((w) => (
                <p key={w} className="text-xs text-foreground">{w}</p>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {publishedTo.length > 0 && (
        <Card>
          <CardHeader>
            <h3 className="font-semibold">Yayın Geçmişi</h3>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y">
              {/* Kayit PublishResult bicimi (externalUrl, publishedAt/updatedAt) — lib/publish-result.ts */}
              {publishedTo.map((entry, i) => {
                const p = publishedEntryView(entry, (id) => targets.find((t) => t.id === id)?.name);
                if (!p) return null;
                const targetId = p.targetId;
                const busy = !!targetId && entryBusy === targetId;
                const target = targetId ? targets.find((t) => t.id === targetId) : undefined;
                // Bu oturumdaki son yayinda C2 ile atlanan hedef: API metni kesin neden
                const memo = targetId ? remoteSkips[targetId] : undefined;
                // Eylem bloku: elle guncelleme bekleyen kayit ya da az once C2 ile atlanan
                // hedef. Cop kutusundaki (C3) ya da hedefte artik bulunmayan (D3) kopya canli
                // degil — blok yok.
                const showBlock = !!targetId && !p.trashedAt && !p.missingAt && (p.manualUpdatePending || !!memo);
                // Notun nedeni hedef satirindan ve kayittan (lib/manual-update.ts); eskiden
                // her durumda "yerinde guncelleyemiyor" deniyordu — WordPress icin yanlis
                const reason = manualUpdateReason(entry, target, { targetsKnown: !targetsError, articleSlug: article.slug });
                const note = memo ? memo.text : manualUpdateNote(reason, target?.type ?? (entry as { targetType?: string })?.targetType);
                // Isaretsiz kayitta da: yalniz yeni kayit acan hedefte silinen yaziyi RanksUp
                // goremez, kayit unutulmadan oraya yeniden yayin yapilamaz (canForgetEntry)
                const forgettable = !!targetId && !showBlock && canForgetEntry(entry, target);
                return (
                  <li key={`${targetId ?? 'kayit'}-${i}`} className="p-4 space-y-3 text-sm">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <div className="font-medium flex flex-wrap items-center gap-2">
                          {p.name}
                          {p.manualUpdatePending && <Badge variant="warning">Eski sürüm yayında</Badge>}
                          {/* Gecmis zaman: WordPress cop kutusunu varsayilan 30 gunde bosaltir; rozet
                              simdiki hali iddia etmez (alttaki satir ne zaman goruldugunu soyler) */}
                          {p.trashedAt && <Badge variant="secondary">Çöp kutusunda görüldü</Badge>}
                          {p.missingAt && <Badge variant="secondary">Bulunamadı</Badge>}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {p.publishedAt ? new Date(p.publishedAt).toLocaleString('tr-TR') : ''}
                          {p.updatedAt ? ` · güncellendi: ${new Date(p.updatedAt).toLocaleString('tr-TR')}` : ''}
                        </div>
                      </div>
                      {p.url && (
                        <a
                          href={p.url}
                          target="_blank"
                          rel="noopener"
                          className="text-brand hover:underline inline-flex items-center gap-1 text-xs break-all"
                        >
                          {p.url} <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                      )}
                    </div>
                    {p.trashedAt && (
                      <p className="text-xs text-muted-foreground">
                        Bu kopya {new Date(p.trashedAt).toLocaleString('tr-TR')} tarihinde WordPress’in çöp kutusunda bulundu; RanksUp onu yayında saymıyor.
                      </p>
                    )}
                    {/* Sozlesme D3: yazi hedefte artik yok (404/410) ve otomasyon onu yeniden acmadi;
                        musteri bu hedefi secip yayinlarsa yazi orada yeniden olusturulur (D2). Kopyayi
                        gunluk canlilik denetimi dusurduyse not bunu ve WordPress'te taslak / cop kutusu
                        ihtimalini soyler (lib/manual-update.ts missingCopyNote) */}
                    {p.missingAt && (
                      <p className="text-xs text-muted-foreground">
                        {missingCopyNote(entry, {
                          when: new Date(p.missingAt).toLocaleString('tr-TR'),
                          targetType: target?.type ?? (entry as { targetType?: string })?.targetType,
                        })}
                      </p>
                    )}
                    {/* Yeni metin bu hedefe yazilmadi: eski metin yayinda. Not ve eylemler nedene
                        gore (lib/manual-update.ts): RanksUp simdi yazabiliyorsa yeniden yayin, az
                        once WordPress'te elle duzenleme bulunduysa onayli uzerine yazma, digerlerinde
                        musteri metni yapistirip isaretler ya da silinen yazinin kaydini unutur. */}
                    {showBlock && targetId && (
                      <div className="rounded-md border border-warning/30 bg-warning/5 p-3 space-y-2">
                        <p className="text-xs text-foreground">{note}</p>
                        {p.manualUpdatePending && p.manualUpdatePendingSince && (
                          <p className="text-label text-muted-foreground">
                            {new Date(p.manualUpdatePendingSince).toLocaleString('tr-TR')} tarihinden beri bekliyor.
                          </p>
                        )}
                        <div className="flex flex-wrap gap-2">
                          {memo?.skipped === 'live_entry_edited' && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-danger/40 text-danger hover:bg-danger/10 hover:text-danger"
                              onClick={() => overwriteRemote(targetId, p.name, memo.overrideQa)}
                              disabled={publishing || busy}
                            >
                              WordPress’teki değişikliklerin üzerine yaz
                            </Button>
                          )}
                          {!memo && reason === 'republishable' && (
                            <Button size="sm" onClick={() => publish({ targetIds: [targetId] })} disabled={publishing || busy}>
                              <Send className="h-3.5 w-3.5" aria-hidden /> Bu hedefe yeniden yayınla
                            </Button>
                          )}
                          {!memo && reason === 'target_inactive' && (
                            <Button size="sm" variant="outline" asChild>
                              <Link href={siteHref(siteId, 'publishTargets') as any}>Yayın hedeflerine git</Link>
                            </Button>
                          )}
                          <Button size="sm" variant="outline" onClick={copyCurrentText} disabled={!article.bodyMd}>
                            <Copy className="h-3.5 w-3.5" aria-hidden /> Güncel metni kopyala
                          </Button>
                          {p.manualUpdatePending && (
                            <Button
                              size="sm"
                              variant={memo || reason === 'republishable' ? 'outline' : 'default'}
                              onClick={() => markEntryUpdated(targetId, p.name)}
                              disabled={busy}
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Elle güncelledim
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-danger/40 text-danger hover:bg-danger/10 hover:text-danger"
                            onClick={() => forgetEntry(targetId, p.name)}
                            disabled={busy}
                          >
                            Bu hedefteki kaydı unut
                          </Button>
                        </div>
                      </div>
                    )}
                    {forgettable && targetId && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs text-muted-foreground hover:text-danger"
                        onClick={() => forgetEntry(targetId, p.name)}
                        disabled={busy}
                        title="Yazıyı bu hedefin kendi panelinden sildiysen: RanksUp kaydı unutur, bu hedefe sonraki yayın yeni bir yazı açar."
                      >
                        Bu hedefteki kaydı unut
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="content" className="space-y-4">
        <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
          <TabsList className="w-max sm:w-auto">
            <TabsTrigger value="content">
              <FileText className="h-3.5 w-3.5 mr-1.5" aria-hidden /> İçerik
            </TabsTrigger>
            <TabsTrigger value="meta">
              <Settings2 className="h-3.5 w-3.5 mr-1.5" aria-hidden /> Meta + SEO
            </TabsTrigger>
            <TabsTrigger value="faq">
              <HelpCircle className="h-3.5 w-3.5 mr-1.5" aria-hidden /> SSS ({fallbackFaqs.length})
            </TabsTrigger>
            <TabsTrigger value="media">
              <ImageIcon className="h-3.5 w-3.5 mr-1.5" aria-hidden /> Görseller
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="content" className="space-y-4">
          {article.heroImageUrl && (
            <Card>
              <CardContent className="p-0 overflow-hidden rounded-md">
                <img src={article.heroImageUrl} alt={article.title} className="w-full max-h-96 object-cover" />
              </CardContent>
            </Card>
          )}
          {renderedHtml ? (
            <Card>
              <CardContent className="p-4 sm:p-8">
                <div
                  className="prose prose-sm sm:prose dark:prose-invert max-w-none prose-headings:scroll-mt-20 prose-h2:mt-6 sm:prose-h2:mt-8 prose-img:rounded-lg break-words"
                  dangerouslySetInnerHTML={{ __html: renderedHtml }}
                />
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                İçerik henüz oluşmamış. Pipeline çalışıyor olabilir.
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="meta" className="space-y-4">
          <Card>
            <CardContent className="p-6 space-y-4 text-sm">
              <Field label="Slug" value={article.slug} mono />
              <Field label="Meta Title" value={article.metaTitle ?? article.title} />
              <Field label="Meta Description" value={article.metaDescription} multiline />
              <Field label="Kategori" value={article.category} />
              <Field label="Pillar" value={article.pillar} mono />
              <Field label="Dil" value={article.language} />
              <Field label="Topic (orijinal)" value={article.topic} multiline />
              {article.totalCost && (
                <Field label="AI Maliyeti" value={`$${Number(article.totalCost).toFixed(4)}`} mono />
              )}
            </CardContent>
          </Card>

          {article.schemaMarkup && (
            <Card>
              <CardHeader>
                <h3 className="font-semibold">Schema.org Markup (JSON-LD)</h3>
              </CardHeader>
              <CardContent>
                <pre className="text-xs bg-muted p-3 rounded overflow-x-auto">
                  {JSON.stringify(article.schemaMarkup, null, 2)}
                </pre>
              </CardContent>
            </Card>
          )}

          {(article.internalLinks as any[])?.length > 0 && (
            <Card>
              <CardHeader>
                <h3 className="font-semibold">İç Linkler ({(article.internalLinks as any[]).length})</h3>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1.5 text-sm">
                  {(article.internalLinks as any[]).map((l, i) => (
                    <li key={i} className="flex items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">{l.url}</span>
                      <span className="text-muted-foreground">→</span>
                      <span>{l.anchor}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="faq">
          {fallbackFaqs.length > 0 ? (
            <div className="space-y-3">
              {fallbackFaqs.map((f: any, i: number) => (
                <Card key={i}>
                  <CardContent className="p-4">
                    <h4 className="font-semibold text-sm mb-2">Q: {f.q ?? f.question}</h4>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{f.a ?? f.answer}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground text-sm">
                SSS üretilmemiş.
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="media">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {article.heroImageUrl && (
              <Card>
                <CardContent className="p-3">
                  <img src={article.heroImageUrl} alt="Hero" className="w-full rounded" />
                  <p className="text-xs text-muted-foreground mt-2">Hero görseli</p>
                </CardContent>
              </Card>
            )}
            {((article.inlineImages as any[]) ?? []).map((img, i) => (
              <Card key={i}>
                <CardContent className="p-3">
                  <img src={img.url} alt={img.alt} className="w-full rounded" />
                  <p className="text-xs text-muted-foreground mt-2">{img.alt ?? `Inline ${i + 1}`}</p>
                </CardContent>
              </Card>
            ))}
            {!article.heroImageUrl && ((article.inlineImages as any[]) ?? []).length === 0 && (
              <Card className="md:col-span-2">
                <CardContent className="p-8 text-center text-muted-foreground text-sm">
                  Görsel üretilmemiş.
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Multi-Modal Panel — Audio/Video/Yayın/Çeviri */}
    </div>
  );
}

function Field({
  label,
  value,
  mono,
  multiline,
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
  multiline?: boolean;
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <div
        className={`${mono ? 'font-mono text-xs' : ''} ${
          multiline ? 'whitespace-pre-wrap' : ''
        } text-foreground/90`}
      >
        {value || <span className="text-muted-foreground italic">—</span>}
      </div>
    </div>
  );
}
