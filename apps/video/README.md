# @luviai/video — RanksUp ürün videoları (Remotion)

Landing sayfasındaki videolar kod olarak burada yazılır ve [Remotion](https://www.remotion.dev) ile
render edilir. Çıktılar `apps/web/public/landing-media/` altına gider ve repoya commit'lenir; web uygulamasının
build'i bu paketi derlemeyi **gerektirmez** (yalnız `AiScan` kaynak TSX olarak `transpilePackages`
ile tüketilir).

| Kompozisyon | Boyut | Süre | Nerede |
| --- | --- | --- | --- |
| `HeroLoopLight` / `HeroLoopDark` | 1920×1080 @30 (çıkış 1440×810) | 20 sn, kusursuz döngü | Landing hero'su — sessiz, otomatik, döngülü `<video>`; temaya göre kaynak |
| `Explainer` | 1920×1080 @30 (çıkış 1440×810) | 70 sn, Türkçe altyazı, ses yok | "Nasıl çalışır" diyaloğu (`preload="none"`) |
| `AiScan` | 1280×720 @30 | 10 sn, parametrik | Alan adı testi sonucunda `@remotion/player` ile canlı (render dosyası yok) |
| `ProductIntro` | 1920×1080 @30 | 38 sn, müzik + efekt | Tanıtım filmi (kanca → 4 adım → CTA) — `out/marketing/` |
| `SocialAd` | 1080×1920 @30 | 15 sn, vurusa kilitli | Reels / TikTok / Shorts — `out/marketing/` |
| `FeatureExplainer` | 1920×1080 @30 | 72 sn, Türkçe altyazı + müzik | Panel turu (canlı ekran kaydı üslubu) — `out/marketing/` |
| `ArticleShort` | 1080×1920 @30 | tempo: hızlı 15 sn · normal 20–50 sn · yavaş 25–60 sn (metne göre), parametrik | **RanksUp Video** (ürün): müşterinin yayındaki makalesinden markalı kısa video — sunucuda `apps/api/public/videos/<siteId>/`; CLI denemesi `out/article-shorts/` |
| `SiteIntro` / `SiteIntroWide` | 1080×1920 / 1920×1080 @30 | hızlı 15 sn / 24 sn · normal 15–45 sn · yavaş 25–60 sn, parametrik | **RanksUp Video** site tanıtımı: müşterinin anasayfası + marka profili; marka rengi zemin, logo, 3 hizmet kartı |
| `ProductShort` / `ProductWide` | 1080×1920 / 1920×1080 @30 | hızlı 15 sn · normal 15–50 sn · yavaş 25–60 sn, parametrik | **RanksUp Video** ürün tanıtımı: müşterinin kendi sayfası; ürün görseli (yavaş yakınlaşma), özellik listesi, yalnız doğrulanmış fiyat etiketi |

## Komutlar

```bash
# Studio (önizleme / düzenleme)
pnpm --filter @luviai/video studio

# Hepsini render et → apps/web/public/landing-media/{hero-loop-light,hero-loop-dark,explainer}.{mp4,webm,jpg}
pnpm --filter @luviai/video render

# Yalnız biri
pnpm --filter @luviai/video render:hero
pnpm --filter @luviai/video render:explainer

# Tip kontrolü
pnpm --filter @luviai/video typecheck

# Pazarlama videoları → apps/video/out/marketing/ (mp4 + poster jpg + temas sayfası png)
pnpm --filter @luviai/video render:marketing                 # üçü, sesli (-14 LUFS)
pnpm --filter @luviai/video render:marketing SocialAd        # yalnız biri
pnpm --filter @luviai/video render:marketing -- --muted      # ek olarak *-muted.mp4 (ses izi yok)
pnpm --filter @luviai/video audio                            # yalnız müziği/efektleri yeniden sentezle

# Tek kare / AiScan'i farklı props ile denemek
pnpm --filter @luviai/video exec remotion still src/index.ts HeroLoopLight out/hero.png --frame=520
pnpm --filter @luviai/video exec remotion render src/index.ts AiScan out/aiscan.mp4 \
  --props='{"domain":"ornek.com","score":43}'
```

