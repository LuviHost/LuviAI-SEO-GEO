# RanksUp Marka Sistemi — "Basamak" v1

> Bağlayıcı spec. Bu dosya marka kararlarının tek kaynağıdır; tereddütte bu dosya kazanır.
> Görsel marka kitabı (canlı örneklerle): https://claude.ai/code/artifact/38386633-da0e-4d1f-aeec-a58039374c02

## 1. Kimlik fikri

RanksUp, markaların **AI motorlarındaki görünürlüğünü ölçen** platformdur. Marka dili "ölçüm dünyası"ndan gelir:

- **Grafik kağıdı** — koyu zeminde hairline grid dokusu; ölçümün yapıldığı yüzey.
- **Mono etiketler** — her veri başlığı ölçüm sesiyle konuşur (uppercase, geniş tracking).
- **Sayı-önce hiyerarşi** — sayfa neyi kanıtlıyorsa en büyük o; başlık sayıyı açıklar.

İmza motifi **Basamak**: sağ-üste tırmanan kare basamaklar — logodaki ↗ okunun rasterize hali.

Rakip withmaya.ai'nin imzaları (dither/halftone doku, dağınık dama köşe süsleri) **asla** kullanılmaz.

## 2. Renk

Kanonik hex'ler — birebir bu değerler. Marka rengi **tek**tir: RanksUp Turuncu.

| Token | Hex | Kullanım |
|---|---|---|
| `ink` | `#171310` | Ana koyu zemin — ısınmış is siyahı |
| `ink-2` | `#211B15` | Koyu zeminde kart yüzeyi |
| `bone` | `#F6F3EC` | Açık zemin — ılık kemik |
| `paper` | `#FCFAF6` | Açık zeminde kart yüzeyi |
| `turuncu` | `#E04E24` | **TEK kanonik marka rengi**; logo okunun rengi; birincil veri serisi |
| `turuncu-bright` | `#F1652F` | Koyu zeminde hover/vurgu tonu |
| `taş` | `#8A8177` | İkincil veri serisi |
| `kum` | `#C9BFB2` | Üçüncül veri serisi |
| `pozitif` | `#3E9B4F` | Mention var — ✓ |
| `negatif` | `#C43C2E` | Mention yok — ✗ |

**Border:** açık zeminde ink %10–12 alpha; koyu zeminde bone %12–14 alpha.
**Muted metin:** açık zeminde `#6E6259`; koyu zeminde `#A99F92`.

## 3. Tipografi — üç rol

| Rol | Font | Kurallar |
|---|---|---|
| Display / Başlık | **Sora** 600/700/800 | tracking −0.03em…−0.045em, line-height 0.95–1.08. Logotype zaten Sora. |
| Gövde / UI | **Geist** 400/500 | Mevcut, değişmez. |
| "Ölçüm sesi" (eyebrow/etiket/veri başlığı) | **Geist Mono** (web dışında ui-monospace stack) | UPPERCASE, letter-spacing 0.14em, 11–13px, weight 500. |

Ölçüm sesi örnekleri: `BULGU 01 · İÇERİK TİPİ`, `7 AI MOTORU · GÜNLÜK TARAMA`.

**Instrument Serif italic marketing yüzeylerinden emeklidir.** Font yüklemesi kalabilir ama landing kullanmaz.

## 4. Basamak motifi

- **3–5 kare**, sağ-üste çıkan merdiven dizilimi; her adım bir kare sağa + bir kare yukarı, eşit boyut/boşluk.
- **Son kare turuncu** (ok ucu; koyu zeminde turuncu-bright), diğerleri zemine zıt renk düşük opacity (%14–25).
- Yön asla değişmez: **sağ-üst**.
- Kullanım: köşe süsü (sağ-üst), bölüm ayırıcı, liste bullet'ı, chart dili, boş-durum illüstrasyonu.
- **Doku:** koyu zeminde "grafik kağıdı" hairline grid — 1px çizgiler, bone %5 opacity, 48px hücre. Açık zeminde ink %4 ya da hiç.

## 5. Yüzey & katman

- **FLAT tasarım.** Dekoratif gölge YOK (fonksiyonel dropdown/modal gölgesi kalabilir). Her kart **1px border**.
- Radius: kart **12–16px**; chip/pill **999px**; buton **10px**. 28px+ "apple" radius marketing'de kullanılmaz.
- Bölüm ritmi: **ink bölüm ↔ bone bölüm** dönüşümlü. Her bölüm: mono eyebrow → Sora başlık → kısa lede.

## 6. Veri dili

- **Dev sayı:** Sora 800, `tabular-nums`; altında mono uppercase label.
- **Yatay bar:** track = zıt renk %8 alpha, tam genişlik; dolgu turuncu (birincil) / taş / kum (diğerleri); değer sağda Sora 700.
- **Mention durumu:** ✓ pozitif yeşil (`#3E9B4F`), ✗ negatif kırmızı (`#C43C2E`).

