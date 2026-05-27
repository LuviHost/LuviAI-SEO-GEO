import Link from 'next/link';
import {
  Rocket, Search, Smartphone, Wand2, Bot, Sparkles,
  CreditCard, Plug, MessageSquare, BarChart3,
} from 'lucide-react';

const TOPICS = [
  {
    icon: Rocket, color: 'orange',
    title: 'Hızlı Başlangıç',
    desc: '5 dakikada hesabını kurup ilk AI çıktısını al.',
    href: '/help/getting-started',
  },
  {
    icon: Sparkles, color: 'purple',
    title: 'AI Görünürlük',
    desc: 'ChatGPT, Claude, Gemini, Perplexity\'de markanı izle.',
    href: '/help/ai-visibility',
  },
  {
    icon: Search, color: 'blue',
    title: 'ASO — Mobil App SEO',
    desc: 'App Store + Play Store keyword sıralama + rakip analizi.',
    href: '/help/aso',
  },
  {
    icon: Smartphone, color: 'amber',
    title: 'Apple Search Ads + ASC',
    desc: 'iOS reklam kampanyası kurulumu, Auto-Pilot, review takibi.',
    href: '/help/asa-asc',
  },
  {
    icon: Wand2, color: 'rose',
    title: 'AI Studio',
    desc: 'Görsel (DALL-E), video (Sora 2 + Veo 3), metin üretimi.',
    href: '/help/studio',
  },
  {
    icon: Bot, color: 'emerald',
    title: 'Auto-Pilot Otomasyon',
    desc: 'Sen uyurken AI keyword ekler, kampanya optimize eder.',
    href: '/help/auto-pilot',
  },
  {
    icon: Plug, color: 'cyan',
    title: 'API Keys (BYOK)',
    desc: 'Kendi OpenAI/Anthropic key\'inle çalış, kotamızdan düşmez.',
    href: '/help/api-keys',
  },
  {
    icon: MessageSquare, color: 'pink',
    title: 'Sosyal Medya',
    desc: '5 kanala AI ile post + görsel + zamanlama.',
    href: '/help/social',
  },
  {
    icon: CreditCard, color: 'slate',
    title: 'Faturalama',
    desc: 'Plan değiştirme, iptal, fatura indirme, kota.',
    href: '/help/billing',
  },
];

const COLORS: Record<string, string> = {
  orange: 'from-orange-500/15 to-orange-600/10 text-orange-600',
  purple: 'from-purple-500/15 to-purple-600/10 text-purple-600',
  blue: 'from-blue-500/15 to-blue-600/10 text-blue-600',
  amber: 'from-amber-500/15 to-amber-600/10 text-amber-600',
  rose: 'from-rose-500/15 to-rose-600/10 text-rose-600',
  emerald: 'from-emerald-500/15 to-emerald-600/10 text-emerald-600',
  cyan: 'from-cyan-500/15 to-cyan-600/10 text-cyan-600',
  pink: 'from-pink-500/15 to-pink-600/10 text-pink-600',
  slate: 'from-slate-500/15 to-slate-600/10 text-slate-600',
};

export default function HelpPage() {
  return (
    <main className="relative min-h-screen">
      <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute top-20 -left-20 w-96 h-96 bg-orange-500/10 rounded-full blur-3xl" />
        <div className="absolute top-60 -right-20 w-96 h-96 bg-amber-400/10 rounded-full blur-3xl" />
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="text-center mb-14 max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-500/10 border border-orange-500/20 text-orange-600 text-xs font-semibold mb-5">
            📚 Yardım Merkezi
          </div>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-tight mb-4">
            LuviAI nasıl{' '}
            <span className="bg-gradient-to-r from-orange-500 via-orange-600 to-red-600 bg-clip-text text-transparent">
              kullanılır?
            </span>
          </h1>
          <p className="text-lg text-muted-foreground">
            9 modül, 5 dakikada başla. Her sekmenin kendi rehberi.{' '}
            <br />
            Sorunu bulamadıysan{' '}
            <a href="mailto:destek@luvihost.com" className="text-orange-600 hover:underline font-semibold">destek@luvihost.com</a>
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {TOPICS.map((t) => (
            <Link
              key={t.href}
              href={t.href as any}
              className="p-6 rounded-2xl border bg-background hover:border-orange-500/40 hover:shadow-xl hover:shadow-orange-500/5 transition-all group"
            >
              <div className={`h-11 w-11 rounded-xl bg-gradient-to-br ${COLORS[t.color]} grid place-items-center mb-3 group-hover:scale-110 transition-transform`}>
                <t.icon className="h-5 w-5" />
              </div>
              <h2 className="font-bold text-lg mb-1.5">{t.title}</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">{t.desc}</p>
              <div className="mt-4 text-xs font-bold text-orange-600 group-hover:translate-x-0.5 transition-transform">
                Rehberi oku →
              </div>
            </Link>
          ))}
        </div>

        {/* Quick links */}
        <div className="mt-16 rounded-2xl border-2 border-orange-500/30 bg-gradient-to-br from-orange-500/5 to-amber-400/5 p-8 text-center">
          <BarChart3 className="h-10 w-10 text-orange-600 mx-auto mb-3" />
          <h3 className="text-2xl font-bold mb-2">Hâlâ takılı kaldın mı?</h3>
          <p className="text-muted-foreground mb-5 max-w-xl mx-auto">
            Ekranı paylaşarak 15 dakika ücretsiz onboarding desteği alabilirsin.
            Pro plan + üstü kullanıcılar için canlı destek mevcut.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <a
              href="mailto:destek@luvihost.com"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-gradient-to-br from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white text-sm font-semibold shadow-lg shadow-orange-500/20"
            >
              📧 Mail destek
            </a>
            <Link
              href={'/signin' as any}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border text-sm font-semibold hover:bg-muted/50"
            >
              Hesabıma giriş
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
