# _kaynak — şablonlar ve render

Bu klasör TEKNİK: HTML şablonları, gömülü fontlar (`fonts/fonts.css`,
data-URI — internet gerekmez) ve arşiv kampanya dokümanları. Paylaşılacak
dosyalar platform klasörlerinde durur; buradan yalnızca yeniden üretim yapılır.

| Şablon | Çıktı | Boyut |
|---|---|---|
| `mit-1..5.html` | `../instagram/2026-08-25 mit-curutme-karusel/ranksup-mit-N.png` | 1080×1350 @2x |
| `mit-karusel-print.html` | `../linkedin/2026-08-25 mit-curutme-karusel/ranksup-mit-karusel.pdf` | 5 sayfa PDF |
| `mit-x.html` | `../x/2026-08-27 markali-soru-tuzagi/ranksup-mit-x.png` | 1600×900 @2x |
| `durustluk-linkedin.html` | `../linkedin/2026-08-31 durustluk-postu/ranksup-durustluk-linkedin.png` | 1200×1200 @2x |
| `gsc-linkedin.html` | `../linkedin/2026-08-27 gsc-12k-kilometre-tasi/ranksup-gsc-12k-linkedin.png` | 1200×1200 @2x |
| `gsc-x.html` | `../x/2026-08-27 gsc-12k-kilometre-tasi/ranksup-gsc-12k-x.png` | 1600×900 @2x |
| `case-linkedin.html` / `case-x.html` | vaka klasörleri | 1200×1200 / 1600×900 |
| `linkedin.html` / `x.html` | ai-gorunurluk klasörleri | 1200×1200 / 1600×900 |
| `fin-*.html` | finans klasörleri | çeşitli |
| `tanitim-1..10.html` | `../havuz-tanitim/ranksup-tanitim-N.png` | 1200×1200 @2x |
| `bilgi-1..10.html` | `../havuz-bilgi/ranksup-bilgi-N.png` | 1200×1200 @2x |
| `bilgi-x-1..10.html` | `../havuz-bilgi/x/ranksup-bilgi-x-N.png` | 1600×900 @2x |

## Render (bu klasörden)

```bash
cd reklam/sosyal/_kaynak
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

# İstihbarat serisi — tamamı
for i in 1 2 3 4 5; do
  "$CHROME" --headless=new --force-device-scale-factor=2 \
    --screenshot="$PWD/../instagram/2026-08-25 mit-curutme-karusel/ranksup-mit-$i.png" \
    --window-size=1080,1350 "file://$PWD/mit-$i.html"
done
# PDF: --virtual-time-budget ŞART — yoksa gömülü data-URI fontlar yüklenmeden
# basılıyor ve PDF'e Sora/Geist yerine Times/SF/Menlo gömülüyor (pdffonts ile doğrula).
# .hl gradient başlıklar PDF'te ince kutu çizgisi bırakıyordu → print şablonundaki .hl'e
# filter:opacity(.999) eklendi (span 300ppi bitmap basılır, çizgi yok). mit-1..5.html'de YOK;
# print dosyasını sayfalardan yeniden birleştirirsen bu satırı koru.
"$CHROME" --headless=new --virtual-time-budget=10000 \
  --print-to-pdf="$PWD/../linkedin/2026-08-25 mit-curutme-karusel/ranksup-mit-karusel.pdf" \
  --no-pdf-header-footer "file://$PWD/mit-karusel-print.html"
"$CHROME" --headless=new --force-device-scale-factor=2 \
  --screenshot="$PWD/../x/2026-08-27 markali-soru-tuzagi/ranksup-mit-x.png" \
  --window-size=1600,900 "file://$PWD/mit-x.html"
"$CHROME" --headless=new --force-device-scale-factor=2 \
  --screenshot="$PWD/../linkedin/2026-08-31 durustluk-postu/ranksup-durustluk-linkedin.png" \
  --window-size=1200,1200 "file://$PWD/durustluk-linkedin.html"

# GSC 12K kilometre taşı
"$CHROME" --headless=new --force-device-scale-factor=2 --virtual-time-budget=8000 \
  --screenshot="$PWD/../linkedin/2026-08-27 gsc-12k-kilometre-tasi/ranksup-gsc-12k-linkedin.png" \
  --window-size=1200,1200 "file://$PWD/gsc-linkedin.html"
"$CHROME" --headless=new --force-device-scale-factor=2 --virtual-time-budget=8000 \
  --screenshot="$PWD/../x/2026-08-27 gsc-12k-kilometre-tasi/ranksup-gsc-12k-x.png" \
  --window-size=1600,900 "file://$PWD/gsc-x.html"
```

⚠️ `gsc-*.html`'deki altıgen rozet, Google Search Console'un "Google Arama Etkisi"
rozetinin SVG ile yeniden çizimi — ekran görüntüsü değil. Google logosu bilerek
kullanılmadı; kaynak "Google Search Console" olarak yazıyla belirtiliyor.
Rakam değişirse (12K → 15K) hem `<text>12K</text>` hem başlık hem alıntı cümlesi
güncellenmeli.

Eski kampanyalar için aynı kalıp — dosya adı ve boyutu tablodan al.

⚠️ `mit-1..5.html`'de metin değiştirirsen `mit-karusel-print.html` OTOMATİK
güncellenmez — o dosya 5 sayfanın birleştirilmiş kopyası; aynı değişikliği
orada da yap (veya sayfalardan yeniden birleştir), sonra hem PNG hem PDF üret.

## Arşiv dokümanları

- `metinler.md` — 02.08 kampanyalarının tam paketi (metinler artık kampanya
  klasörlerindeki `metin.md`'lerde; burası arka plan + kurallar için).
- `metinler-istihbarat.md` — istihbarat serisinin tam paketi + **sayıların
  kaynak kaydı** (sondaki bölüm). Görseldeki bir sayıyı değiştirmeden önce oku.
