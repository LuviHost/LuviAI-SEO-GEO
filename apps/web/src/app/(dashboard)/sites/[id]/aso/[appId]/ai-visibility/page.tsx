'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  ArrowLeft, Smartphone, Sparkles, Plus, Loader2, Play, Trash2,
  Check, X, Wand2, PackageOpen, Copy,
} from 'lucide-react';

/**
 * App AI Görünürlük — App Prompt Lab (GEO ⨉ ASO, rakipte yok).
 *
 * "en iyi X uygulaması" sorusunu 7 AI sağlayıcıya sorar:
 * uygulama önerildi mi, store linki verildi mi, rakip appler kim?
 * + Review → İçerik Paketi (What's New + FAQ + blog konusu).
 */

export default function AppAiVisibilityPage() {
  const params = useParams();
  const siteId = params.id as string;
  const appId = params.appId as string;

  const [prompts, setPrompts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [newText, setNewText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [runResult, setRunResult] = useState<any>(null);
  const [pack, setPack] = useState<any>(null);
  const [packLoading, setPackLoading] = useState(false);

  const load = async () => {
    try {
      setPrompts(await api.listAppPrompts(siteId, appId));
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [siteId, appId]);

  const add = async () => {
    if (newText.trim().length < 5) return;
    try {
      await api.addAppPrompt(siteId, appId, newText.trim());
      setNewText('');
      await load();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const suggest = async () => {
    setSuggesting(true);
    try {
      const res = await api.suggestAppPrompts(siteId, appId);
      toast.success(`${res.created} yeni soru eklendi`);
      await load();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSuggesting(false);
    }
  };

  const run = async (promptId: string) => {
    setBusy(promptId);
    setRunResult(null);
    try {
      const res = await api.runAppPrompt(siteId, appId, promptId);
      setRunResult(res);
      toast.success(`Ölçüm bitti: ${res.summary.mentioned}/${res.summary.total} sağlayıcı uygulamayı andı`);
      await load();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async (promptId: string) => {
    try {
      await api.deleteAppPrompt(siteId, appId, promptId);
      await load();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const buildPack = async () => {
    setPackLoading(true);
    try {
      const res = await api.buildReviewContentPack(siteId, appId);
      setPack(res);
      toast.success('İçerik paketi hazır');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setPackLoading(false);
    }
  };

  const copyText = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(
      () => toast.success(`${label} kopyalandı`),
      () => toast.error('Kopyalanamadı'),
    );
  };

  return (
    <div className="space-y-5">
      <div>
        <Link href={`/sites/${siteId}/aso` as any} className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" /> ASO
        </Link>
        <div className="flex items-start gap-3 mt-3">
          <div className="h-10 w-10 rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-400 grid place-items-center">
            <Smartphone className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-2xl font-bold">App AI Görünürlük</h2>
            <p className="text-sm text-muted-foreground">
              Kullanıcılar app tavsiyesini artık ChatGPT'ye soruyor. "En iyi X uygulaması" sorularında <strong>senin app'in</strong> öneriliyor mu — 7 AI sağlayıcıda ölç.
            </p>
          </div>
        </div>
      </div>

      {/* Soru ekleme */}
      <Card>
        <CardContent className="p-3 flex items-center gap-2 flex-wrap">
          <input
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder='Soru ekle… (ör. "en iyi ASO takip uygulaması hangisi?")'
            className="flex-1 min-w-[220px] bg-transparent outline-none text-sm px-2 py-1.5"
          />
          <Button size="sm" onClick={add} disabled={newText.trim().length < 5}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Ekle
          </Button>
          <Button size="sm" variant="outline" onClick={suggest} disabled={suggesting}>
            {suggesting ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5 mr-1.5" />}
            AI Önersin
          </Button>
        </CardContent>
      </Card>

      {/* Prompt listesi */}
      {loading ? (
        <div className="text-sm text-muted-foreground p-6 text-center">Yükleniyor…</div>
      ) : prompts.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center space-y-3">
            <Sparkles className="h-10 w-10 mx-auto text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">Henüz izlenen soru yok. "AI Önersin" ile kategoriye özel 8 soru üret.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {prompts.map((p) => (
            <Card key={p.id}>
              <CardContent className="p-3.5 flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-[200px]">
                  <div className="text-sm font-medium">"{p.text}"</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {p.lastRunAt
                      ? <>Son ölçüm: {new Date(p.lastRunAt).toLocaleDateString('tr-TR')} · store linki {p.lastLinkedCount}/{p.lastTotalCount}</>
                      : 'Henüz ölçülmedi'}
                    {p.source === 'suggested' && <Badge variant="outline" className="ml-2 text-[9px]">AI önerdi</Badge>}
                  </div>
                </div>
                {p.lastScore !== null && (
                  <Badge variant="outline" className={cn(
                    'text-[10px]',
                    p.lastScore >= 50 ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30'
                    : p.lastScore > 0 ? 'bg-amber-500/10 text-amber-600 border-amber-500/30'
                    : 'bg-red-500/10 text-red-600 border-red-500/30',
                  )}>
                    %{p.lastScore}
                  </Badge>
                )}
                <div className="flex gap-1.5">
                  <Button size="sm" onClick={() => run(p.id)} disabled={busy !== null}>
                    {busy === p.id ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Play className="h-3.5 w-3.5 mr-1" />}
                    Ölç
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(p.id)}>
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Son ölçüm sonucu */}
      {runResult && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="text-sm font-semibold">
              Ölçüm sonucu — "{runResult.text}"
              <span className="text-muted-foreground font-normal ml-2 text-xs">
                {runResult.summary.mentioned}/{runResult.summary.total} anıldı · {runResult.summary.storeLinked}/{runResult.summary.total} store linki
              </span>
            </div>
            <div className="grid md:grid-cols-2 gap-2">
              {runResult.providers.map((pr: any) => (
                <div key={pr.provider} className={cn('rounded-lg border p-3', !pr.available && 'opacity-50')}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-semibold">{pr.label}</span>
                    <div className="flex gap-1.5">
                      <Badge variant="outline" className={cn('text-[9px]', pr.appMentioned ? 'bg-emerald-500/10 text-emerald-600' : 'bg-red-500/10 text-red-600')}>
                        {pr.appMentioned ? <Check className="h-2.5 w-2.5 mr-0.5" /> : <X className="h-2.5 w-2.5 mr-0.5" />} anıldı
                      </Badge>
                      <Badge variant="outline" className={cn('text-[9px]', pr.storeLinked ? 'bg-emerald-500/10 text-emerald-600' : 'bg-zinc-500/10 text-zinc-500')}>
                        {pr.storeLinked ? <Check className="h-2.5 w-2.5 mr-0.5" /> : <X className="h-2.5 w-2.5 mr-0.5" />} link
                      </Badge>
                    </div>
                  </div>
                  {pr.available
                    ? <p className="text-[11px] text-muted-foreground line-clamp-4">{pr.excerpt}</p>
                    : <p className="text-[11px] text-muted-foreground">Kullanılamadı: {pr.reason ?? 'anahtar yok'}</p>}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Review → İçerik Paketi */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <div className="text-sm font-semibold flex items-center gap-2">
                <PackageOpen className="h-4 w-4 text-brand" /> Review → İçerik Paketi
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Olumsuz yorum temalarından What's New metni + web FAQ + blog konusu üret. Blog konuları İçerik Fırsatları'na düşer.
              </p>
            </div>
            <Button size="sm" onClick={buildPack} disabled={packLoading}>
              {packLoading ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5 mr-1.5" />}
              Paket Üret
            </Button>
          </div>

          {pack && (
            <div className="space-y-3 pt-2 border-t">
              <div className="text-[11px] text-muted-foreground">
                {pack.basedOn.negativeCount} yorum · temalar: {pack.basedOn.themes.map((t: any) => `${t.theme}(${t.count})`).join(', ') || '—'}
              </div>

              <div className="rounded-lg bg-muted/40 p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">What's New (store)</span>
                  <Button size="sm" variant="ghost" onClick={() => copyText(pack.whatsNew, "What's New")}>
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
                <p className="text-xs whitespace-pre-wrap">{pack.whatsNew}</p>
              </div>

              {pack.faqs.length > 0 && (
                <div className="rounded-lg bg-muted/40 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Web FAQ (FAQPage schema için)</span>
                    <Button size="sm" variant="ghost" onClick={() => copyText(pack.faqs.map((f: any) => `S: ${f.q}\nC: ${f.a}`).join('\n\n'), 'FAQ')}>
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                  {pack.faqs.map((f: any, i: number) => (
                    <div key={i} className="text-xs">
                      <div className="font-semibold">{f.q}</div>
                      <div className="text-muted-foreground">{f.a}</div>
                    </div>
                  ))}
                </div>
              )}

              {pack.blogTopics.length > 0 && (
                <div className="rounded-lg bg-muted/40 p-3 space-y-1.5">
                  <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Blog Konuları → İçerik Fırsatları</span>
                  {pack.blogTopics.map((t: any, i: number) => (
                    <div key={i} className="text-xs flex items-center gap-2">
                      <Sparkles className="h-3 w-3 text-brand shrink-0" />
                      <span className="flex-1">{t.title}</span>
                      {t.opportunityId && (
                        <Link href={`/sites/${siteId}/opportunities` as any} className="text-brand underline text-[10px] shrink-0">
                          Fırsatlarda →
                        </Link>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
