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

## Lisans notu

Remotion ücretsiz lisansı, **en fazla 3 çalışanı olan** şirketler (ve bireyler, kâr amacı
gütmeyenler) için geçerlidir. RanksUp bugün bu koşulu sağlıyor. Çalışan sayısı 4'ü geçtiği anda
Remotion'un ücretli şirket lisansı gerekir — bkz. <https://www.remotion.dev/license>.
Player'daki `acknowledgeRemotionLicense` prop'u yalnız konsol uyarısını kapatır; lisans
yükümlülüğünü değiştirmez.
