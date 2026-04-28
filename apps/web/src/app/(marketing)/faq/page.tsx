'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { ThemeToggle } from '@/components/theme-toggle';
import { LocaleSwitch } from '@/components/locale-switch';
import { cn } from '@/lib/utils';

const FAQS = [
  {
    q: 'LuviAI nasıl çalışır?',
    a: 'Sitenizin URL\'ini bağlarsınız. AI önce sitenizi crawl edip "marka beyni" oluşturur (ton, persona, rakipler). Sonra GSC verisi + AI analiziyle Tier 1/2/3 konu listesi çıkarır. Her makale 6-ajan zincirinden geçer (anahtar kelime → outline → yazar → editör → görsel → yayıncı) ve seçtiğiniz hedefe (WordPress, FTP, GitHub, vb.) yayınlanır.',
  },
  {
    q: 'Hangi dilleri destekliyor?',
    a: 'Türkçe ve İngilizce. Onboarding\'de seçersiniz, isterseniz "her ikisi" deyip her makale için ayrı ayrı seçebilirsiniz. Faz 3\'te 10 dil planlanıyor.',
  },
  {
    q: 'Ücretsiz olarak ne kadar kullanabilirim?',
    a: 'Kayıt olunca 1 makale tamamen ücretsiz üretilir (süre sınırı yok). Markdown ZIP olarak indirebilirsin. İkinci makaleden itibaren bir plan seçmen gerekir; plan seçince WordPress/FTP/SFTP gibi tüm yayın hedefleri açılır.',
  },
  {
    q: 'AI içeriği Google\'da cezalandırılır mı?',
    a: 'Hayır. Google AI içerik politikası "kalite" odaklıdır, yöntem odaklı değil. LuviAI editör katmanı AI klişelerini siler, marka sesi tutarlılığını sağlar ve tüm makaleler 1800-2500 kelime, FAQ + Schema markup ile gerçek değer yaratacak şekilde yapılandırılır.',
  },
  {
    q: 'GEO (AI search) optimizasyonu nedir?',
    a: 'ChatGPT, Perplexity, Claude, Gemini gibi AI asistanlarının cevaplarında alıntılanma için içerik optimizasyonu. Auriti GEO Optimizer ile 47 metrik üzerinden tarama yapılır, llms.txt + structured data + Q&A formatları otomatik kurulur.',
  },
  {
    q: 'Kendi WordPress\'ime nasıl bağlarım?',
    a: 'WordPress yönetim panelinde Users → Profile → Application Passwords altından bir App Password oluşturursunuz. LuviAI onboarding 5. adımında WordPress REST seçer, site URL + kullanıcı adı + app password girersiniz. Sonra her üretilen makale otomatik yayına geçer.',
  },
  {
    q: 'Aboneliğimi istediğim zaman iptal edebilir miyim?',
    a: 'Evet. Dashboard → Abonelik → İptal Et. Aylık planda ay sonuna kadar erişiminiz devam eder. Yıllık planda ilk 30 gün full iade, sonrası kalan ay başına orantılı iade.',
  },
  {
    q: 'Verilerim güvende mi?',
    a: 'Tüm credentials (FTP/SFTP/WP/cPanel passwords, GSC OAuth tokens) AES-256-GCM ile şifrelenir. KVKK uyumlu. Hesabınızı silerseniz veriler 30 gün saklanır, sonra geri dönüşsüz silinir.',
  },
  {
    q: 'AI hangi modeli kullanıyor?',
    a: 'Default: Claude Sonnet 4.6 (yazar + editör). Kalite öncelikli müşteriler için Opus 4.7 opt-in. Görsel: Gemini 2.5 Flash Image. Tüm modeller maliyet/kalite dengesi için seçildi.',
  },
  {
    q: 'Aylık makale kotamı aşarsam ne olur?',
    a: 'Sistem makale üretmeyi durdurur ve plan yükseltme önerir. Ay sonunda kota otomatik sıfırlanır. Profesyonel → Kurumsal upgrade tek tık.',
  },
  {
    q: 'Affiliate programı nasıl çalışır?',
    a: 'Plan seçtikten sonra dashboard\'dan affiliate enroll yaparsınız. Size özel link verilir. Davet ettiğiniz kullanıcıların 3 ay boyunca yaptığı ödemelerin %30\'u komisyonunuz olur. Aylık otomatik PayTR transfer ile ödenir.',
  },
  {
    q: 'Kendi geliştirici takımım API kullanabilir mi?',
    a: 'Faz 3\'te (Q3 2026) public REST API + npm/pip SDK + Zapier/Make/n8n integration\'ları gelir. Şu an dashboard üzerinden manuel/otomatik kullanıyorsunuz.',
  },
];

export default function FaqPage() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted">
      <header className="container flex justify-between items-center py-6">
        <Link href="/" className="text-2xl font-bold">LuviAI</Link>
        <div className="flex items-center gap-3">
          <Link href="/pricing" className="text-sm hover:text-brand">Fiyatlar</Link>
          <Link href="/compare" className="text-sm hover:text-brand">Karşılaştırma</Link>
          <LocaleSwitch />
          <ThemeToggle />
        </div>
      </header>

      <main className="container max-w-3xl py-12">
        <h1 className="text-4xl md:text-5xl font-bold mb-3 text-center">Sık Sorulan Sorular</h1>
        <p className="text-muted-foreground text-center mb-12">
          Cevabını bulamadığın bir soru varsa{' '}
          <a href="mailto:destek@luvihost.com" className="text-brand hover:underline">
            destek@luvihost.com
          </a>
        </p>

        <div className="space-y-3">
          {FAQS.map((item, i) => (
            <Card key={i}>
              <button
                onClick={() => setOpen(open === i ? null : i)}
                className="w-full text-left p-5 flex items-center justify-between gap-4"
              >
                <span className="font-semibold">{item.q}</span>
                <ChevronDown className={cn('h-5 w-5 transition-transform shrink-0', open === i && 'rotate-180')} />
              </button>
              {open === i && (
                <CardContent className="pt-0 text-sm text-muted-foreground leading-relaxed">
                  {item.a}
                </CardContent>
              )}
            </Card>
          ))}
        </div>

        <div className="mt-12 text-center">
          <Link href="/onboarding" className="inline-block px-6 py-3 bg-brand text-white rounded-lg font-semibold">
            1 Makale Ücretsiz Dene
          </Link>
        </div>
      </main>
    </div>
  );
}
