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
| `ArticleShort` | 1080×1920 @30 | 15 sn, parametrik (PROTOTİP) | Müşteri makalesinden otomatik kısa video — `out/article-shorts/` |

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

## Makaleden otomatik kısa video (ArticleShort — prototip)

```bash
pnpm --filter @luviai/video article-short https://www.kobipratik.com/pratik-kobi-rehberi/fatura-finansmani-nedir
#   --concurrency=N  render eşzamanlılığı (varsayılan çekirdek/2; 4'ün üstü kazanç getirmiyor)
#   --muted          ses izi yok   --no-sheet  temas sayfası üretme   --out=dizin
```

- Akış: fetch (robots.txt, `RanksUpBot/1.0` UA, boyut/süre sınırı) → brand (ad, logo, tema rengi) →
  extract (JSON-LD + başlıklar/maddeler) → script → audio → bundle → render → loudnorm → poster → temas
  sayfası. Her adım zamanlanır; özet `out/article-shorts/<slug>/timings.json`.
- **Metin adımı** (`scripts/article-short/copy.mjs`): bugün *çıkarımsal* — makalenin kendi başlık ve
  cümlelerini seçer, yalnız süsleme siler (emoji, numara rozeti). Üretimde aynı JSON şemasını Claude
  Haiku 5.5 üretir (worker'da, structured output); `validateScript()` her iki yolda da zorunlu kapı:
  metindeki her sayı makalede birebir geçmeli, uzunluk sınırları, yenilik oranı.
- **Şablon** (`src/article-short/`): metin kutuları canvas ölçümüyle sığdırılır (genişlik + yükseklik,
  taşma yok); renkler `palette.ts`'te WCAG kontrastına göre türetilir (renk yoksa RanksUp turuncusu).
  Müşteri logosu yalnız `<img>` (data: URI) olarak çizilir; çözülemezse baş harf monogramı.
- İndirilen her şey `out/article-shorts/<slug>/downloads/` altında, güvenilmeyen veri: yalnız okunur.
- Ses: `timeline.json` → `ArticleShort` ızgarası; her video için aynı dosya (bir kez sentezlenir).

## Lisans notu

Remotion ücretsiz lisansı, **en fazla 3 çalışanı olan** şirketler (ve bireyler, kâr amacı
gütmeyenler) için geçerlidir. RanksUp bugün bu koşulu sağlıyor. Çalışan sayısı 4'ü geçtiği anda
Remotion'un ücretli şirket lisansı gerekir — bkz. <https://www.remotion.dev/license>.
Player'daki `acknowledgeRemotionLicense` prop'u yalnız konsol uyarısını kapatır; lisans
yükümlülüğünü değiştirmez.
