import type { Metadata } from 'next';
import Link from 'next/link';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { VitrinBand, VitrinHero, VitrinSection, VITRIN_LINK } from '@/components/vitrin/vitrin-page';

/**
 * RanksUpBot aciklama sayfasi — kullanici ajanindaki +https://ranksup.ai/bot
 * adresi buraya gelir. Site sahibi loglarinda bizi gorunce "ne istiyor, nasil
 * izin veririm / engellerim" sorusunun cevabini burada bulur.
 *
 * Her cumle koda dayanir: UA apps/api/src/common/safe-fetch.ts RANKSUP_BOT_UA
 * (public-docs.spec.ts birebir karsilastirir). Sunucu IP'si YAZILMAZ: koken
 * Cloudflare arkasinda, adresi acmak saldiriya kapi acar.
 *
 * Kapsam listesi (2026-10-18, kodla dogrulandi): RANKSUP_BOT_UA'yi kullanan
 * her okuyucu — sites/site-crawler + site-url-inventory, audit/geo-runner,
 * snippet-generator, schema-validator, static-html-fixer,
 * stuck-page-external-recovery, image-alt (suggest: gorsel dosyasi, apply:
 * dogrulama), sites/niche-detector (+ page-renderer basiz Chrome) ve
 * platform-detector, audit/site-nap (yerel NAP), crawler-analytics (sitemap
 * sayisi), auto-fix (canli kok dosya), agent-readiness (AXO dosyalari ve
 * ticaret yoklamasi: urun site haritasi, urun sayfalari, urun akislari,
 * Shopify products.json, WooCommerce Store API — agent-readiness-checks.ts
 * planCommerceProbes; public-docs.spec.ts yollari karsilastirir), articles/link-validator,
 * topics/competitor (rakip RSS/blog), public-citation (ucretsiz kontrol),
 * intel/* (sektor takibi; eskiden RanksUpIntel), prospect-utils (pazar
 * arastirmasi), webhook-notifier (POST). Cloudflare adimlari
 * common/block-detect.ts unblockHint ile ayni.
 */

const BOT_UA = 'Mozilla/5.0 (compatible; RanksUpBot/1.0; +https://ranksup.ai/bot)';
const SUPPORT_EMAIL = 'destek@luvihost.com';

// Cloudflare kurallari icin kaynaklar (2026-10-18'de okundu): menu adlari ve
// "Bot Fight Mode Skip ile atlanamaz" CF_SKIP_RULE_DOCS + CF_BFM_DOCS, secenek
// adlari CF_SKIP_DOCS, "Deploy" dugmesi waf/custom-rules/create-dashboard
const CF_SKIP_RULE_DOCS = 'https://developers.cloudflare.com/waf/custom-rules/skip/';
const CF_SKIP_DOCS = 'https://developers.cloudflare.com/waf/custom-rules/skip/options/';
const CF_BFM_DOCS = 'https://developers.cloudflare.com/bots/get-started/bot-fight-mode/';

export const metadata: Metadata = {
  title: 'RanksUpBot',
  description:
    'RanksUpBot, RanksUp’ın sitelere gönderdiği isteklerin kimliği: neyi okur, robots.txt kurallarına nasıl uyar, Cloudflare’de nasıl izin verilir ya da engellenir.',
  alternates: { canonical: 'https://ranksup.ai/bot' },
  robots: { index: true, follow: true },
};

/** Govde metni: bolumlerin sag sutunundaki paragraf / liste akisi */
const GOVDE = 'max-w-2xl space-y-4 text-sm leading-[1.8] text-muted-foreground';
/** Kapsam listesi: ince cizgili satirlar; satir adi kendi satirinda durur */
const KAPSAM_SATIR = 'border-b border-border py-5';
const KAPSAM_AD = 'mb-1.5 block text-base font-medium text-foreground';

/** Kod / kullanici ajani kutusu: duz, ince cerceveli; uzun satir kutunun icinde kayar */
function Kod({ children }: { children: string }) {
  return (
    <pre className="mt-3 overflow-x-auto rounded-lg border border-border bg-card p-4 font-mono text-sm leading-relaxed text-foreground">
      <code>{children}</code>
    </pre>
  );
}

/** Bolum: solda yapiskan baslik + kucuk etiket, sagda govde (VitrinSection) */
function Bolum({ id, eyebrow, title, children }: {
  id: string;
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <VitrinSection id={id} title={title} note={eyebrow}>
      <div className={GOVDE}>{children}</div>
    </VitrinSection>
  );
}

