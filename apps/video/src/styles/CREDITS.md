# RanksUp Video stilleri — kaynaklar ve lisanslar

Stiller (`registry.mjs`) sahibin denedigi ~20 acik kaynak video yaklasimindan begenilenlerin **tekniginin**
Remotion'a tasinmasidir. Sunucuda tek motor var (Remotion 4); HyperFrames, motion-engine, Manim, MoviePy ya da
ffmpeg betikleri calisma aninda KULLANILMAZ. Denemelerdeki RanksUp tanitim metinleri, RanksUp logosu ve turuncu
renk urune girmedi: her stil musterinin rengi, logosu ve adiyla cizer (`palette.ts`, `LogoTile`). Lisanssiz
depolardan hicbir sey alinmadi.

| Stil | Turetildigi deneme | Kaynak proje / lisans | Alinan (teknik) | Kod kopyasi |
|---|---|---|---|---|
| `classic` | — | RanksUp | bugunku sablonlar, degismedi | — |
| `panel` | `17-remotion` (Remotion denemesi, 8,5/10); `E/proj9/src/Film.tsx`; `F/src-skills/ranksup-video` | video-shotcraft — **Apache-2.0** (Copyright 2026 Wei Yihao, <https://github.com/Vincentwei1021/video-shotcraft>); remotion-skills kurallari | acik "Apple-yumusak" alan + suruklenen isik lekeleri, bulaniktan yukari yayla gelen kelimeler, vurusta son kelimenin alti, beyaz arayuz kartlari, satir gomme (row-embed), panelin satir geldikce dolmasi, vurusa kilitli dikey itme, yalniz kesme karelerinde hiz bulanikligi, kartin marka karosuna donusmesi (ui-to-brand morph), CTA isiltisi | `kit.tsx`: `bezier`, `EASE`, `velocity`, `SpeedBlur` — shotcraft `fx/Polish.tsx` uyarlamasi (asagida) |
| `paper` | `A/hf/ranksup1/index.html` (HyperFrames denemesi 1) | HyperFrames (HeyGen) — **Apache-2.0**; kompozisyon denemede bizim yazdigimiz HTML | kagit zemin, dar kinetik BUYUK yazi (Anton) ve "carpma" girisi, SVG `stroke-dashoffset` ile elle cizilmis alt cizgi / halka / onay / ok, sert acik-koyu sahne donusu, yavas sahne yakinlasmasi, sekerek inen top | yok (yeniden yazildi) |
| `swiss` | `B/lemo-opuscar/films/ranksup-swiss` | lemo-opuscar "swiss-motion" — **MIT** (Copyright (c) 2026 LemoLab) | 6 sutun izgara + kilavuzlar, tek sinyal rengi, kesin egri `cubic-bezier(.7,0,.2,1)` + dogrusal, kirpma maskesinden yukselen kelimeler, cetvel + sira numarasi, asagidan silinen moduller, tarama cizgisi + cetvel centikleri, kirpma isaretleri, bicak cizgisi, sert sayfa kaydirma, izgaraya oturan sinyal modulu -> logo karosu | yalniz egri katsayilari (`swiss-motion/demo/ease.js` E) |
| `chat` | `E/proj10/scene.js` | motion-engine — **MIT** (Copyright (c) 2026 Oguzhan Kayan, <https://github.com/oguzhankayan/motion-engine>) | buyuyen giris kutusu, kullanici balonu "pop" (backOut 1,6), yaziyor noktalari, cevap balonu, odalar arasi savrulma (power4InOut + yatay bulaniklik + hiz cizgileri), pencerenin kesik cizgili yankilarla logo karosuna katlanmasi | yok (sahne denemede bizim; egriler standart GSAP formulleri) |
| `diagram` | `G/15-manim/src/promo.py` | Manim Community Edition — **MIT** (Copyright (c) 2018 3Blue1Brown LLC; Copyright (c) 2024 the Manim Community Developers) | noktali kagit, dugum kartlari + kendini cizen oklar (GrowArrow), satir satir kayan basliklar (LaggedStart), tarama cizgisi, Circumscribe vurgusu, vurgu kelimesinin renk degistirmesi, asagidan itilen kapanis karti, CTA nabzi (Indicate) | yok (Remotion'da yeniden yazildi; sunucuya Python / Manim eklenmedi) |
| `footage` | `I/19-moviepy/make_video.py`, `I/18-ffmpeg/build.sh` | MoviePy — **MIT** (Copyright (c) 2015 Zulko); ffmpeg (LGPL, yalniz deneme araci) | gercek stok goruntu, sahne basina yavas yakinlasma (Ken Burns), sicak renk (doygunluk 0,9, kaldirilmis siyahlar), yarim vurus capraz gecis, buzlu cam panel (alttaki goruntunun bulaniklasmasi — CSS `backdrop-filter`), kirik beyaz + marka isigi kapanis, logo "pop" | yok |

## video-shotcraft (Apache-2.0) — uyarlanan kod

- Kaynak: <https://github.com/Vincentwei1021/video-shotcraft>, `demos/.../fx/Polish.tsx` (deneme kopyasi `E/proj9/src/fx/Polish.tsx`).
- Copyright 2026 Wei Yihao. Lisans metni: `LICENSE-Apache-2.0-video-shotcraft.txt` (bu klasorde).
- Uyarlanan: `kit.tsx` icindeki `bezier` (CSS cubic-bezier cozucusu), `EASE` egri kumesi (snappy / out / smooth / exit /
  overshoot; `push` = shotcraft `Film.tsx` PUSH_EASE), `velocity` (merkezi fark hizi), `SpeedBlur` (hiza bagli yonlu
  SVG gauss bulanikligi).
- Degisiklikler (Apache-2.0 4b): TypeScript'e uyarlandi, Turkce yorumlar, `SpeedBlur` filtre kimligi `useId`'den,
  egri kumesi daraltildi; davranis ayni.

## Fontlar — SIL Open Font License 1.1

`public/fonts/OFL.txt` (Sora, Plus Jakarta Sans, Inter, Anton, Caveat). Tam (latin-ext) dosyalar; Turkce glifler
`scripts/check-video-readability.mjs checkStyleFonts()` ile her denetimde dogrulanir.

## Stok goruntu — Mixkit Stock Video Free License (`footage`)

- Lisans: <https://mixkit.co/license/#videoFree> — ticari kullanim serbest, atif gerekmez; klipler **tek basina
  yeniden dagitilamaz** -> git'e girmez (`apps/video/.gitignore`: `public/stock/`).
- Deploy'da `pnpm --filter @luviai/video prepare:article-short` (`scripts/stock.mjs`) asagidaki adreslerden indirir,
  boyut + sha256 dogrular (kayit: `registry.mjs` `STOCK_CLIPS`).
- Secim notr: eller / omuz ustu cekim; ekrandaki metin markanin kendi cam panelinde, konusma balonu yok — goruntudeki
  kisinin sozu ya da yorumu gibi okunmaz. Ofis klibi (42656) yalniz dikeyde, yuz disarida kalacak sekilde kirpilir.

| Dosya (`public/stock/`) | Mixkit sayfasi |
|---|---|
| `mixkit-4915-hands-typing-phone.mp4` | <https://mixkit.co/free-stock-video/hands-of-a-person-typing-on-a-cell-phone-4915/> |
| `mixkit-42652-laptop-typing.mp4` (yalniz ilk 5,2 sn: eller + klavye) | <https://mixkit.co/free-stock-video/entrepreneur-woman-typing-on-her-laptop-42652/> |
| `mixkit-42656-office-desk.mp4` (yalniz dikey kirpma) | <https://mixkit.co/free-stock-video/thoughtful-woman-working-in-her-office-42656/> |

## Muzik

Degismedi: tempo basina kendi sentezimiz (`scripts/audio/styles.mjs`); stil muzigi degistirmez.