## 7. Ses & ton

Türkçe, kısa, iddialı, **veri-önce**. Sayı kahramandır. Pazarlama lafı değil ölçüm dili: "taradık", "ölçtük", "saydık".

Slogan çekirdeği: **"Ölçüyoruz. Gösteriyoruz. Yükseltiyoruz."**

✓ Böyle yaz:
- "7 motoru taradık. Markan 3'ünde çıktı."
- "1.204 yanıt saydık — 312'sinde anıldın."
- "Rakibin 2 motorda önünde. Kapatıyoruz."

✗ Böyle yazma:
- "Yapay zeka çağında markanızı parlatıyoruz!"
- "Devrim niteliğinde, yeni nesil AI çözümü."
- "Dijital dönüşüm yolculuğunuzda yanınızdayız."

## 8. Wordmark & lockup

Wordmark her yerde aynı: **"Ranks"** (zemine zıt) + **↗ ok** (turuncu) + **"Up"** (turuncu). Sora 700, tracking −0.03em.

Ok SVG (kaynak: `reklam/sosyal/linkedin.html`):

```html
<svg viewBox="0 0 40 40" fill="none">
  <path d="M10 30 L30 10" stroke="#E04E24" stroke-width="5.5" stroke-linecap="round"/>
  <path d="M17 8.5 L31.5 8.5 L31.5 23" stroke="#E04E24" stroke-width="5.5"
        stroke-linecap="round" stroke-linejoin="round"/>
</svg>
```

**Ortaklık kartı (lockup):** ink zemin, ortada `Ranks↗Up × {partner}`; × işareti muted (`#A99F92`), partner logosu/adı bone.

## 9. YAPMA listesi (tartışmaya kapalı)

- ✗ Mor-mavi gradientler
- ✗ Mesh gradient
- ✗ Renkli glow gölgeler
- ✗ Dither / halftone doku (withmaya imzası)
- ✗ Dağınık dama köşe süsleri (withmaya imzası)
- ✗ Gradient text
- ✗ 28px+ "apple" radius (marketing yüzeylerinde)
- ✗ Instrument Serif italic (marketing yüzeylerinde)
- ✗ Dekoratif gölge (flat sistem)

## 10. Web uygulaması — class & component haritası

Konum: `apps/web/src/components/brand/` (marka parçalarının tek çıkış noktası; elle stil kopyalama yok).

| Parça | Tip | Ne işe yarar |
|---|---|---|
| `surface-ink` | class | Koyu bölüm zemini: ink + grafik kağıdı grid dokusu |
| `card-brand` | class | Flat kart: 1px border, 14px radius, gölgesiz; ink-2/paper yüzey |
| `Eyebrow` | component | Ölçüm sesi etiketi: mono uppercase, 0.14em tracking, basamak bullet |
| `StatBlock` | component | Dev sayı (Sora 800, tabular-nums) + mono label |
| `DataBar` | component | Yatay ölçüm barı: %8 alpha track, turuncu/taş/kum dolgu, değer sağda |
| `StepMotif` | component | Basamak SVG — köşe, ayırıcı, bullet, boş-durum varyantları |
| `BrandLockup` | component | Ranks↗Up × partner ortaklık kartı (ink zemin) |

> Not: Bu klasör bu dalgada oluşturulur; yeni marka yüzeyi yazan herkes önce buraya bakar, yoksa buraya ekler.

## 11. Sosyal kit v2 — `reklam/sosyal/v2/`

v1 şablonları `reklam/sosyal/` kökünde durur (arşiv). **Yeni üretim her zaman v2'den yapılır** ve bu dosyadaki kurallara uyar (ink zemin, grid doku, basamak köşe, flat kart, tek turuncu).

| Dosya | Boyut | Kullanım |
|---|---|---|
| `v2/linkedin.html` | 1200×1200 | LinkedIn duyuru kartı |
| `v2/x.html` | 1600×900 | X (Twitter) kartı — yatay kompozisyon |
| `v2/case.html` | 1200×1200 | Vaka kartı: StatBlock + DataBar ile ölçüm sonucu |
| `v2/partner.html` | 1200×1200 | Ortaklık lockup kartı (Bölüm 8 kuralları) |
| `fonts/` | — | Sora + Geist woff2 (`reklam/sosyal/fonts/` ile paylaşılır; f1/f3 = Geist latin/latin-ext, f6/f7 = Sora latin/latin-ext, ikisi de variable) |

Şablonlar sabit boyutlu HTML sayfalarıdır; PNG çıktı sayfanın birebir ekran görüntüsüyle alınır (v1'deki `ranksup-*.png` akışıyla aynı).
