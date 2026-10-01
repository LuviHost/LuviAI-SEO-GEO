# RanksUp Sosyal Medya Takvimi

Yapı: `platform / TARİH kampanya-adı /` — her klasörde paylaşılacak görsel(ler)
ve kopyala-yapıştır hazır `metin.md`. Klasör adları `YYYY-AA-GG` ile başlar ki
dosya yöneticisinde kendiliğinden kronolojik sıralansın.

## Takvim

| Tarih | Gün | Platform | Kampanya | Klasör | Durum |
|---|---|---|---|---|---|
| 02.08.2026 | Paz | LinkedIn | Vaka çalışması (kobipratik) | `linkedin/2026-08-02 vaka-calismasi` | ☐ işaretle* |
| 02.08.2026 | Paz | X | Vaka çalışması — thread | `x/2026-08-02 vaka-calismasi` | ☐ işaretle* |
| +3-4 gün | — | LinkedIn | AI görünürlük (ürün) | `linkedin/2026-08-02 ai-gorunurluk` | ☐ işaretle* |
| +3-4 gün | — | X | AI görünürlük | `x/2026-08-02 ai-gorunurluk` | ☐ işaretle* |
| (hedefli) | — | LinkedIn | Finans raporu daveti (post+DM+PDF) | `linkedin/2026-08-02 finans-raporu-daveti` | ⛔ önkoşullu** |
| (hedefli) | — | X | Finans raporu daveti | `x/2026-08-02 finans-raporu-daveti` | ⛔ önkoşullu** |
| 25.08.2026 | Sal | LinkedIn | Mit çürütme karuseli (PDF belge) | `linkedin/2026-08-25 mit-curutme-karusel` | ✅ hazır — tarih ata*** |
| 25.08.2026 | Sal | Instagram | Mit çürütme karuseli (5 PNG) | `instagram/2026-08-25 mit-curutme-karusel` | ✅ hazır — tarih ata*** |
| 27.08.2026 | Per | LinkedIn | GSC 12K kilometre taşı | `linkedin/2026-08-27 gsc-12k-kilometre-tasi` | ☐ hazır† |
| 27.08.2026 | Per | X | GSC 12K kilometre taşı — thread | `x/2026-08-27 gsc-12k-kilometre-tasi` | ☐ hazır† |
| 27.08.2026 | Per | X | Markalı soru tuzağı | `x/2026-08-27 markali-soru-tuzagi` | ✅ hazır — tarih ata*** |
| 31.08.2026 | Pzt | LinkedIn | Dürüstlük postu | `linkedin/2026-08-31 durustluk-postu` | ✅ hazır — tarih ata*** |

\* 02.08 tarihli üçlü o gün ÜRETİLDİ; gerçekten paylaşılıp paylaşılmadığı bu
dosyada işaretli değil — paylaştıysan ☐ → ✅ yap, paylaşmadıysan tarihini önüne
koyup planla.

\** Finans daveti tarihli değil, HEDEFLİ kampanya: göndermeden önce
`finans-daveti.md` içindeki 3 şart (gerçek tarama, gerçek sayılar, gizlilik) karşılanmalı.

† **Tarih çakışması:** 27.08'de `markali-soru-tuzagi` de planlı ama o, istihbarat
serisinin önkoşuluna bağlı (aşağıya bak). GSC kilometre taşının önkoşulu yok —
kobipratik onayı gelince paylaşılabilir. İkisi aynı güne denk gelirse istihbarat
postunu kaydır, aynı gün iki X postu atma.

\*** **İstihbarat serisi ortak önkoşulu — KARŞILANDI (27.08.2026):** markalı-sorgu
ayrımı üretimde (Release 1: 26.08 deploy + backfill; Release 2: 27.08), "AI içerik
cezası" iddiasına ikinci kaynak (Google Search Central, resmi) eklendi. Seri
paylaşılabilir; 25.08 tarihi geçti → üç tarihi birlikte kaydır: mit karuseli
(LinkedIn PDF + Instagram) ilk uygun gün, X kartı +2 gün, dürüstlük postu hafta
sonu atlayarak EN SON. LinkedIn ilk yorumuna Google kaynağı linki.

## Havuz — tarihsiz içerik

`havuz-tanitim/` — 10 kartlık tanıtım seti (ne yapıyoruz / farkımız / ne
katıyor / CTA), 1200×1200: LinkedIn + Instagram + Facebook'ta aynı dosya.
Kart listesi ve metin önerileri: `havuz-tanitim/metin.md`.

`havuz-bilgi/` — 10 kartlık EĞİTİCİ seri (GEO nedir, llms.txt, bot türleri,
mention≠citation, fan-out...): satış değil öğretim; güven kurar. Listesi:
`havuz-bilgi/metin.md`. Yayın önkoşulsuz — hemen paylaşılabilir.

Önerilen ritim: haftada 2-3 kart, 2 bilgi kartına 1 tanıtım kartı.
Paylaşmaya karar verince yukarıdaki takvime satır ekle.

## Kurallar (özet)

- LinkedIn: dış link metinde değil İLK YORUMDA. En iyi saat hafta içi 10:00–12:00 / 20:00–22:00 (TR).
- X: link son tweet'e; ilk tweet'te hashtag yok.
- kobipratik adının geçtiği her içerik için yazılı onay şart.
- Yeni kampanya eklerken: `platform/YYYY-AA-GG kampanya-adi/` klasörü aç,
  içine görsel + `metin.md` koy, bu tabloya satır ekle.

## Görselleri değiştirmek / yeniden üretmek

Tüm HTML şablonları, fontlar ve render komutları: [`_kaynak/`](./_kaynak/) —
oradaki `OKUBENI.md`'ye bak. Sayıların kaynağı da orada
(`metinler-istihbarat.md` sonu) — bir sayıyı değiştirmeden önce oku.