/** Sirali adim: numara anlam tasir (ana sayfadaki "nasil calisir" satirlariyla ayni duzen) */
function Adim({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-3 border-b border-border py-5">
      <span className="pt-1 font-mono text-vitrin-rail text-brand-vivid tabular-nums" aria-hidden>0{n}</span>
      <div>{children}</div>
    </li>
  );
}

/**
 * Koyu vitrin (Kasim 2026): iki tonlu baslik, altinda solda yapiskan baslikli
 * bolumler. Kapanis cagrisini ortak VitrinCta yapar (marketing-shell).
 */
export default function BotPage() {
  return (
    <>
      <VitrinHero
        before={<Breadcrumbs items={[{ label: 'RanksUpBot' }]} />}
        rail="RanksUpBot"
        a="RanksUp’ın"
        b="tarayıcısı"
        lead={
          <p>
            RanksUpBot, RanksUp’ın sitelere istek gönderirken kullandığı kimliktir. Her istekte kendini bu adla tanıtır;
            tarayıcı taklidi yapmaz, bot korumasını ya da doğrulama ekranlarını aşmaya çalışmaz.
          </p>
        }
      />

      <Bolum id="kimlik" eyebrow="Kimlik" title="Kullanıcı ajanı">
        <p>RanksUpBot isteklerinde User-Agent başlığı tam olarak şudur:</p>
        <Kod>{BOT_UA}</Kod>
        <p>
          Kurallarınızda “RanksUpBot” ifadesini arayın. Bu ad yalnızca bir beyandır: herkes kendi isteğine aynı adı
          yazabilir. Bu yüzden izin kurallarını dar tutmanızı öneririz (aşağıda).
        </p>
      </Bolum>

      <Bolum id="kapsam" eyebrow="Kapsam" title="Neyi, ne zaman okur?">
        {/* Her okuma turu bir satir: ustte ad, altinda aciklama */}
        <ul className="border-t border-border">
          <li className={KAPSAM_SATIR}>
            <strong className={KAPSAM_AD}>RanksUp’a eklenen siteler.</strong> Sitesini RanksUp’a
            ekleyen kullanıcının başlattığı işlerle ve planına bağlı zamanlanmış görevlerle:
            <ul className="mt-3 list-disc space-y-1.5 pl-5 marker:text-dim">
              <li>site taraması ve denetimi: sayfalar, robots.txt, sitemap ve llms.txt;</li>
              <li>GEO analizi: ana sayfa, llms.txt ve site haritasındaki içerik sayfalarından küçük bir örneklem;</li>
              <li>sayfa SEO (snippet) taraması, şema doğrulaması, statik HTML düzeltmesi ve takılmış sayfa kurtarma için ilgili sayfalar;</li>
              <li>görsel alt metni: öneri için görsel dosyaları; alt metin yazıldıktan sonra yayında olduğunu doğrulamak için sayfanın kendisi;</li>
              <li>site eklenirken sektör ve altyapı (CMS) tespiti için ana sayfa ve birkaç bilinen uç (ör. WordPress REST); JavaScript ile çizilen sitelerde ana sayfa aynı kimlikle başsız bir tarayıcıda açılır;</li>
              <li>yerel ölçüm için ana sayfadaki işletme adı, adres ve telefon bilgisi;</li>
              <li>AI tarayıcı trafiği panelinde oran hesaplamak için site haritasındaki sayfa sayısı;</li>
              <li>kök dosya düzeltmesinden önce ve sonra robots.txt, sitemap.xml ya da llms.txt’nin canlı hali.</li>
            </ul>
          </li>
          <li className={KAPSAM_SATIR}>
            <strong className={KAPSAM_AD}>Ajan hazırlığı dosyaları.</strong> Aynı sitelerde ana sayfa,
            robots.txt, llms.txt, llms-full.txt, sitemap.xml ve sitemap_index.xml, robots.txt’te bildirilen site haritaları,
            openapi.json ve auth.md; /.well-known altında auth.md, api-catalog, ai-catalog.json (ve bu katalogda listelenen
            MCP sunucu / A2A ajan kartları), agent-card.json, eski agent.json, eski MCP keşif dosyaları mcp.json ve
            mcp/server-card.json; uygulaması bağlı sitelerde apple-app-site-association. E-ticaret izi olan sitelerde
            ayrıca ürün site haritası, en fazla 3 ürün sayfası, ana sayfada ya da site haritasında bildirilen ürün akışları
            (en fazla 2), Shopify izi varsa products.json?limit=1, WooCommerce izi varsa wp-json/wc/store/v1/products?per_page=1
            okunur (ilk ürün yeterlidir). Sitenin var olmayan adreslere de
            aynı sayfayı dönüp dönmediğini (soft-404) anlamak için rastgele adlı, var olmayan tek bir yol istenir.
            robots.txt’te bildirilen site haritaları ve katalogdaki kart adresleri başka bir alan adındaysa oradan okunur.
          </li>
          <li className={KAPSAM_SATIR}>
            <strong className={KAPSAM_AD}>Makalelerdeki dış bağlantılar.</strong> RanksUp’ta üretilen
            makalelerdeki bağlantıların çalışıp çalışmadığını denetlemek için bağlantı verilen adreslere kısa bir HEAD ya da
            GET isteği gönderir.
          </li>
          <li className={KAPSAM_SATIR}>
            <strong className={KAPSAM_AD}>Rakip blogları.</strong> Konu önerisi için kullanıcının marka
            profilindeki rakip sitelerin RSS akışlarını ve blog sayfasını okur.
          </li>
          <li className={KAPSAM_SATIR}>
            <strong className={KAPSAM_AD}>Ücretsiz AI görünürlük kontrolü.</strong> Bir ziyaretçi
            RanksUp’ta bir alan adı için kontrol istediğinde o alan adının yalnızca ana sayfasını okur; marka adını ve
            sayfa başlığını çıkarmak için. Sonucu e-postayla takip etmeyi seçenler için bu okuma dönemsel olarak
            tekrarlanır.
          </li>
          <li className={KAPSAM_SATIR}>
            <strong className={KAPSAM_AD}>Sektör takibi.</strong> SEO, GEO ve ASO sektöründeki gelişmeleri
            izlemek için herkese açık RSS/Atom akışlarını ve bu akışlarda ya da izlenen X gönderilerinde bağlantısı verilen
            makaleleri okur.
          </li>
          <li className={KAPSAM_SATIR}>
            <strong className={KAPSAM_AD}>Pazar araştırması.</strong> RanksUp ekibinin elle
            başlattığı araçlar herkese açık kurum ve sektör listelerini ve şirket sitelerinin herkese açık iletişim
            sayfalarını, istekler arasında bekleyerek okur.
          </li>
        </ul>
      </Bolum>

      <Bolum id="robots" eyebrow="robots.txt" title="robots.txt kurallarına nasıl uyar?">
        <p>
          RanksUp’a eklenen sitelerin taramasında robots.txt’te açıkça <code className="font-mono text-foreground">User-agent: RanksUpBot</code>{' '}
          için yazılmış gruba uyar. Genel <code className="font-mono text-foreground">User-agent: *</code> grubunu bu
          taramada uygulamaz: taramayı sitenin sahibi istedi ve genel kurallar çoğu zaman arama motorları dışındaki
          botları kapatmak için yazılır.
        </p>
        <p>RanksUpBot’un sitenizi taramasını tamamen durdurmak için:</p>
        <Kod>{'User-agent: RanksUpBot\nDisallow: /'}</Kod>
        <p>Yalnızca bir bölümü kapatmak için:</p>
        <Kod>{'User-agent: RanksUpBot\nDisallow: /yonetim/'}</Kod>
        <p>
          Bu gruba site taraması (sayfa keşfi ve adres envanteri) ile yerel işletme bilgisi okuması uyar. GEO analizi,
          ajan hazırlığı dosyaları, ücretsiz kontrol ve pazar araştırması gibi diğer okumalar bu gruba bakmaz; tüm
          RanksUpBot isteklerini kesin olarak durdurmak için güvenlik duvarınızda bu kullanıcı ajanını engelleyin.
        </p>
      </Bolum>

      <Bolum id="izin" eyebrow="Cloudflare" title="Cloudflare’de izin vermek">
        <ol className="border-t border-border">
          <Adim n={1}>
            Cloudflare panelinde <strong className="font-medium text-foreground">Security rules</strong> sayfasını açın ve{' '}
            <strong className="font-medium text-foreground">Create rule → Custom rules</strong> seçin.
          </Adim>
          <Adim n={2}>
            İfadeyi girin (eşleşme büyük-küçük harfe duyarlıdır):
            <Kod>{'(http.user_agent contains "RanksUpBot")'}</Kod>
          </Adim>
          <Adim n={3}>
            <strong className="font-medium text-foreground">Choose action</strong> menüsünden{' '}
            <strong className="font-medium text-foreground">Skip</strong> seçin ve yalnızca RanksUpBot’u engelleyen
            korumaları işaretleyin; örneğin “All Super Bot Fight Mode rules”, “All managed rules” ya da “Browser
            Integrity Check”. Hız sınırlamayı atlamanız gerekmez.
          </Adim>
          <Adim n={4}>
            <strong className="font-medium text-foreground">Deploy</strong> ile kaydedin.
          </Adim>
        </ol>
        <p>
          Ücretsiz plandaki Bot Fight Mode bu kuralla atlanamaz. İstisna tanımlamak için Cloudflare, Skip kurallarını
          destekleyen Super Bot Fight Mode’u öneriyor; diğer seçenek Bot Fight Mode’u kapatmak. Kaynaklar:{' '}
          <a href={CF_SKIP_RULE_DOCS} className={VITRIN_LINK} rel="noopener" target="_blank">Skip kuralı</a>,{' '}
          <a href={CF_SKIP_DOCS} className={VITRIN_LINK} rel="noopener" target="_blank">atlama seçenekleri</a>,{' '}
          <a href={CF_BFM_DOCS} className={VITRIN_LINK} rel="noopener" target="_blank">Bot Fight Mode</a>.
        </p>
        <p>
          Kullanıcı ajanı taklit edilebildiği için kuralı dar tutun. RanksUpBot için sabit bir IP listesi
          yayımlamıyoruz. Başka bir güvenlik duvarı kullanıyorsanız kullanıcı ajanında “RanksUpBot” geçen isteklere
          izin veren bir kural ekleyin.
        </p>
      </Bolum>

      <Bolum id="engel" eyebrow="Engellemek" title="RanksUpBot’u engellemek">
        <p>
          robots.txt yeterliyse yukarıdaki <code className="font-mono text-foreground">Disallow: /</code> grubunu
          ekleyin. Tüm istekleri durdurmak için Cloudflare’de aynı ifadeyle bir kural oluşturup{' '}
          <strong className="font-medium text-foreground">Block</strong> eylemini seçin.
        </p>
      </Bolum>

      <Bolum id="diger" eyebrow="Eski kimlik" title="RanksUpIntel">
        <p>
          Sektör takibi okumaları daha önce “RanksUpIntel” adıyla yapılıyordu; artık RanksUpBot kimliğini kullanır.
          “RanksUpIntel” adı yalnızca herkese açık X gönderilerini okumak için kullandığımız üçüncü taraf bir servise
          (api.fxtwitter.com) giden isteklerde geçer; sitelere bu adla istek gönderilmez.
        </p>
      </Bolum>

      <Bolum id="iletisim" eyebrow="İletişim" title="Soru ve şikâyetler">
        <p>
          RanksUpBot ile ilgili her konuda bize yazın:{' '}
          <a href={`mailto:${SUPPORT_EMAIL}`} className={VITRIN_LINK}>{SUPPORT_EMAIL}</a>.
          RanksUp’ı kendi yapay zekâ istemcinize bağlamak istiyorsanız{' '}
          <a href="/agent-setup.txt" className={VITRIN_LINK}>ajan kurulum rehberine</a>{' '}
          bakın.
        </p>
      </Bolum>

      <VitrinSection title={<span lang="en">In English</span>}>
        <div lang="en" className={GOVDE}>
          <p>
            RanksUpBot is the identity RanksUp uses when it requests pages. It always sends the user agent above, never
            impersonates a browser and never tries to get around bot protection or challenge pages.
          </p>
          <p>
            It reads pages, robots.txt, sitemaps, llms.txt, images and agent discovery files (llms-full.txt,
            /.well-known/ai-catalog.json and the MCP / A2A cards it lists, agent-card.json, legacy agent.json and MCP files,
            apple-app-site-association, one random non-existent path for soft-404 detection) of sites that their users added
            to RanksUp; external links in articles generated in RanksUp; RSS feeds and blog pages of competitors in a
            user&apos;s brand profile; the home page of a domain when a visitor requests a free AI visibility check; public
            industry feeds; and public directories and public contact pages during manually started market research.
          </p>
          <p>
            Site crawls and the local business info read follow an explicit{' '}
            <code className="font-mono text-foreground">User-agent: RanksUpBot</code> group in robots.txt (the generic{' '}
            <code className="font-mono text-foreground">*</code> group is not applied there); other reads do not.
            To allow it on Cloudflare, add a custom rule matching{' '}
            <code className="font-mono text-foreground">(http.user_agent contains &quot;RanksUpBot&quot;)</code> with the
            Skip action (Bot Fight Mode on the Free plan cannot be skipped this way); to block every request, use the Block
            action. Contact:{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`} className={VITRIN_LINK}>{SUPPORT_EMAIL}</a>.
          </p>
        </div>
      </VitrinSection>

      <VitrinBand className="py-8 lg:py-10">
        <p className="text-sm text-muted-foreground">
          <Link href="/" className={VITRIN_LINK}>Ana sayfaya dön</Link>
        </p>
      </VitrinBand>
    </>
  );
}
