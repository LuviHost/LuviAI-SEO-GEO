'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';
import { LocaleSwitch } from '@/components/locale-switch';
import { VendorLogo } from '@/components/vendor-logo';
import {
  Sparkles, Globe, Calendar, Bot, FileText, BarChart3, CheckCircle2,
  ArrowRight, Send, Search, Layers, Clock, ShieldCheck, Repeat,
  Brain, Target, Mail, Image as ImageIcon, MessageSquare, TrendingUp,
} from 'lucide-react';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground antialiased">
      {/* ─── NAV ──────────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-bold text-lg">
            <span className="bg-gradient-to-br from-orange-500 to-orange-700 text-white rounded-lg w-8 h-8 grid place-items-center">
              <Sparkles className="h-4 w-4" />
            </span>
            LuviAI
          </Link>
          <div className="hidden md:flex items-center gap-6 text-sm">
            <a href="#features" className="hover:text-orange-600 transition-colors">Özellikler</a>
            <a href="#how" className="hover:text-orange-600 transition-colors">Nasıl Çalışır</a>
            <a href="#ai-citation" className="hover:text-orange-600 transition-colors">AI Görünürlük</a>
            <a href="#pricing" className="hover:text-orange-600 transition-colors">Fiyatlar</a>
            <a href="#faq" className="hover:text-orange-600 transition-colors">SSS</a>
          </div>
          <div className="flex items-center gap-2">
            <LocaleSwitch />
            <ThemeToggle />
            <Link href="/signin" className="hidden sm:inline-block">
              <Button variant="ghost" size="sm">Giriş</Button>
            </Link>
            <Link href="/signin?signup=1">
              <Button size="sm" className="bg-gradient-to-br from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white">
                Ücretsiz başla
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* ─── HERO ─────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        {/* gradient blobs */}
        <div className="absolute inset-0 -z-10">
          <div className="absolute top-20 -left-20 w-96 h-96 bg-orange-500/20 rounded-full blur-3xl" />
          <div className="absolute top-40 -right-20 w-96 h-96 bg-purple-500/20 rounded-full blur-3xl" />
          <div className="absolute bottom-0 left-1/2 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl" />
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 sm:py-28 lg:py-32">
          <div className="max-w-4xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-500/10 border border-orange-500/20 text-orange-600 text-xs font-semibold mb-6">
              <Sparkles className="h-3 w-3" />
              <span>Yeni: AI Citation Tracking + GEO Optimizer canlıda</span>
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-7xl font-extrabold tracking-tight leading-[1.05]">
              SEO'yu otomatikleştir,
              <br />
              <span className="bg-gradient-to-r from-orange-500 via-orange-600 to-red-600 bg-clip-text text-transparent">
                AI motorlarında görün.
              </span>
            </h1>

            <p className="mt-6 text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              Tek panelden site denetimi, AI içerik üretimi, sosyal medya yayını ve reklam denetimi.
              <span className="text-foreground font-semibold"> ChatGPT, Claude, Gemini ve Perplexity</span>'nin senden bahsetmesi için optimize et.
            </p>

            <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center items-center">
              <Link href="/signin?signup=1">
                <Button size="lg" className="bg-gradient-to-br from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white text-base px-8 h-12 shadow-lg shadow-orange-500/25">
                  Ücretsiz başla — 14 gün
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <a href="#how">
                <Button size="lg" variant="outline" className="text-base px-8 h-12">
                  Nasıl çalışır?
                </Button>
              </a>
            </div>

            <p className="mt-6 text-xs text-muted-foreground">
              Kredi kartı gerekmez · 14 gün ücretsiz · PayTR ile güvenli ödeme
            </p>

            {/* Hero stats */}
            <div className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-6 max-w-3xl mx-auto">
              {[
                { num: '6', label: 'AI motoru destekli' },
                { num: '10+', label: 'Sosyal platform' },
                { num: '14', label: 'SEO check noktası' },
                { num: '< 5dk', label: 'İlk audit süresi' },
              ].map((s) => (
                <div key={s.label}>
                  <div className="text-2xl md:text-3xl font-extrabold text-orange-600">{s.num}</div>
                  <div className="text-xs text-muted-foreground mt-1">{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ─── AI CITATION SHOWCASE ────────────────────────────────── */}
      <section id="ai-citation" className="border-t bg-muted/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 lg:py-20">
          <div className="text-center mb-10">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-600 dark:text-purple-400 text-xs font-semibold mb-4">
              <Brain className="h-3 w-3" /> GEO + AEO + LLMO
            </div>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight">
              AI motorları senden mi bahsediyor?
            </h2>
            <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">
              LuviAI <strong>6 farklı AI motorunda</strong> sitenin görünürlüğünü gerçek sorgularla test eder.
              Atıf yoksa içeriği nasıl düzelteceğini söyler.
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 max-w-4xl mx-auto">
            {([
              { v: 'anthropic',  label: 'Claude' },
              { v: 'chatgpt',    label: 'ChatGPT' },
              { v: 'gemini',     label: 'Gemini' },
              { v: 'perplexity', label: 'Perplexity' },
              { v: 'grok',       label: 'Grok' },
              { v: 'deepseek',   label: 'DeepSeek' },
            ] as const).map(({ v, label }) => (
              <div key={v} className="flex flex-col items-center gap-2 p-4 rounded-xl bg-background border hover:border-orange-500/30 hover:shadow-md transition-all">
                <VendorLogo name={v} size={36} />
                <span className="text-xs font-medium">{label}</span>
              </div>
            ))}
          </div>

          <div className="mt-10 max-w-2xl mx-auto bg-background border rounded-2xl p-6 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="shrink-0 w-10 h-10 rounded-lg bg-emerald-500/10 text-emerald-600 grid place-items-center">
                <Search className="h-5 w-5" />
              </div>
              <div className="flex-1 text-sm">
                <p className="font-semibold mb-1">Örnek sorgu</p>
                <p className="text-muted-foreground italic">"Türkiye'de en iyi AI SEO platformu hangisi?"</p>
                <p className="mt-3 text-xs">
                  → <strong>LuviAI</strong>: Her hafta otomatik tarama, görünürlük skoru, eksik içerik için
                  <span className="text-orange-600"> FAQ + DefinedTerm schema önerileri</span>.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── FEATURES ─────────────────────────────────────────────── */}
      <section id="features" className="border-t">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 lg:py-24">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight">
              Tek panel, dört ekip
            </h2>
            <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">
              SEO, içerik, sosyal medya, reklam: hepsi için ayrı 4 ekip tutmak yerine LuviAI'nin
              <strong> 14 servisi</strong> bunu tek başına yapar.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <FeatureCard
              icon={<Bot className="h-6 w-6" />}
              iconBg="bg-orange-500/10 text-orange-600"
              title="AI Site Denetimi"
              desc="14 SEO check + GEO + AI Citation. Düşük skorlu sayfalar için otomatik düzeltme önerileri (FAQ, schema, meta)."
            />
            <FeatureCard
              icon={<Brain className="h-6 w-6" />}
              iconBg="bg-purple-500/10 text-purple-600"
              title="Brain Generator"
              desc="Site içeriğinden marka sesi, persona, rakip, pillar topic, AEO/GEO sorguları otomatik üretir."
            />
            <FeatureCard
              icon={<FileText className="h-6 w-6" />}
              iconBg="bg-blue-500/10 text-blue-600"
              title="AI Makale Üretimi"
              desc="1800-2500 kelime, marka sesinde, kaynaklı, SEO uyumlu. WordPress / Webflow / Ghost / cPanel'e otomatik yayın."
            />
            <FeatureCard
              icon={<Send className="h-6 w-6" />}
              iconBg="bg-violet-500/10 text-violet-600"
              title="Sosyal Medya Otomasyon"
              desc="10+ platform: X, LinkedIn, Instagram, Facebook, TikTok, YouTube, Threads, Bluesky. Her makaleden draft + medya + zamanlama."
            />
            <FeatureCard
              icon={<Target className="h-6 w-6" />}
              iconBg="bg-emerald-500/10 text-emerald-600"
              title="Reklam Denetimi"
              desc="Google Ads + Meta Ads kampanyalarına 0-100 skor, optimizasyon önerileri, A/B test planlayıcı."
            />
            <FeatureCard
              icon={<ImageIcon className="h-6 w-6" />}
              iconBg="bg-pink-500/10 text-pink-600"
              title="ASO Studio"
              desc="App Store screenshot stüdyosu — 12 phone frame, AI background, glass / reflection / gradient text, auto-resize per store."
            />
            <FeatureCard
              icon={<MessageSquare className="h-6 w-6" />}
              iconBg="bg-cyan-500/10 text-cyan-600"
              title="Social Inbox"
              desc="DM + mention + yorum tek panelde. AI sentiment, otomatik cevap şablonu, arşivle / çöz aksiyonu."
            />
            <FeatureCard
              icon={<Calendar className="h-6 w-6" />}
              iconBg="bg-amber-500/10 text-amber-600"
              title="Fikir Panosu"
              desc="Kanban: Unassigned → ToDo → In Progress → Done. İçerik fikirlerini topla, tek tıkla DRAFT post'a çevir."
            />
            <FeatureCard
              icon={<TrendingUp className="h-6 w-6" />}
              iconBg="bg-rose-500/10 text-rose-600"
              title="AI Crawler Analytics"
              desc="GPTBot, ClaudeBot, PerplexityBot trafiği takip et. Hangi sayfaların AI tarafından tarandığını gör."
            />
          </div>
        </div>
      </section>

      {/* ─── HOW IT WORKS ─────────────────────────────────────────── */}
      <section id="how" className="border-t bg-muted/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 lg:py-24">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight">
              4 adımda otomasyon
            </h2>
            <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">
              Site URL'ini gir, gerisini LuviAI halleder. İlk makale 5 dakikada hazır.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { n: 1, icon: <Globe className="h-5 w-5" />,    title: 'Siteni ekle', desc: 'URL + niş. LuviAI siteyi crawl eder, marka sesini ve pillar konuları çıkarır.' },
              { n: 2, icon: <Search className="h-5 w-5" />,   title: 'Audit çalıştır', desc: '14 SEO check + GEO + AI Citation. Eksiklikleri ve fixable issue\'ları listeler.' },
              { n: 3, icon: <FileText className="h-5 w-5" />, title: 'İçerik üret', desc: 'Önerilen başlıklardan AI ile makale üretir. Marka sesin korunur, kaynak verilir.' },
              { n: 4, icon: <Send className="h-5 w-5" />,     title: 'Yayınla', desc: 'WordPress/Webflow/Ghost/cPanel\'e otomatik publish. Eş zamanlı sosyal medyada paylaş.' },
            ].map((step) => (
              <div key={step.n} className="relative p-6 rounded-2xl bg-background border hover:border-orange-500/30 transition-colors">
                <div className="absolute top-4 right-4 text-5xl font-extrabold text-muted-foreground/10">
                  {step.n}
                </div>
                <div className="w-10 h-10 rounded-lg bg-orange-500/10 text-orange-600 grid place-items-center mb-4">
                  {step.icon}
                </div>
                <h3 className="font-bold mb-2">{step.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── TECH STACK ──────────────────────────────────────────── */}
      <section className="border-t">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
          <p className="text-center text-xs uppercase tracking-wider text-muted-foreground mb-8 font-semibold">
            Modern altyapı ile inşa edildi
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-6 opacity-60 hover:opacity-100 transition-opacity">
            {(['nextjs', 'nestjs', 'tailwindcss', 'prisma', 'mysql', 'cloudflare', 'wordpress'] as const).map((v) => (
              <div key={v} className="flex items-center gap-2 text-sm font-medium">
                <VendorLogo name={v} size={20} />
                <span className="capitalize">{v === 'shadcnui' ? 'shadcn/ui' : v}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── PRICING TEASER ──────────────────────────────────────── */}
      <section id="pricing" className="border-t bg-muted/30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 lg:py-24">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight">
              Şeffaf fiyat, ölçeklenebilir plan
            </h2>
            <p className="mt-4 text-muted-foreground max-w-2xl mx-auto">
              14 gün ücretsiz. Kredi kartı gerekmez. İstediğin zaman iptal et.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            <PricingCard
              name="Starter"
              price="₺499"
              period="/ay"
              desc="Tek site, başlangıç için ideal"
              features={['1 site', '10 AI makale / ay', '14 SEO check', 'AI Citation (Gemini)', '2 sosyal kanal']}
              cta="Başla"
            />
            <PricingCard
              name="Pro"
              price="₺1.499"
              period="/ay"
              desc="Aktif blog + sosyal medya"
              features={['3 site', '50 AI makale / ay', 'AI Citation (6 motor)', '10 sosyal kanal', 'Reklam denetimi', 'Öncelikli destek']}
              cta="Pro'ya geç"
              highlighted
            />
            <PricingCard
              name="Agency"
              price="₺3.299"
              period="/ay"
              desc="Ajans / çoklu müşteri"
              features={['10 site', '200 AI makale / ay', 'White-label panel', 'Müşteri yönetimi', 'API erişimi', 'SLA + özel destek']}
              cta="Ajansa uygun"
            />
          </div>

          <p className="text-center mt-8 text-sm text-muted-foreground">
            PayTR ile güvenli ödeme · Aylık veya yıllık (yıllıkta 2 ay bedava)
          </p>
        </div>
      </section>

      {/* ─── FAQ ──────────────────────────────────────────────────── */}
      <section id="faq" className="border-t">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16 lg:py-24">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-center mb-12">
            Sıkça sorulanlar
          </h2>
          <div className="space-y-4">
            {[
              { q: 'AI ile üretilen içerik Google\'da cezalandırılır mı?',
                a: 'Hayır. Google, "AI veya insan, faydalı ve özgün içerik" diyor (Helpful Content). LuviAI marka sesinde, kaynaklı, yapılandırılmış içerik üretir — generic AI yazımı değil.' },
              { q: 'AI Citation tracking ne işe yarar?',
                a: 'ChatGPT/Claude/Gemini gibi AI asistanlar arama yerine doğrudan cevap veriyor. LuviAI bu motorlarda senden bahsedilip bahsedilmediğini test eder, atıf yoksa içeriği nasıl optimize edeceğini gösterir (FAQ, DefinedTerm, citation format).' },
              { q: 'Hangi CMS\'lere yayın yapabilir?',
                a: 'WordPress (REST + XMLRPC), Webflow, Shopify, Ghost, Strapi, cPanel statik HTML, FTP/SFTP, Sanity, Contentful, Custom PHP, GitHub. 12 farklı adapter.' },
              { q: 'Türkçe içerik kalitesi nasıl?',
                a: 'LuviAI Türkiye için optimize edildi — Claude Sonnet + Haiku model karması, Türkçe-spesifik prompt mühendisliği, glossary (terim sözlüğü) ile marka tutarlılığı.' },
              { q: 'GSC / GA4 entegrasyonu var mı?',
                a: 'Evet. OAuth ile Google Search Console + Analytics 4 bağlanır. CTR, impression, position datalarını LuviAI rapor sayfasında görürsün.' },
              { q: 'Veri güvenliği — KVKK uyumlu mu?',
                a: 'Veriler TR sunucularda. Şifreler ve API key\'ler AES-256 şifreli. KVKK aydınlatma metni + veri silme talebine 30 gün içinde dönüş.' },
            ].map((f, i) => (
              <details key={i} className="group rounded-xl border bg-background p-5 hover:border-orange-500/30 transition-colors">
                <summary className="font-semibold cursor-pointer flex items-center justify-between gap-3 list-none">
                  <span>{f.q}</span>
                  <ArrowRight className="h-4 w-4 shrink-0 transition-transform group-open:rotate-90" />
                </summary>
                <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ─── FINAL CTA ───────────────────────────────────────────── */}
      <section className="border-t bg-gradient-to-br from-orange-500 via-orange-600 to-red-600 text-white">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16 lg:py-24 text-center">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight">
            14 gün ücretsiz, kredi kartı yok
          </h2>
          <p className="mt-4 text-lg text-white/90 max-w-2xl mx-auto">
            İlk audit 5 dakikada, ilk AI makale 10 dakikada hazır. Sitende kalıp kalmayacağına sen karar verirsin.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/signin?signup=1">
              <Button size="lg" className="bg-white text-orange-600 hover:bg-white/90 text-base px-8 h-12 shadow-xl">
                Hemen ücretsiz başla
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
            <a href="mailto:destek@luvihost.com">
              <Button size="lg" variant="outline" className="text-base px-8 h-12 bg-transparent border-white/30 text-white hover:bg-white/10">
                Önce sor: destek@luvihost.com
              </Button>
            </a>
          </div>
          <p className="mt-6 text-xs text-white/70">
            <ShieldCheck className="h-3 w-3 inline mr-1" />
            KVKK uyumlu · PayTR güvenli ödeme · TR sunucu
          </p>
        </div>
      </section>

      {/* ─── FOOTER ──────────────────────────────────────────────── */}
      <footer className="bg-background border-t">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-sm">
            <div className="col-span-2 md:col-span-1">
              <div className="flex items-center gap-2 font-bold mb-3">
                <span className="bg-gradient-to-br from-orange-500 to-orange-700 text-white rounded-lg w-8 h-8 grid place-items-center">
                  <Sparkles className="h-4 w-4" />
                </span>
                LuviAI
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Türkiye için yapıldı. SEO + GEO + AI içerik otomasyonu, sosyal medya ve reklam tek panelden.
              </p>
            </div>
            <div>
              <p className="font-semibold mb-3 text-xs uppercase tracking-wider text-muted-foreground">Ürün</p>
              <ul className="space-y-2 text-muted-foreground">
                <li><a href="#features" className="hover:text-foreground transition-colors">Özellikler</a></li>
                <li><a href="#pricing" className="hover:text-foreground transition-colors">Fiyatlar</a></li>
                <li><a href="#how" className="hover:text-foreground transition-colors">Nasıl çalışır</a></li>
                <li><Link href="/signin" className="hover:text-foreground transition-colors">Giriş</Link></li>
              </ul>
            </div>
            <div>
              <p className="font-semibold mb-3 text-xs uppercase tracking-wider text-muted-foreground">Şirket</p>
              <ul className="space-y-2 text-muted-foreground">
                <li><Link href="/about" className="hover:text-foreground transition-colors">Hakkımızda</Link></li>
                <li><Link href="/privacy" className="hover:text-foreground transition-colors">Gizlilik</Link></li>
                <li><Link href="/terms" className="hover:text-foreground transition-colors">Şartlar</Link></li>
                <li><a href="mailto:destek@luvihost.com" className="hover:text-foreground transition-colors">İletişim</a></li>
              </ul>
            </div>
            <div>
              <p className="font-semibold mb-3 text-xs uppercase tracking-wider text-muted-foreground">Destekleyen markalar</p>
              <ul className="space-y-2 text-muted-foreground text-xs">
                <li>AI: Anthropic · OpenAI · Google · xAI</li>
                <li>Altyapı: Next.js · NestJS · Tailwind</li>
                <li>Ödeme: PayTR</li>
                <li>Hosting: LuviHost</li>
              </ul>
            </div>
          </div>
          <div className="mt-8 pt-8 border-t flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
            <p>© 2026 LuviAI · Bir LuviHost ürünü</p>
            <p>destek@luvihost.com · +90 ... ... .. ..</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({ icon, iconBg, title, desc }: { icon: React.ReactNode; iconBg: string; title: string; desc: string }) {
  return (
    <div className="group p-6 rounded-2xl border bg-background hover:border-orange-500/30 hover:shadow-lg hover:shadow-orange-500/5 transition-all">
      <div className={`w-12 h-12 rounded-xl ${iconBg} grid place-items-center mb-4 group-hover:scale-110 transition-transform`}>
        {icon}
      </div>
      <h3 className="font-bold mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
    </div>
  );
}

function PricingCard({
  name, price, period, desc, features, cta, highlighted,
}: {
  name: string; price: string; period: string; desc: string;
  features: string[]; cta: string; highlighted?: boolean;
}) {
  return (
    <div className={`p-8 rounded-2xl border flex flex-col ${
      highlighted
        ? 'bg-gradient-to-br from-orange-500/10 to-orange-500/5 border-orange-500/30 shadow-xl shadow-orange-500/10 scale-105'
        : 'bg-background'
    }`}>
      {highlighted && (
        <div className="text-[10px] uppercase tracking-wider font-bold text-orange-600 mb-2">Önerilen</div>
      )}
      <h3 className="text-xl font-bold">{name}</h3>
      <p className="text-sm text-muted-foreground mt-1">{desc}</p>
      <div className="my-6">
        <span className="text-4xl font-extrabold">{price}</span>
        <span className="text-muted-foreground text-sm">{period}</span>
      </div>
      <ul className="space-y-2 text-sm flex-1 mb-6">
        {features.map((f, i) => (
          <li key={i} className="flex items-start gap-2">
            <CheckCircle2 className={`h-4 w-4 mt-0.5 shrink-0 ${highlighted ? 'text-orange-600' : 'text-emerald-600'}`} />
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <Link href="/signin?signup=1">
        <Button
          className={`w-full ${highlighted ? 'bg-gradient-to-br from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white' : ''}`}
          variant={highlighted ? 'default' : 'outline'}
        >
          {cta}
        </Button>
      </Link>
    </div>
  );
}