İlk render'da Remotion, Chrome Headless Shell'i `node_modules/.remotion/` altına indirir (ağ gerekir).
Kodlama ayarları (`crf`, ölçek, poster karesi) `scripts/render.mjs` içinde.

## Kurallar

- **Rakam uydurulmaz.** HeroLoop KPI'ları yalnız ölçülmüş KobiPratik vakasından gelir (landing
  "Sonuçlar" bölümüyle aynı kaynak: Search Console + App Store sıralama ölçümleri). Örnek amaçlı
  paneller ekranda "Örnek ekran / Örnek rapor" etiketi taşır.
- **Marka tokenları** `src/tokens.ts`'tedir (`apps/web/tailwind.config.ts` + `globals.css` kopyası).
  Web'de bir token değişirse burayı güncelleyip videoları yeniden render et. Mor/eflatun yok.
- Animasyon yalnız Remotion API'siyle (`useCurrentFrame`, `interpolate`, `spring`, `Sequence`);
  CSS animasyonu / animejs kullanılmaz (render'da kare kare deterministik olmalı).
- Logo: yalnız RanksUp'ın kendi logosu (`brand-logo.tsx` kopyası). AI motorları metin etiketiyle
  gösterilir; üçüncü taraf logoları kullanılmaz.
- HeroLoop'ta poster karesi (520) web'deki `hero-video.tsx` `POSTER_SECONDS` ile eşleşir; birini
  değiştirirsen ötekini de değiştir.

## Pazarlama videoları (ProductIntro · SocialAd · FeatureExplainer)

- **Tek zaman çizelgesi:** `src/marketing/timeline.json` (120 BPM, 1 vuruş = 15 kare). Sahne kesmeleri,
  her efekt anı (tık, yazma, pop, zil…), müzik bölümleri ve FeatureExplainer altyazıları buradadır.
  Hem Remotion sahneleri hem `scripts/audio/synth.mjs` bu dosyayı okur; bir kesmeyi kaydırınca
  `pnpm --filter @luviai/video audio` ile sesi yeniden üret, görüntü ve ses yine aynı ızgaraya oturur.
- **Ses:** müzik ve arayüz efektleri kodla sentezlenir (sinüs/gürültü osilatörleri, zarflar, basit
  filtreler, Freeverb benzeri yankı; örnek/sample yok, tohumlu rastgelelik → her çalıştırmada aynı dosya).
  Çıktı `public/audio/*.wav` (git'e girmez, render:marketing önce üretir). Studio'da önizlemeden önce
  bir kez `audio` komutunu çalıştır. Render sonrası ffmpeg iki geçişli loudnorm: -14 LUFS, -1.5 dBTP.
- **Sessiz varyant:** her kompozisyonun `muted` prop'u var (`--props='{"muted":true}'`) ya da
  `render:marketing -- --muted`.
- **Fontlar:** `public/fonts/` — Sora + Plus Jakarta Sans (OFL 1.1, `public/fonts/OFL.txt`); `useBrandFonts()`
  yüklenene kadar render'ı bekletir.
- **İçerik kuralları:** paneller "Örnek ekran / Örnek ölçüm" etiketli, örnek site `ornekklinik.com`
  (kurgusal). AI asistanları SSS'deki 6 asistanla aynı ve yalnız metin etiketi. Ürün iddiaları
  landing/SSS metinleriyle aynı: 2 makale ücretsiz, kart gerekmez, haftada 1 ölçüm, 14 yayın hedefi,
  robots.txt yalnız onayla yazılır, puanlama 100/50/0. Sıralama/trafik vaadi yok.
- **Güvenli alan (SocialAd):** metin ve arayüz x 90–950, y 250–1500 içinde (sağdaki beğeni sütunu ve
  alttaki açıklama alanı boş kalır).

## Makaleden otomatik kısa video (ArticleShort — CLI denemesi)

```bash
pnpm --filter @luviai/video article-short https://www.kobipratik.com/pratik-kobi-rehberi/fatura-finansmani-nedir
#   --concurrency=N  render eşzamanlılığı (varsayılan çekirdek/2; 4'ün üstü kazanç getirmiyor)
#   --muted          ses izi yok   --no-sheet  temas sayfası üretme   --out=dizin
```

- Akış: fetch (robots.txt, `RanksUpBot/1.0` UA, boyut/süre sınırı) → brand (ad, logo, tema rengi) →
  extract (JSON-LD + başlıklar/maddeler) → script → audio → bundle → render → loudnorm → poster → temas
  sayfası. Her adım zamanlanır; özet `out/article-shorts/<slug>/timings.json`.
- **Metin adımı** (`scripts/article-short/copy.mjs`): CLI'da *çıkarımsal* — makalenin kendi başlık ve
  cümlelerini seçer, yalnız süsleme siler (emoji, numara rozeti). Üründe aynı JSON şemasını Claude
  Haiku 5.5 üretir (worker'da, structured output); `validateScript()` her iki yolda da zorunlu kapı:
  metindeki her sayı makalede birebir geçmeli, uzunluk sınırları, yenilik oranı (LLM yolunda aşım = ret).
- `copy.mjs`, `extract.mjs`, `brand.mjs` ve `render/article-short.mjs` **CLI ile sunucunun ortak
  kaynağıdır**; API bunları çalışma anında `import()` ile yükler (`apps/api/src/videos/article-short-kit.ts`).
  Birini değiştirirsen API testleri (`apps/api/src/videos/*.spec.ts`) aynı kodu sınar.
- **Şablon** (`src/article-short/`): metin kutuları canvas ölçümüyle sığdırılır (genişlik + yükseklik,
  taşma yok); renkler `palette.ts`'te WCAG kontrastına göre türetilir (renk yoksa RanksUp turuncusu).
  Müşteri logosu yalnız `<img>` (data: URI) olarak çizilir; çözülemezse baş harf monogramı.
- İndirilen her şey `out/article-shorts/<slug>/downloads/` altında, güvenilmeyen veri: yalnız okunur.
- Ses: `timeline.json` → `ArticleShort` ızgarası; her video için aynı dosya (bir kez sentezlenir).

## Site ve ürün tanıtım videoları (SiteIntro · ProductShort)

- **Kaynak** (`scripts/article-short/page.mjs`, saf, worker_thread'de): sayfanın JSON-LD'si (Organization,
  Product/Service, Offer, BreadcrumbList), başlık/H1/açıklama, gövde blokları (`extract.mjs` blocksOf; menü,
  alt bilgi, form atılır), görünür metin satırları ve "Etiket: değer" özellik satırları. Tüm desenler doğrusal,
  belge 600 KB'ta kırpılır (dev girdide < 200 ms; `apps/api/src/videos/promo-video.spec.ts`).
- **Fiyat — iki kaynak:** yapısal veride (JSON-LD Offer / product:price meta / itemprop=price) TEK değer ve aynı
  tutar aynı para birimiyle sayfanın görünür metninde → gösterilir (sayfadaki yazımıyla); aksi halde hiç
  gösterilmez. Gösterilen yazım ayrıca sayı korumasından geçer (`promo-copy.mjs verifyPriceText`).
- **Metin** (`scripts/article-short/promo-copy.mjs`): makaleyle aynı şema ve aynı koruyucu (sayı jetonları
  `copy.mjs`'ten). Site: kanca H1/slogan, alt satır kurum açıklaması, 3 hizmet (aynı seviyede art arda ≥3 başlık
  = hizmet ızgarası). Ürün: ad, fayda cümlesi, marka/kategori, 3 özellik (ürün açıklaması → özellik listesi →
  başlık ızgarası → "Etiket: değer"). Marka profili (DB Brain) yalnız kelime bağlamı; sayı kaynağı değildir.
- **Şablon** (`src/promo/`): `fit.ts`, `palette.ts`, `LogoTile` ArticleShort'tan; site tanıtımı marka renkli zemin,
  ürün tanıtımı ürün görseli önde. Görsel/logo yoksa marka kartı + baş harf. Fiyat etiketi yalnız `price` props'u
  doluysa (sunucu doğrulamadıysa alan boş gelir).
- **Render:** aynı paket ve hat (`render/article-short.mjs renderArticleShort({ compositionId })`); izinli
  kompozisyonlar `VIDEO_COMPOSITIONS` (liste dışı kimlik reddedilir). Ses: timeline.json `SiteIntro`,
  `SiteIntroWide`, `ProductShort` (yatay ürün dikeyle aynı ızgara ve ses).

## RanksUp Video tempoları (hızlı · normal · yavaş)

Müşteri her videoda tempoyu seçer (`POST /api/sites/:siteId/videos` `tempo`; varsayılan `normal`).
Tek kaynak `src/tempo/plan.mjs` + `timeline.json` `tempo` bölümü:

- **fast (Hızlı)** — bugünkü sabit ızgara (`compositions`, 120 BPM): 15 sn dikey, 24 sn yatay site. Tempo
  alanı olmayan eski kayıtlar/işler de böyle render edilir (sahne ve olay kareleri birebir aynı; müzik hızlı
  tempoya özgü üslup). "Hızlı — kısa metinler için": uzun metinde okunurluk kuralını sağlamaz (denetim yalnız raporlar).
- **normal** (90 BPM) — sahne süreleri **metinden** hesaplanır: her metin
  `max(2,0 sn; 0,3 sn × kelime + 1,0 sn)` tam görünür; üst üste biriken kart/özellik listesi son öğeden sonra
  ≥ 2,5 sn; sahneler vuruşa yuvarlanır (kesmeler müziğin vuruşuna oturur).
- **slow (Yavaş)** (72 BPM) — okuma payı 1,7 kat (tipik metinde normalin ~1,5 katı). Toplam 60 sn'yi (Reels
  sınırı) aşacaksa pay 0,05 adımlarla küçülür; en uzun metinde bile 1,0'ın altına inmez (denetim doğrular).
- Süre Remotion `calculateMetadata` ile props'tan kurulur (`Root.tsx`); render hattı tempo eksikse `fast` sayar
  ve poster karesini plandan alır (kanca tam görünürken).
- **Müzik — her tempo kendi üslubu** (`scripts/audio/styles.mjs`; aynı parçanın yavaşlatılmışı değil):
  - Hızlı (120 BPM, Sol majör, I–V–vi–IV): enerjik elektronik pop — four-on-the-floor kick + sidechain pompa,
    2/4 clap, 16'lık hi-hat, pluck arpej, punchy bas, parlak stab'lar, kısa yankı.
  - Normal (90 BPM, Mi♭ majör, ii–V–I–vi): sıcak chill-hop / lo-fi — %60 swing'li hi-hat, yumuşak kick + rim,
    FM elektrik piyano (7/9'lu akorlar), yuvarlak sub bas, çok düşük plak hışırtısı, orta yankı.
  - Yavaş (72 BPM, Re majör): sakin sinematik / ambient — yavaş filtre hareketli pad'ler, keçe piyano ve çan
    arpejleri, davul yok (ölçü başında yumuşak alçak tom), uzun yankı kuyruğu, hava kabarmaları.
  Efektler de üsluba göre: hızlıda keskin whoosh / vuruş, normalde yumuşak swish / tık, yavaşta havadar kabarma
  (sert vuruş yok). Pazarlama kompozisyonlarının izleri (`public/audio/<ad>.wav`) değişmez.
- **Ses dosyaları:** hızlı için şablon başına tek dosya (eski ızgaranın bölümleri ve efekt anları); normal/yavaş
  videonun süresi değiştiği için şablon × tempo başına giriş ve gövde **döngüsü** (16 vuruş; kararlı durumdan
  kesilir, döngü sınırı kesintisiz) + kapanış kökü (riser, vuruş, son akor) ve tempo başına efekt dosyaları —
  `public/audio/tempo/` (38 dosya, ~70 MB, git'e girmez; `node scripts/audio/synth.mjs --tempo`, deterministik,
  ~30 sn). `prepare:article-short` üretir; `timeline.json` ya da sentez kodu (`synth.mjs`, `styles.mjs`)
  dosyalardan yeniyse yeniden üretilir.
- **Müzik denetimi:** `node scripts/audio/check-music.mjs [--videos <klasör>] [--md5 <dosya>]` — kırpılma, DC,
  stereo, döngü dikişi (örnek sıçraması, yüksek frekans patlaması, RMS), üslup başına BPM / ses kümesi / swing /
  onset'lerin ızgaraya oturması / spektral denge, üslupların farklılığı; isteğe bağlı videoların loudness'ı
  (-14 LUFS, ≤ -1 dBTP) ve pazarlama izlerinin md5'i.
- **Okunurluk denetimi:** `node scripts/check-video-readability.mjs` — 5 biçim × 3 tempo; en uzun (koruyucu
  sınırları, kelime başına 5 karakter), en kısa, tipik ve 300 rastgele metin. normal/slow'da her metin ve liste
  kuralı, ≤ 60 sn ve paneldeki süre tablosu (`apps/web/src/lib/article-video.ts VIDEO_TEMPO_SECONDS`)
  doğrulanır; api `videos/video-tempo.spec.ts` aynı denetimi testte çalıştırır.

## RanksUp Video görsel stilleri (Klasik · Panel · Kâğıt · İsviçre · Sohbet · Diyagram · Gerçek görüntü)

Müşteri her videoda görsel stili seçer (`POST /api/sites/:siteId/videos` `style`; varsayılan `classic`). Tek kaynak
`src/styles/registry.mjs` (liste, fontlar, okunurluk çıkışları, stok klipler); kaynaklar ve lisanslar
`src/styles/CREDITS.md`.

- **Mimari:** beş kompozisyon (`ArticleShort`, `SiteIntro`, `SiteIntroWide`, `ProductShort`, `ProductWide`) `props.style`
  `classic` değilse `src/styles/StyledVideo.tsx`'e devreder; classic yol hiç değişmedi (origin/main ile 240 karede
  piksel piksel aynı — stil alanı olmayan eski kayıt / iş da classic). `StyledVideo` ortak olanı kurar: tempo çizelgesi
  + müzik (`TempoSoundtrack`), marka paleti (`palette.ts` — müşterinin rengi), metin modeli (`story.ts buildStory`:
  classic'in gösterdiği metinlerin aynısı) ve zaman pencereleri (`story.ts makeWin`). Stil kiti (`panel.tsx`,
  `paper.tsx`, `swiss.tsx`, `chat.tsx`, `diagram.tsx`, `footage.tsx`) yalnız görseli çizer; ortak yardımcılar `kit.tsx`.
- **Stil yalnız görsel:** metin (sayı koruması, `validateScript`), tempo planı (`src/tempo/plan.mjs`), müzik
  (`scripts/audio/styles.mjs`), marka rengi / logo / ad ve filigran her stilde aynı. Giriş yayları tempo çizelgesinin
  yayları; metinler classic ile aynı karelerde (ya da daha geç) çıkar (`STYLE_EXITS`). Kelime kelime girişlerde son
  kelime, tek parça metnin %95'e vardığı karede yerindedir (`kit.tsx stagger`).
- **Okunurluk:** `node scripts/check-video-readability.mjs` her stil × 5 biçim × 3 tempo için ayrı tablo basar
  (`STYLED_SPEC` stil TSX'inden bağımsız); stil fontlarının Türkçe glifleri (ş ğ ı İ â ç ö ü) TTF cmap'inden doğrulanır.
- **Fontlar:** Sora, Plus Jakarta Sans + Inter (İsviçre, Diyagram), Anton + Caveat (Kâğıt) — tam OFL dosyaları
  (`public/fonts/OFL.txt`), FontFace ile yerel yüklenir (Google Fonts `latin` alt kümesi Türkçe glifleri düşürür).
- **Gerçek görüntü:** Mixkit stok klipleri (`STOCK_CLIPS`, lisans: tek başına yeniden dağıtılamaz → git'e girmez,
  `public/stock/`). `prepare:article-short` indirir ve boyut + sha256 doğrular (`scripts/stock.mjs`, idempotent; ~110 MB,
  ilk seferde). Render hattı `assertStyleAssets` ile klipleri render'dan önce denetler; eksikse `StyleAssetError`
  (`code: VIDEO_STYLE_ASSETS_MISSING`) → api işi FAILED + tek iade, Türkçe mesaj. Render süresi diğer stillerin ~3,5
  katı (buzlu cam `backdrop-filter` + 1080p çözme; yerel ölçüm: 300 kare, eşzamanlılık 4'te 18 sn — classic 4,7 sn).
- **Panel:** `apps/web` "Video stili" kartları (`StylePicker`), önizlemeler `apps/web/public/video-styles/<stil>.jpg`
  (örnek render'lardan, mavi örnek marka). Liste her videonun stilini rozetle gösterir.

## RanksUp Video (ürün) — sunucu hattı

Müşterinin **yayındaki** makalesinden, anasayfasından (site tanıtımı) ya da kendi alan adındaki bir ürün/hizmet
sayfasından (ürün tanıtımı) sitenin adı, logosu ve rengiyle kısa video. Üç tür aynı aylık hakkı, aynı kuyruğu ve
aynı iade kuralını kullanır; tür/biçim `providerRaw.videoType` / `providerRaw.format` (migration yok). Profesyonel ve
üstü planlarda (`apps/api/src/billing/plans.ts` → `FEATURE_MIN_PLAN.articleVideo`, aylık hak
`VIDEOS_PER_MONTH`: Pro 20, Ajans 60, Kurumsal 200).

```
panel "Video üret" ─▶ POST /api/sites/:siteId/videos  (auth + site sahipliği + plan + hak: koşullu UPDATE)
                       { articleId } | { type:'site', format? } | { type:'product', pageUrl, format? }
                       Video satırı PENDING, providerRaw.engine='article-short'
                    ─▶ BullMQ 'video-render' (iş kimliği = video kimliği, 1 deneme)
worker (eşzamanlılık 1) ─▶ VideoRenderService.process (apps/api/src/videos/video-render.service.ts)
   GENERATING → makale DB'den (bodyMd → yayıncıyla aynı mdToHtml) → marka: anasayfa, SSRF korumalı
   safe-fetch + sharp (logo ≤256 px PNG) → metin: Haiku 5.5 + validateScript(strict), olmazsa çıkarımsal
   → render/article-short.mjs (paket bir kez, renderMedia, loudnorm, poster)
   → apps/api/public/videos/<siteId>/<videoId>.{mp4,jpg} (nginx /videos/) → READY + bildirim
   hata → FAILED + Türkçe mesaj + hak iadesi (tek kez); saatlik süpürücü takılı videoları kapatır
```

- **Paket bir kez:** `render/article-short.mjs` kaynak özeti (src/ + public/) aynıysa diskteki paketi
  kullanır (`node_modules/.cache/article-short/bundle-<özet>`); süreç içinde de bellekte tutar.
- **Eşzamanlılık:** kuyruk işi 1 (aynı anda tek video); bir videonun kare eşzamanlılığı
  `VIDEO_RENDER_CONCURRENCY` (varsayılan çekirdek/2, en az 1, en çok 4). API ayrı süreçte kalır.
- **ffmpeg:** `FFMPEG_PATH` > sistem `ffmpeg` > Remotion'ın kendi ffmpeg'i (`scripts/ffmpeg.mjs`). Remotion
  derlemesinde loudnorm/aac/mjpeg var; sistemde ffmpeg olmasa da loudnorm ve poster çalışır.
  (Eski API Video Factory'si 0db5a1c'de kaldırıldı; sunucuda sistem ffmpeg'i olup olmadığı repodan
  doğrulanamıyor — gerekmez.)
- **Ortam değişkenleri (hepsi isteğe bağlı):** `VIDEO_RENDER_CONCURRENCY`, `VIDEO_RENDER_WORKER=0`
  (bu worker'da tüketiciyi kapatır), `VIDEO_OUTPUT_DIR` (varsayılan `apps/api/public/videos`),
  `VIDEO_PUBLIC_BASE` (varsayılan `https://ranksup.ai/videos`), `FFMPEG_PATH`, `VIDEO_APP_DIR`
  (varsayılan `apps/video`). Mevcut `ANTHROPIC_API_KEY` ve `REDIS_URL` kullanılır.
- **Veri:** yeni tablo/migration yok — eski `videos` tablosu (`provider=SLIDESHOW`, `providerRaw.engine`)
  ve `users.videosUsedThisMonth` sayacı (makale sayacıyla aynı ay başı sıfırlaması).

### Üretim sunucusu (bir kez + her deploy)

```bash
# 1) Chrome Headless Shell'in Linux kütüphaneleri (Remotion "Linux dependencies", Ubuntu 24.04):
sudo apt install -y libnss3 libdbus-1-3 libatk1.0-0 libasound2t64 libxrandr2 libxkbcommon-dev \
  libxfixes3 libxcomposite1 libxdamage1 libgbm-dev libcups2 libcairo2 libpango-1.0-0 libatk-bridge2.0-0
#    (Ubuntu 22.04 / Debian'da libasound2t64 yoksa yerine libasound2)

# 2) Kod + bağımlılıklar (lockfile değişmedi; apps/video devDependency'si @remotion/cli
#    bundler + renderer'ı getirir — --prod KULLANMA)
cd /var/www/luviai && pnpm install --frozen-lockfile

# 3) Chrome indir + tempo müzikleri (hızlı / normal / yavaş, ilk seferde ~30 sn) + 'footage' stilinin Mixkit stok
#    klipleri (~110 MB, assets.mixkit.co'ya erişim gerekir; boyut + sha256 doğrulanır, sonra önbellekte) + Remotion
#    paketi + ffmpeg kaynağını yaz (her deploy'da güvenli). Stok indirilemezse komut sonda çıkış kodu 1 verir
#    (diğer adımlar tamamlanır); o sunucuda 'Gerçek görüntü' stili isteği FAILED + iade olur.
pnpm --filter @luviai/video prepare:article-short

# 4) Derle ve yeniden başlat
pnpm --filter @luviai/api build && pnpm --filter @luviai/worker build
pm2 restart luviai-api luviai-worker

# 5) Çıktı dizini ve nginx (eski Video Factory alias'ı yerinde mi?)
mkdir -p /var/www/luviai/apps/api/public/videos
grep -rn "location /videos" /etc/nginx/sites-enabled/ || echo "nginx: /videos/ -> /var/www/luviai/apps/api/public/videos/ alias'ını ekle"
```

Worker belleği: render sırasında Chrome sekmeleri worker'ın alt süreçleri olarak çalışır (yerel ölçüm:
eşzamanlılık 4'te 15 sn video ~12-25 sn; normal/yavaş videonun render süresi uzunluğuyla orantılı, 30 sn video ~35-45 sn). Bellek sıkışırsa önce `VIDEO_RENDER_CONCURRENCY`'yi düşür.

## Lisans notu

Remotion ücretsiz lisansı, **en fazla 3 çalışanı olan** şirketler (ve bireyler, kâr amacı
gütmeyenler) için geçerlidir. RanksUp bugün bu koşulu sağlıyor. Çalışan sayısı 4'ü geçtiği anda
Remotion'un ücretli şirket lisansı gerekir — bkz. <https://www.remotion.dev/license>.
Player'daki `acknowledgeRemotionLicense` prop'u yalnız konsol uyarısını kapatır; lisans
yükümlülüğünü değiştirmez.
