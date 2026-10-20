import { Sparkles } from 'lucide-react';
import { HelpArticle, Step, Tip } from '@/components/help-article';

export const metadata = { title: 'AI Görünürlük — RanksUp Help' };

// Metin urunun gercek davranisini anlatir (Ekim 2026, kodla dogrulandi):
//  - Olculen asistanlar plans.ts ile ayni 6 ad; Llama uretimde olculmuyor.
//  - Gunluk otomatik olcum KAPALI (worker AI_CITATION_DAILY_CRON); olcumu
//    kullanici baslatir ve hesap basina 7 gunde 1 olcum yapilir
//    (billing/measurement-allowance.ts). "Yeniden Test" ve "AI önerisi al"
//    ayni haftalik hakki kullanir (audit.controller citation-snapshot /
//    citation-roadmap, ikisi de @MeasurementSession).
//  - BYOK yalniz Kurumsal (plans.ts FEATURE_MIN_PLAN.byok); haftalik hak
//    BYOK'ta da gecerli. Eski metin "Pro ve ustu, sinirsiz test" diyordu.
//  - Hak hesap basina (kv ai-olcum:<userId>), siteler ortak. Panelden baslatilan
//    site taramasi (audit run, trigger 'user') AI adiminda ayni hakki kullanir;
//    hak yoksa AI adimi atlanir, tarama tamamlanir (audit.service aiSkip).
//    Calistirma aylik tavan: runForSite 1, Prompt Lab sorusu / dali 1.
export default function Page() {
  return (
    <HelpArticle slug="ai-visibility"
      icon={Sparkles}
      badge="AI Görünürlük"
      title="ChatGPT, Claude, Gemini'de markanı izle"
      intro="Kullanıcılar artık soruları yapay zekâ asistanlarına da soruyor. RanksUp, sitene uygun sorularda markanın anılıp anılmadığını ve sitenin kaynak gösterilip gösterilmediğini ölçer; duygu, ses payı ve öneri sunar."
      steps={[
        { name: 'AI Görünürlük sayfasına git', text: 'Site menüsü → AI Görünürlük. Üstte AI görünürlük geçmişi grafiği yer alır.' },
        { name: 'Ölçümü başlat', text: '"Yeniden Test" butonu: ChatGPT, Claude, Gemini, Perplexity, Grok ve DeepSeek\'e en fazla 5 soru sorulur. Hesap başına haftada bir AI ölçümü yapılabilir.' },
        { name: 'Sonuçları incele', text: 'Her asistan için ayrı kart: skor, duygu (olumlu / nötr / olumsuz), ses payı (rakipler) ve markanın cevapta kaçıncı paragrafta geçtiği.' },
        { name: 'GEO yol haritası al', text: 'GEO yol haritası bölümündeki "AI önerisi al" alıntı testini çalıştırır ve 5 uygulanabilir öneri üretir. Bu da haftalık ölçüm hakkını kullanır.' },
        { name: 'Haftalık karşılaştır', text: 'Otomatik günlük ölçüm yoktur. "Yeniden Test" ile aldığın her ölçüm kaydedilir ve grafiğe eklenir; iki ölçümü yan yana karşılaştırabilirsin.' },
      ]}
    >
      <h2>Nasıl çalışır?</h2>
      <p>
        RanksUp marka beynindeki sorulardan en fazla 5 tanesini (örn. <em>&ldquo;en iyi KOBİ muhasebe yazılımı nedir?&rdquo;</em>)
        <strong> 6 AI asistanına</strong> sorar: ChatGPT, Claude, Gemini, Perplexity, Grok ve DeepSeek.
        Cevapta marka adının geçip geçmediği, site adresinin kaynak gösterilip gösterilmediği ve rakiplerin anılıp anılmadığı ölçülür.
      </p>
      <p>
        Ölçümü sen başlatırsın. Hesap başına 7 günde bir AI ölçümü yapılabilir; AI testi, yol haritası, Prompt Lab ve diğer ölçümler
        bu haftalık hakkı paylaşır. Hak kullanıldıysa butonun altında bir sonraki ölçümün açılacağı tarih yazar.
      </p>
      <p>
        Hak hesap başınadır: tüm sitelerin aynı haftalık hakkı paylaşır. Panelden yeniden başlattığın site taramasındaki AI testi de bu hakka
        sayılır; hak o hafta kullanıldıysa tarama AI adımı olmadan tamamlanır. Planına göre ayrıca aylık bir görünürlük çalıştırması tavanı
        vardır: AI testi 1, Prompt Lab&apos;de her soru ve her dal 1 çalıştırma sayılır (<a href="/help/billing">Faturalama</a>).
      </p>

      <h2>Skor sistemi</h2>
      <ul>
        <li><strong>Kaynak gösterildi</strong> = 100 puan — cevap doğrudan site adresini veriyor</li>
        <li><strong>Marka anıldı</strong> = 50 puan — yalnızca marka adı geçiyor</li>
        <li><strong>Yok</strong> = 0 puan — hiç geçmiyor</li>
      </ul>
      <p>Marka adının sorunun içinde geçtiği sorular skora girmez; orada anılmak zaten beklenen bir sonuçtur.</p>

      <h2>Ölçülen metrikler</h2>

      <h3>1. Duygu</h3>
      <p>Markanın anıldığı yerin çevresindeki ifadelere bakılır: &ldquo;en iyi&rdquo;, &ldquo;tavsiye&rdquo; gibi ifadeler olumlu; &ldquo;kötü&rdquo;, &ldquo;tavsiye etmem&rdquo; gibi ifadeler olumsuz sayılır.</p>

      <h3>2. Konum</h3>
      <p>Marka cevabın kaçıncı paragrafında geçiyor? Birinci paragrafta anılmak ile beşincide anılmak farklıdır; RanksUp ortalamayı <code>#3.2</code> gibi gösterir.</p>

      <h3>3. Ses payı</h3>
      <p>AI cevaplarında markan ve rakiplerin ne kadar yer kaplıyor: senin payın %X, rakiplerin %Y, %Z.</p>

      <h3>4. GEO yol haritası</h3>
      <p>&ldquo;AI önerisi al&rdquo; alıntı testini çalıştırır ve sonuca göre <strong>5 uygulanabilir öneri</strong> üretir (örn. &ldquo;FAQ şeması ekle&rdquo;).</p>

      <h2>Nasıl kullanırım?</h2>
      <Step n={1} title="AI Görünürlük sayfasına git">
        Site menüsü → <strong>AI Görünürlük</strong>. Üstte AI görünürlük geçmişi grafiği yer alır.
      </Step>
      <Step n={2} title="Ölçümü başlat">
        <strong>Yeniden Test</strong> butonuna bas. 6 asistana en fazla 5 soru sorulur; sonuçta her asistan için ayrı kart ve soru bazında ayrıntılar görünür.
      </Step>
      <Step n={3} title="Ya da yol haritasıyla birlikte ölç">
        <strong>GEO yol haritası</strong> bölümündeki <strong>&ldquo;AI önerisi al&rdquo;</strong> alıntı testini çalıştırır ve 5 öneri üretir.
        &ldquo;Yeniden Test&rdquo; ile aynı haftalık hakkı kullandığı için aynı hafta ikisinden birini seç.
      </Step>
      <Step n={4} title="Her hafta karşılaştır">
        Otomatik günlük ölçüm yoktur. &ldquo;Yeniden Test&rdquo; ile aldığın her ölçüm kaydedilir ve grafiğe eklenir; iki ölçümü yan yana karşılaştırabilirsin.
        Site eklerken otomatik akış açıksa bir başlangıç ölçümü alınır.
      </Step>

      <Tip kind="info">
        Ölçümden önce soruların sektörüne uyduğundan emin ol: sektörü ya da dili değiştirdiysen <strong>Ayarlar → Marka beynini yeniden üret</strong>.
        AI asistanlarına sorulan sorular marka beyninden gelir.
      </Tip>

      <h2>BYOK — Kendi sağlayıcı anahtarın</h2>
      <p>
        BYOK (Bring Your Own Key) <strong>Kurumsal planına dahildir</strong>. Site menüsü → <strong>Bağlantılar → AI sağlayıcı anahtarları</strong>
        bölümünden OpenAI, Anthropic, Google Gemini, Perplexity, xAI ya da DeepSeek anahtarını bağlarsın. Aylık görünürlük çalıştırması kotan
        dolsa bile o sağlayıcıyla ölçüm sürer; haftalık ölçüm hakkı yine geçerlidir.
      </p>
      <p><a href="/help/api-keys">BYOK rehberini oku</a></p>
    </HelpArticle>
  );
}
