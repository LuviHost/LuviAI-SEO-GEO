import { Bot } from 'lucide-react';
import { HelpArticle, Step, Tip } from '@/components/help-article';

export const metadata = { title: 'Auto-Pilot — RanksUp Help' };

export default function Page() {
  return (
    <HelpArticle slug="auto-pilot"
      icon={Bot}
      badge="Otomasyon"
      title="Sen uyurken AI çalışır"
      intro="Auto-Pilot, manuel müdahaleye gerek kalmadan haftalık keyword ekler, düşük performanslı kampanyaları durdurur, AI Citation günlük takip eder, ranking düştüğünde alarm verir."
    >
      <h2>3 farklı Auto-Pilot</h2>

      <h3>1. ASA Auto-Pilot — Apple Search Ads</h3>
      <p>Her ASA hesabı altında collapsible "Auto-Pilot" paneli. Açtığında günlük cron (04:30 UTC):</p>
      <ul>
        <li>Son 7g'de 20+ tap aldı ama 0 install — keyword <strong>otomatik pause</strong></li>
        <li>AI önerisinden mevcut'ta olmayan top 5 keyword <strong>otomatik ekle</strong></li>
        <li>Aylık bütçe cap aşıldıysa <strong>SKIP</strong> (zarar önleme)</li>
      </ul>

      <Step n={1} title="ASA bağlı olmalı">
        Önce ASA hesabını bağla (<a href="/help/asa-asc">ASA rehberi</a>).
      </Step>
      <Step n={2} title="Auto-Pilot panelini aç">
        ASA tab'ında hesap satırı altında <strong>Auto-Pilot</strong> bölümü. Toggle ile açtığınızda:
      </Step>
      <Step n={3} title="Aylık bütçe cap ayarla">
        Default $500/ay. Aşılırsa Auto-Pilot durur, mevcut kampanyalar çalışmaya devam eder.
      </Step>
      <Step n={4} title="⚡ Şimdi çalıştır (test)">
        Manuel tetik — Auto-Pilot tek seferlik çalışır, son çalışma sonucu kart altında görünür.
      </Step>

      <h3>2. AI Visibility Daily Snapshot</h3>
      <p>
        Auto-Pilot ON sitelerde her gece AI Citation snapshot alınır. Her gün her provider için skor + brand mention sayısı kaydedilir.
        Sonra Visibility sayfasındaki <strong>Citation History Chart</strong>'ta günden güne karşılaştırırsın.
      </p>

      <h3>3. ASC (App Store Connect) Cron</h3>
      <p>05:30 UTC her gün — tüm ASC hesapları için:</p>
      <ul>
        <li>App'leri sync</li>
        <li>Release'leri çek</li>
        <li>60g+ release yok → <strong>WARN</strong>, 120g+ → <strong>CRITICAL</strong> alert</li>
        <li>Yorumlar çekilir (planlanmış)</li>
      </ul>

      <h2>Auto-Pilot ile manuel mod farkı</h2>
      <ul>
        <li><strong>Manuel</strong>: AI önerir, sen onaylarsın. Tam kontrol, daha yavaş.</li>
        <li><strong>Auto-Pilot</strong>: AI önerir + uygular. Hızlı, ölçeklenebilir, bütçe cap'in altında kalır.</li>
      </ul>

      <Tip kind="warn">
        Auto-Pilot real money harcar (ASA kampanyaları için). <strong>Mutlaka bütçe cap ayarla</strong> ve ilk hafta günlük "Son çalışma" sonuçlarını incele.
      </Tip>

      <h2>Cost monitoring</h2>
      <p>
        Dashboard üst kısmında <strong>QuotaMonitor</strong> widget'ı:
      </p>
      <ul>
        <li>Aylık makale / video / site kullanımı + limit progress bar</li>
        <li>AI bütçe (USD) yüzdesi — plan revenue'nun %60'ı aşıldığında uyarı</li>
        <li>%80'de sarı, %100'de kırmızı + hard block notification</li>
      </ul>

      <Tip kind="success">
        Auto-Pilot + Cost Monitor birlikte: sen uyurken AI çalışır, sürpriz fatura olmaz.
      </Tip>
    </HelpArticle>
  );
}
