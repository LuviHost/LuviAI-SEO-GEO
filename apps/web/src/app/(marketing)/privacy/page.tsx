'use client';

import Link from 'next/link';
import { useT } from '@/lib/i18n';

const CONTENT = {
  tr: {
    backHome: '← Ana sayfa',
    titleA: 'Gizlilik',
    titleB: 'Politikası',
    effective: 'Yürürlük: 27 Nisan 2026',
    s1: '1. Toplanan Veriler',
    s1items: [
      'Hesap bilgileri: email, ad, varsa profil fotoğrafı',
      'Site bilgileri: URL, marka adı, niş',
      'GSC OAuth tokens (AES-256-GCM şifreli)',
      'Publish hedefi credentials (FTP/SFTP/WP, AES-256-GCM şifreli)',
      "Ödeme bilgileri PayTR'de saklanır, biz kart numarası tutmayız",
    ],
    s2: '2. Veri Kullanımı',
    s2p: 'Toplanan veriler sadece hizmet sunumu için kullanılır: AI içerik üretimi, SEO audit, GSC analizi, yayın otomasyonu. Üçüncü tarafa satılmaz veya pazarlama amaçlı paylaşılmaz.',
    s3: '3. Veri İşleme Konumu',
    s3p: "Sunucularımız LuviHost İstanbul veri merkezinde bulunur. Yedeklemeler S3-compatible storage'da Frankfurt bölgesinde tutulur. AI çağrıları Anthropic (US) ve Google (multi-region) servislerine gider.",
    s4: '4. Çerezler',
    s4p: 'Oturum yönetimi için zorunlu çerezler kullanılır. Analytics için Plausible (cookie-free) tercih edilir.',
    s5: '5. Üçüncü Taraf Sosyal Medya Entegrasyonları',
    s5p1: 'RanksUp; LinkedIn, X (Twitter), Bluesky, TikTok, YouTube, Facebook, Instagram, Threads, Pinterest gibi sosyal medya platformlarına OAuth 2.0 protokolü ile bağlanır. Her platforma yalnızca kullanıcının açık rızasıyla bağlanılır ve kullanıcı istediği zaman bağlantıyı koparabilir (Settings → Sosyal Kanallar → Bağlantıyı kes).',
    s5label: 'Saklanan bilgiler:',
    s5items: [
      'OAuth access_token + refresh_token (AES-256-GCM ile şifreli)',
      "Bağlı hesap profil bilgisi (kullanıcı adı, görünen ad, avatar URL — UI'da göstermek için)",
      'Yayınlanan içerik referansı (post URL ve external ID — analitik için)',
    ],
    s5tiktokStrong: 'TikTok özelinde:',
    s5tiktok: " TikTok Login Kit (user.info.basic) ile yalnızca açık rıza ile alınan kullanıcı kimliği gösterilir; video.publish + video.upload scope'ları yalnızca kullanıcının RanksUp panelinden onayladığı içerikleri kullanıcının kendi TikTok hesabına yayınlamak için kullanılır. RanksUp hiçbir koşulda kullanıcı onayı olmadan otomatik yayın yapmaz. TikTok'tan alınan veri yalnızca kullanıcıya hizmet sunmak için kullanılır, üçüncü taraflara satılmaz, reklam veya profilleme amacıyla işlenmez. Kullanıcı hesabı sildiğinde tüm TikTok token'ları + profil bilgisi 30 gün içinde kalıcı olarak silinir.",
    s6: '6. Yapay Zeka Üretim Sistemleri',
    s6p: 'İçerik üretimi için Anthropic Claude, Google Gemini, OpenAI ve isteğe bağlı olarak HeyGen, Runway, ElevenLabs gibi sağlayıcılarla iletişim kurulur. Kullanıcı içeriği yalnızca o üretim için gönderilir, model eğitiminde kullanılmaz (her sağlayıcının "no-train" politikalarına uygun çağrı yapılır).',
    s7: '7. Haklarınız (KVKK)',
    s7items: [
      'Verilerinize erişim talep etme',
      'Düzeltme talep etme',
      'Silme talep etme (hesap silindiğinde 30 gün sonra geri dönüşsüz silinir)',
      'Veri taşınabilirliği (JSON export)',
    ],
    s8: '8. İletişim',
    s8label: 'Veri sorumlu: LuviHost. Email: ',
  },
  en: {
    backHome: '← Back to home',
    titleA: 'Privacy',
    titleB: 'Policy',
    effective: 'Effective: April 27, 2026',
    s1: '1. Data Collected',
    s1items: [
      'Account info: email, name, profile photo if any',
      'Site info: URL, brand name, niche',
      'GSC OAuth tokens (AES-256-GCM encrypted)',
      'Publish target credentials (FTP/SFTP/WP, AES-256-GCM encrypted)',
      'Payment data is stored at PayTR; we do not hold card numbers',
    ],
    s2: '2. Data Use',
    s2p: 'Collected data is used solely for service delivery: AI content generation, SEO audit, GSC analysis, publish automation. It is not sold to third parties or shared for marketing.',
    s3: '3. Data Processing Location',
    s3p: 'Our servers are in the LuviHost Istanbul data center. Backups are kept on S3-compatible storage in the Frankfurt region. AI calls go to Anthropic (US) and Google (multi-region) services.',
    s4: '4. Cookies',
    s4p: 'Essential cookies are used for session management. Plausible (cookie-free) is preferred for analytics.',
    s5: '5. Third-Party Social Media Integrations',
    s5p1: 'RanksUp connects to social platforms like LinkedIn, X (Twitter), Bluesky, TikTok, YouTube, Facebook, Instagram, Threads, Pinterest via OAuth 2.0. Connection requires explicit user consent and the user can disconnect at any time (Settings → Social Channels → Disconnect).',
    s5label: 'Stored data:',
    s5items: [
      'OAuth access_token + refresh_token (AES-256-GCM encrypted)',
      'Connected account profile (username, display name, avatar URL — to show in UI)',
      'Published content reference (post URL and external ID — for analytics)',
    ],
    s5tiktokStrong: 'For TikTok specifically:',
    s5tiktok: " The TikTok Login Kit (user.info.basic) only shows user identity obtained with explicit consent; video.publish + video.upload scopes are used solely to publish content the user approved in the RanksUp panel to the user's own TikTok account. RanksUp never auto-publishes without user approval. Data received from TikTok is used only to serve the user, never sold to third parties, never processed for advertising or profiling. When an account is deleted, all TikTok tokens + profile info are permanently deleted within 30 days.",
    s6: '6. AI Generation Systems',
    s6p: 'Content generation uses Anthropic Claude, Google Gemini, OpenAI and optionally HeyGen, Runway, ElevenLabs. User content is sent only for that generation request and is not used for model training (each provider is called following its "no-train" policy).',
    s7: '7. Your Rights (GDPR/KVKK)',
    s7items: [
      'Request access to your data',
      'Request correction',
      'Request deletion (permanently removed 30 days after account deletion)',
      'Data portability (JSON export)',
    ],
    s8: '8. Contact',
    s8label: 'Data controller: LuviHost. Email: ',
  },
} as const;

