'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { marked } from 'marked';
import { toast } from 'sonner';
import { ArrowLeft, Download, Send, ExternalLink, Calendar, Clock, FileText, ImageIcon } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { PipelineProgress } from '@/components/pipeline-progress';

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
  return marked.parse(stripped, { async: false }) as string;
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

const PUBLISH_STEPS = [
  { label: 'Yayın hedefine bağlanılıyor', sublabel: 'Credentials decrypt + auth', durationMs: 4000 },
  { label: 'İçerik yükleniyor', sublabel: 'Markdown/HTML + görseller transfer', durationMs: 12000 },
  { label: 'Görseller işleniyor', sublabel: 'Hero + inline görsel optimizasyon', durationMs: 8000 },
  { label: 'Yayın doğrulaması', sublabel: 'URL erişilebilir mi kontrol', durationMs: 4000 },
];

export default function ArticleDetailPage() {
  const params = useParams();
  const siteId = params.id as string;
  const articleId = params.articleId as string;

  const [article, setArticle] = useState<any>(null);
  const [targets, setTargets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [selectedTargets, setSelectedTargets] = useState<Set<string>>(new Set());

  const refresh = async () => {
    try {
      const [a, t] = await Promise.all([
        api.getArticle(siteId, articleId),
        api.listPublishTargets(siteId).catch(() => []),
      ]);
      setArticle(a);
      setTargets(t);
      // Default target'ı önceden seç
      const defaultTarget = t.find((x: any) => x.isDefault);
      if (defaultTarget) setSelectedTargets(new Set([defaultTarget.id]));
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, [siteId, articleId]);

  // Pipeline DB'ye bodyHtml/faqs yazmıyor — markdown'dan client-side türet.
  const renderedHtml = useMemo<string>(() => {
    if (article?.bodyHtml) return article.bodyHtml as string;
    if (article?.bodyMd) return renderMarkdownToHtml(article.bodyMd as string);
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
<div class="luvi-footer">LuviAI tarafından üretildi · <a href="https://ai.luvihost.com">ai.luvihost.com</a></div>
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
    setSelectedTargets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const publish = async () => {
    if (selectedTargets.size === 0) {
      toast.error('En az bir yayın hedefi seç');
      return;
    }
    setPublishing(true);
    try {
      await api.publishArticle(siteId, articleId, Array.from(selectedTargets));
      toast.success('Yayın işi kuyruğa alındı, birkaç saniyede tamamlanacak');
      // 25 saniye sonra refresh — publishedTo dolacak
      setTimeout(() => {
        refresh();
        setPublishing(false);
      }, 28000);
    } catch (err: any) {
      toast.error(err.message);
      setPublishing(false);
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
            <Link href={`/sites/${siteId}` as any}>← Site detayına dön</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const publishedTo = (article.publishedTo as any[]) ?? [];

  return (
    <div className="space-y-5 sm:space-y-6 max-w-5xl mx-auto">
      <div>
        <Link
          href={`/sites/${siteId}` as any}
          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <ArrowLeft className="h-4 w-4" />
          {article.site?.name ?? 'Site'} dashboard
        </Link>
        <div className="flex items-start justify-between gap-4 flex-wrap mt-3">
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl sm:text-3xl font-bold leading-tight">{article.title}</h1>
            <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
              <Badge variant={STATUS_VARIANT[article.status] ?? 'outline'}>{article.status}</Badge>
              {article.persona && <span>👤 {article.persona}</span>}
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
                <span>📊 Editör skoru: {article.editorScore}/100</span>
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

      <Card>
        <CardContent className="p-5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="font-semibold mb-1">Yayınla</h2>
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
                  <Link href={`/sites/${siteId}?tab=settings` as any}>+ Yayın Hedefi Ekle</Link>
                </Button>
              ) : (
                <Button onClick={publish} disabled={publishing || selectedTargets.size === 0}>
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
                return (
                  <button
                    key={t.id}
                    onClick={() => toggleTarget(t.id)}
                    disabled={!t.isActive}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors border ${
                      checked
                        ? 'bg-brand text-white border-brand'
                        : 'bg-card border-border hover:border-brand/50'
                    } ${!t.isActive ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {t.name} <span className="opacity-75">· {t.type}</span>
                    {t.isDefault && <span className="ml-1 opacity-75">(varsayılan)</span>}
                  </button>
                );
              })}
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
              {publishedTo.map((p, i) => (
                <li key={i} className="p-4 flex items-center justify-between gap-3 text-sm">
                  <div>
                    <div className="font-medium">{p.targetName ?? p.targetId}</div>
                    <div className="text-xs text-muted-foreground">
                      {p.publishedAt ? new Date(p.publishedAt).toLocaleString('tr-TR') : ''}
                    </div>
                  </div>
                  {p.url && (
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noopener"
                      className="text-brand hover:underline inline-flex items-center gap-1 text-xs"
                    >
                      {p.url} <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="content" className="space-y-4">
        <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
          <TabsList className="w-max sm:w-auto">
            <TabsTrigger value="content">📄 İçerik</TabsTrigger>
            <TabsTrigger value="meta">🔧 Meta + SEO</TabsTrigger>
            <TabsTrigger value="faq">❓ FAQ ({fallbackFaqs.length})</TabsTrigger>
            <TabsTrigger value="media">
              <ImageIcon className="h-3.5 w-3.5 mr-1.5" /> Görseller
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
                FAQ üretilmemiş.
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
      <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{label}</div>
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
