# RanksUp Sosyal Kit v2 — "Basamak"

Marka sistemi v1 spec'ine ("BASAMAK") birebir uyan sosyal görsel şablonları.
Hepsi 1200x1200 HTML. Şablonlar self-contained DEĞİLDİR: fontlar `../fonts/fonts.css`
üzerinden gelir (Sora + Geist, yerel woff2) — şablonlar `fonts/` klasörüyle birlikte taşınır,
tek başına kopyalanan HTML'de fontlar sistem varsayılanına düşer.

> Not: Geist Mono yerel dosyası yok; mono etiketler sistem monospace'ine düşer
> (`ui-monospace / SF Mono / Menlo`). İstenirse ileride fonts.css'e Geist Mono woff2 eklenebilir.

## Dosyalar

| Dosya | Ne işe yarar | Zemin |
|---|---|---|
| `01-kapak.html` | Duyuru kapağı (grid-paper + basamak köşe) | ink |
| `02-bulgu-sayi.html` | Dev tek sayı kartı ("BULGU 01") | bone |
| `03-bulgu-bar.html` | Yatay bar grafik kartı (4 satır DataBar) | bone |
| `04-lockup-ortaklik.html` | Ortaklık lockup'ı — `{{PARTNER}}` parametrik | ink |
| `04a-ofsayt.html` / `04b-kobipratik.html` / `04c-vanoksia.html` | Hazır partner kopyaları | ink |
| `05-sektor-endeks.html` | AI Sektör Endeksi kapağı (büyük basamak kompozisyonu) | ink |
| `06-karusel-sayfa.html` | Carousel iç sayfası (serbest gövde + sayfa göstergesi) | bone |

## Placeholder'lar

Dosyayı aç, `{{...}}` geçen her yeri gerçek içerikle değiştir. Braces dahil tamamı silinir.

- `02` — `{{KAYNAK}}` (örn. `1.240 CEVAP · AĞUSTOS 2026`), `{{SAYI}}` (örn. `%67`),
  `{{ETİKET...}}` (mono alt etiket), `{{AÇIKLAMA...}}` (1-2 kısa cümle).
  Kısa sayılarda `.num` font-size 280-320px'e çıkarılabilir (şu an 210px).
- `03` — `{{BAŞLIK}}`, `{{MARKA_1..4}}`, `{{DEĞER_1..4}}`. **Önemli:** her `.fill`
  öğesinin `style="width:..%"` değerini gerçek değerle orantılı elle güncelle
  (en büyük değer ≈ %82-90 olacak şekilde ölçekle). İlk satır `pri` (turuncu) = senin markan /
  birincil seri; diğerleri taş renkleri.
- `04` — `{{PARTNER}}` düz Sora yazı. Partner logosu KULLANMA (elimizde vektörü yoksa
  uydurma logo çizilmez — spec kuralı). Mono alt satır (`7 AI MOTORU · ORTAK ÖLÇÜM`)
  kampanyaya göre değiştirilebilir.
- `05` — `{{SEKTÖR}}` (örn. `Finans`), `{{X}}` (test edilen prompt sayısı).
  Uzun sektör adında h1 font-size'ı 104px'ten 80-88px'e düşür.
- `06` — `{{N}}`, `{{TOPLAM}}`, `{{BAŞLIK}}`, gövde tamamen serbest (`.content` içini
  paragraf/liste/mini bar ile doldur). Alt-soldaki sayfa göstergesinde `.on` sınıfını
  bulunduğun sayfanın karesine taşı (soldan sağa = 1..5).

## PNG üretimi

Mevcut yöntem (v1 ile aynı): headless Chrome, @2x ölçek → 2400x2400 px çıktı.

```bash
cd reklam/sosyal/v2
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

for f in 01-kapak 02-bulgu-sayi 03-bulgu-bar 04a-ofsayt 04b-kobipratik 04c-vanoksia 05-sektor-endeks 06-karusel-sayfa; do
  "$CHROME" --headless=new --force-device-scale-factor=2 \
    --screenshot="$PWD/$f.png" --window-size=1200,1200 "file://$PWD/$f.html"
done
```

Alternatifler:
- Chrome'da dosyayı aç → DevTools → Cmd+Shift+P → "Capture screenshot" (tam boyut).
- `npx playwright screenshot --viewport-size=1200,1200 --device-scale-factor=2 "file://$PWD/01-kapak.html" 01-kapak.png`

## İÇERİK DÜRÜSTLÜĞÜ

Şablonlardaki örnek sayılar ve `{{...}}` örnekleri **temsilidir**. Yayınlamadan önce
gerçek ölçüm verisiyle doldur; kaynağı (tarih + cevap/prompt sayısı) eyebrow'daki
`{{KAYNAK}}` alanına yaz. Tahmin/üçüncü parti veri kullanılıyorsa görselde belirt
(v1 metinler.md'deki Ahrefs kuralı bu kitte de geçerli). Partner görselleri (04x)
yayınlanmadan önce partnerin onayı alınır.

## Tasarım kuralları (kısa hatırlatma — bağlayıcı spec: marka sistemi v1 "BASAMAK")

- Renkler: ink `#171310`, bone `#F6F3EC`, paper `#FCFAF6`, turuncu `#E04E24`
  (koyu zeminde vurgu `#F1652F`), taş `#8A8177` / `#C9BFB2`.
- YASAK: gradient, glow, mesh, dither/halftone, renkli gölge, gradient text, 28px+ radius.
- Basamak motifi: kareler sağ-üste tırmanır, SON kare her zaman turuncu (ok ucu).
- Mono etiketler: uppercase, letter-spacing `.14em` ("ölçüm sesi").
- Koyu zeminde grafik kağıdı grid'i: 1px, bone %5, 48px hücre. Açık zeminde grid yok.
- Wordmark: "Ranks" (zemine zıt) + ↗ ok (turuncu) + "Up" (turuncu) — her yerde aynı.