export default function PrivacyPage() {
  const { locale } = useT();
  const d = CONTENT[locale];

  return (
    <main className="relative">
      <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute top-20 -left-20 w-96 h-96 bg-brand-500/10 rounded-full blur-3xl" />
      </div>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16 prose dark:prose-invert">
        <Link href="/" className="text-sm text-muted-foreground hover:text-brand-600 transition-colors">{d.backHome}</Link>
        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight mt-8 mb-3">
          <span className="bg-gradient-to-r from-brand-500 via-brand-600 to-red-600 bg-clip-text text-transparent">
            {d.titleA}
          </span>{' '}
          {d.titleB}
        </h1>
        <p className="text-sm text-muted-foreground mb-8">{d.effective}</p>

        <h2 className="text-xl font-bold mt-8 mb-3">{d.s1}</h2>
        <ul className="space-y-1 text-sm">
          {d.s1items.map((it) => <li key={it}>• {it}</li>)}
        </ul>

        <h2 className="text-xl font-bold mt-8 mb-3">{d.s2}</h2>
        <p className="text-sm text-muted-foreground">{d.s2p}</p>

        <h2 className="text-xl font-bold mt-8 mb-3">{d.s3}</h2>
        <p className="text-sm text-muted-foreground">{d.s3p}</p>

        <h2 className="text-xl font-bold mt-8 mb-3">{d.s4}</h2>
        <p className="text-sm text-muted-foreground">{d.s4p}</p>

        <h2 className="text-xl font-bold mt-8 mb-3">{d.s5}</h2>
        <p className="text-sm text-muted-foreground">{d.s5p1}</p>
        <p className="text-sm text-muted-foreground mt-2">{d.s5label}</p>
        <ul className="space-y-1 text-sm">
          {d.s5items.map((it) => <li key={it}>• {it}</li>)}
        </ul>
        <p className="text-sm text-muted-foreground mt-2">
          <strong>{d.s5tiktokStrong}</strong>{d.s5tiktok}
        </p>

        <h2 className="text-xl font-bold mt-8 mb-3">{d.s6}</h2>
        <p className="text-sm text-muted-foreground">{d.s6p}</p>

        <h2 className="text-xl font-bold mt-8 mb-3">{d.s7}</h2>
        <ul className="space-y-1 text-sm">
          {d.s7items.map((it) => <li key={it}>• {it}</li>)}
        </ul>

        <h2 className="text-xl font-bold mt-8 mb-3">{d.s8}</h2>
        <p className="text-sm text-muted-foreground">
          {d.s8label}<a href="mailto:kvkk@luvihost.com" className="text-brand-600">kvkk@luvihost.com</a>
        </p>
      </div>
    </main>
  );
}
