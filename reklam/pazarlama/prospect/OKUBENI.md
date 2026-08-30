# Kurumsal (B2B) kampanya — çalıştırma rehberi

6.000 e-postalık Jetmail hakkıyla **büyük kurumlara** (finans · e-ticaret/perakende/teknoloji ·
turizm/havayolu/telekom/otomotiv) "sektör araştırması daveti" gönderimi + paralel LinkedIn botu.
Plan: `~/.claude/plans/bu-istikbarak-al-malar-ndan-akrt-lan-precious-pebble.md` (Faz 1-8).
Şablonlar: `reklam/pazarlama/kurumsal-mail-sablonlari.md`. KOBİ hunisi (`mail-sablonlari.md`)
ile karıştırma — oradaki "bankaları çıkar" kuralı o huniye özeldir.

Dizin:

| Yol | Ne |
| --- | --- |
| `reklam/pazarlama/prospect/seed-firmalar.csv` | Elle tohum (`firma,sektor,altsektor,web,not`) — repoda, commit'lenir |
| `reklam/pazarlama/prospect/data/` | Bütün üretilen CSV/JSON/HTML — **`.gitignore`'da**, isimli veri repoya girmez |
| `reklam/pazarlama/prospect/data/karne/` | Kurum karneleri (`<host>-<yyyymmdd>.json/.html/.pdf`) |
| `apps/api/scripts/prospect/01…05-*.ts` | Zincir script'leri (`npx tsx`, `apps/api` içinden) |
| `apps/api/src/cli/prospect-karne.ts (derlenmiş: dist/cli/prospect-karne.js)` | Talep üzerine karne |
| `apps/api/src/prospect/prospect-utils.ts` | Saf yardımcılar (translit, alan adı, CSV, UA'lı fetch, desen) + spec |
| `apps/api/data/linkedin/` | Bot ekran görüntüleri (`.gitignore`'da) |

Değişmez kurallar (planla aynı):

- **Tek kaynaklı sayı/iddia ürün metnine girmez**; kesin hüküm için ≥ 2 farklı kaynak.
- Kobipratik adı yazılı onaysız geçmez. SSO / SOC 2 / ekip koltuğu **yok**, vaat edilmez.
- Genel kutular (`info@`, `iletisim@`) kurumsal hedefte **kullanılmaz**; kişisel adres (gmail vb.) asla.
- Her ağ isteği masaüstü UA + `tr` Accept-Language ile, istekler arası 400-1200 ms rastgele bekleme;
  hata veren kaynak loglanır ve atlanır, script durmaz.
- Log'a isim basılmaz; yalnız sayılar.

---

## 1. Sıra ve komutlar

Hepsi `apps/api` içinden:

```bash
cd /Users/emirburgazli/GitHub/luviai/apps/api      # yerel
# prod VPS: ssh root@87.76.142.108 ; cd /var/www/luviai/apps/api
```

Ortak bayraklar: `--limit N` (kaynak/kişi başına en fazla N — test), `--dry-run` (dosya yazmaz),
`--only …` (seçili kaynak / alan adı). Bilinmeyen bayrak 01'de uyarı basar, diğerlerinde sessizce
yok sayılır — yazımı kontrol edin.

Hızlı duman testi (ağ var, para yok, dosya yazılmaz):

```bash
npx tsx scripts/prospect/01-firmalar.ts --limit 5 --dry-run
npx tsx scripts/prospect/02-yoneticiler.ts --limit 5 --dry-run
npx tsx scripts/prospect/03-desen.ts --limit 3 --dry-run
npx tsx scripts/prospect/04-dogrula.ts --limit 20 --dry-run
npx tsx scripts/prospect/05-linkedin-import.ts            # --apply yoksa yalnız sayım
```

### 1.1 `01-firmalar.ts` → `data/firmalar.csv`

```bash
npx tsx scripts/prospect/01-firmalar.ts                       # tüm statik kaynaklar (≈ 1-2 dk)
npx tsx scripts/prospect/01-firmalar.ts --only tbb,seddk      # seçili kaynaklar; seed HER ZAMAN okunur,
                                                              # mevcut firmalar.csv önce yüklenir, üstüne birleştirilir
npx tsx scripts/prospect/01-firmalar.ts --only tubisad --no-merge   # mevcut dosyayı yükleme, sıfırdan
npx tsx scripts/prospect/01-firmalar.ts --kap-detail          # KAP genel sayfaları: web + "Şirketin Sektörü"
                                                              # (≈ 1.500 istek, 25-30 dk) — IGS'nin sektörü için şart
npx tsx scripts/prospect/01-firmalar.ts --via openclaw --only etid,btk   # JS-only kaynaklar, SUNUCUDA
```

| Bayrak | Anlamı |
| --- | --- |
| `--limit N` | kaynak başına en fazla N kayıt |
| `--dry-run` | dosya yazma |
| `--only a,b` | geçerli adlar: `seed tbb seddk todeb fkb kap-yk kap-pys kap-bdk kap-igs bmd tubisad tesid etid fortune rvd wiki-havayolu wiki-mvno btk turob osd odmd oyder` |
| `--no-merge` | önceki `firmalar.csv`'yi yükleme (varsayılan: `--only` koşumu dosyayı KÜÇÜLTMEZ) |
| `--kap-detail` | KAP şirket genel sayfalarını da çek (web + sektör satırı) |
| `--via openclaw` | `etid`, `btk` için OpenClaw tarayıcı (`OPENCLAW_BIN`, isteğe bağlı `OPENCLAW_GATEWAY_URL`/`OPENCLAW_TOKEN`) |

Çıkış kodu: `0` tamam · `1` kullanım/ölümcül hata · `2` en az bir kaynak hata verdi ya da 0 sonuç
döndü (dosya yine yazılır ama **eksiktir**; özetteki "EKSİK KAYNAK" satırındaki `--only …` komutuyla
tamamlayın).

Sütunlar: `firma,sektor,altsektor,web,sehir,calisan,kaynaklar,kaynakUrl,sektorKaynak,not`.
`sektor` üç hedef gruptan biri ya da `diger`; `sektorKaynak` etiketin nereden geldiğini söyler
(`seed` > `kap-detay` > `kaynak`/`etiket` > `unvan` tahmini). Aynı alan adı = tek satır; web'siz
kayıtlar adla (hukuki ekler atılarak) birleşir.

Bilinen sınırlar: SHGM havayolu PDF'i çekilmez (PDF paketi yok; Wikipedia + seed kapsıyor);
`calisan` her zaman boş; KAP IGS (753 şirket) `--kap-detail` olmadan çoğunlukla `diger`; TÜBİSAD
üyelerinin çoğunda ad yerine alan adı görünür (logo-only); zincir oteller tek satıra iner.
Son tam koşum (28-29.08.2026): 2.450 firma, web'li 1.073 — finans 644 · e-tic/perakende/teknoloji
713 · turizm/havayolu/telekom/otomotiv 292 · diger 801 (çoğu Fortune 500'ün hedef dışı sektörleri).

### 1.2 `02-yoneticiler.ts` → `data/kisiler.csv` + `manuel-liste.csv` + `atamalar-eslesmeyen.csv`

```bash
npx tsx scripts/prospect/02-yoneticiler.ts                    # tüm kaynaklar
npx tsx scripts/prospect/02-yoneticiler.ts --only kap,mt      # kap | mt (marketing-turkiye) | fortune | todeb
npx tsx scripts/prospect/02-yoneticiler.ts --pages 37         # Marketing Türkiye "atamalar" arşiv derinliği (varsayılan 10)
npx tsx scripts/prospect/02-yoneticiler.ts --input ../../reklam/pazarlama/prospect/seed-firmalar.csv
```

| Bayrak | Anlamı |
| --- | --- |
| `--limit N` | kaynak başına en fazla N isim |
| `--dry-run` | dosya yazma |
| `--only …` | `kap`, `mt`/`marketing-turkiye`, `fortune`, `todeb` |
| `--pages N` | Marketing Türkiye arşivinde kaç sayfa (37'ye kadar; 2024+ atamalar "orta", eskiler "düşük" güven) |
| `--input yol` | firma listesi (varsayılan `data/firmalar.csv`) |

Unvan filtresi: pazarlama / dijital / marka / büyüme / iletişim / müşteri deneyimi / e-ticaret /
CMO-CDO-CGO alınır; BT, uyum, hukuk, finans, İK, CTO/CIO **elenir**. `kademe` 1 = karar verici,
2 = etkileyici. `guven`: KAP yüksek · Marketing Türkiye 2024+ orta · Fortune CMO (~2022) düşük.
İsmi bulunamayan firmalar `manuel-liste.csv`'ye hazır LinkedIn kişi-arama URL'siyle düşer
(LinkedIn botunun araştırma adımı ya da elle — §5).

### 1.3 `03-desen.ts` → `data/firma-desen.csv` + `adaylar.csv` + `web-tahmin.csv`

```bash
npx tsx scripts/prospect/03-desen.ts                          # kişisi olan tüm alan adları
npx tsx scripts/prospect/03-desen.ts --limit 20               # ilk 20 alan adı (kısmi: mevcut dosyayla birleşir)
npx tsx scripts/prospect/03-desen.ts --only-domain garantibbva.com.tr
npx tsx scripts/prospect/03-desen.ts --overwrite              # kısmi koşumda birleştirme yerine sıfırdan yaz
```

| Bayrak | Anlamı |
| --- | --- |
| `--limit N` | en fazla N alan adı |
| `--dry-run` | dosya yazma |
| `--only-domain x.com.tr` | tek alan adı |
| `--input` / `--kisiler` | `firmalar.csv` / `kisiler.csv` yolu |
| `--overwrite` | kısmi koşumda mevcut dosyaları ezmek |

Ne yapar: **yalnız firmanın kendi sitesindeki** (ana sayfa + `/iletisim`, `/basin`, `/yatirimci-iliskileri`
vb., en fazla 6 sayfa) `@alanadi` adreslerinden desen çıkarır (`ad.soyad`, `asoyad`, `ad_soyad`, …).
Arama motoru / üçüncü taraf sitelerden adres toplama **yoktur** (KVKK 2022/861 — §2). Bulunan adresler
loglanmaz, dosyaya yazılmaz; yalnız desen kalır. Tek isimsiz örnek desen sayılmaz (iki-kaynak
kuralı, `inferPattern`). Desen yoksa TR varsayılan sırası `ad.soyad → asoyad → ad_soyad` (güven 0).
Web'i boş firma için `<çekirdek>.com.tr / .com` tahmini yalnız MX varsa ve sayfa başlığı adı
içeriyorsa kabul edilir (`web-tahmin.csv` önbellek). Yalnız `kisiler.csv`'de kişisi olan firmalar işlenir.

### 1.4 `04-dogrula.ts` → `data/jetmail-import.csv` + `dogrulama.csv`

```bash
npx tsx scripts/prospect/04-dogrula.ts                        # sözdizimi + MX/A; yüksek güvenliler
npx tsx scripts/prospect/04-dogrula.ts --dusuk-dahil          # desen güveni < 0,5 olanlar da (2. dalga)
npx tsx scripts/prospect/04-dogrula.ts --sektor-serbest       # sektörü boş / kapsam dışı satırları da al
npx tsx scripts/prospect/04-dogrula.ts --only-domain x.com.tr --overwrite
```

| Bayrak | Anlamı |
| --- | --- |
| `--limit N` | en fazla N kişi |
| `--dry-run` | dosya yazma |
| `--only-domain` / `--input` / `--overwrite` | 03 ile aynı |
| `--dusuk-dahil` | `guven=dusuk` satırları da Jetmail dosyasına yaz (varsayılan: atla) |
| `--sektor-serbest` | sektörü boş/kapsam dışı satırları atlama |

Karar: kişi başına adaylar `siralama` sırasıyla denenir; sözdizimi geçerli + alan adının MX'i
(yoksa A kaydı) olan ilk aday seçilir. `guven=yuksek` = desen güveni ≥ 0,5 **ve** MX var; gerisi
`dusuk`. `segment = <sektor>-k<kademe>` (ör. `finans-k1`), `konu_varyanti` A/B dönüşümlü.
`dogrulama.csv` her adayın durumunu tutar (`mx_ok | a_only | no_mx | syntax | tekrar`).

**SMTP sondası bilerek yok — port 25 notu.** Plan başta `RCPT TO` sondası (valid / catch_all /
invalid) öngörüyordu; uygulama bunu çıkardı: alıcı sunucular adres denemeyi kötüye kullanım sayar,
gönderici itibarını yakar; kurumsal / M365 hibrit geçitlerin çoğu catch-all döner, bilgi vermez.
Bu yüzden 04 yalnız DNS kullanır ve **Mac'te de koşar**, VPS şart değil. Son ağ Jetmail'in bounce
yönetimi + yavaş ısındırma (§2.6) + varsa Jetmail'in kendi liste doğrulaması. Günün birinde SMTP
sondası eklenecekse: Türkiye ev/ofis hatlarında **port 25 kapalı** (BTK, 2009) → yalnız prod VPS'ten,
önce `nc -zv gmail-smtp-in.l.google.com 25` ile portun açık olduğu doğrulanır; karar tablosu
`prospect-utils.ts` `decideStatus` içinde hazır (catch-all önce rastgele adresle tespit edilir).

### 1.5 Jetmail'e aktarma

1. **Önce İYS** (§2.1): `jetmail-import.csv`'deki adresler İYS'ye yüklenir, ret listesi kontrol edilir;
   ret olanlar dosyadan silinir. Jetmail'in İYS entegrasyonu varsa panelden aynı işi yapın —
   olup olmadığını panelden doğrulayın.
2. Jetmail → Listeler → İçe aktar: `jetmail-import.csv` (UTF-8, virgül).
   Sütunlar: `email, ad, soyad, firma, unvan, sektor, segment, guven, konu_varyanti`.
   Merge alanları şablonlarda `{{ad}} {{soyad}} {{firma}} {{unvan}} {{sektor_sorusu}} {{unsubscribe}}`;
   Jetmail'in söz dizimi farklıysa (`%ad%` gibi) panelden eşleyin. `{{sektor_sorusu}}` listeye
   girmez — şablon sektör varyantına gömülüdür (`kurumsal-mail-sablonlari.md` §2-4).
3. Segmentler: `segment` sütununa göre (`finans-k1`, `finans-k2`, `eticaret-perakende-teknoloji-k1`, …);
   dalga 1 = `finans-k1`, `guven=yuksek`. A/B: `konu_varyanti` sütunu.
4. Jetmail'in liste doğrulaması varsa ısındırmadan **önce** koşun; `invalid` çıkanları silin.
5. Test gönderimi (§2.5) geçmeden dalga başlamaz.

### 1.6 `05-linkedin-import.ts` → DB (`LinkedinProspect`)

```bash
npx tsx scripts/prospect/05-linkedin-import.ts                             # yalnız SAYIM
npx tsx scripts/prospect/05-linkedin-import.ts --sektor finans --kademe 1 --limit 300 --apply
npx tsx scripts/prospect/05-linkedin-import.ts --input ../../reklam/pazarlama/prospect/data/linkedin-secki.csv --apply
```

| Bayrak | Anlamı |
| --- | --- |
| `--apply` | DB'ye yaz (yoksa yalnız sayım) |
| `--input yol` | CSV (varsayılan `data/kisiler.csv`); sütun: `ad,soyad,firma,unvan,sektor,kademe,profileUrl` (`profileUrl` yerine `linkedin`/`linkedinUrl`/`url` de olur) |
| `--sektor s` / `--kademe 1|2` / `--limit N` | filtre ve tavan |

Yalnız **`profileUrl` olan** satırlar alınır (02 bu sütunu üretmez — araştırma adımı ya da elle
doldurulur). URL `https://www.linkedin.com/in/<slug>/` biçimine normalize edilir ve tekil anahtardır:
aynı kişi ikinci kez eklenmez, alanları güncellenir, `status` **değişmez**. `DATABASE_URL` gerekir →
prod VPS'te (`apps/api/.env`) koşun. Bot yalnız `QUEUED` kayıtlara dokunur (§5).

---

## 2. Faz 6 — gönderim ön koşulları (sırayla; biri eksikse dalga başlamaz)

Sıra: **İYS kaydı → adres yükleme + ret kontrolü → DNS → Jetmail alan doğrulama → test gönderimi →
dalga 1 (`finans-k1`)**.

### 2.1 İYS (İleti Yönetim Sistemi)

- **6563 sayılı Kanun md. 6/2:** esnaf ve tacirlere önceden onay alınmadan ticari ileti gönderilebilir;
  ret gelirse **3 iş günü** içinde durulur (md. 8/3).
- **Ticari Elektronik İletiler Yönetmeliği md. 5/2:** ileti gönderen **herkes** İYS'ye kaydolur —
  yalnız tacirlere yazsan bile. → Luvi Host tüzel kişi olarak İYS kaydı (MERSİS / e-Devlet).
- **Md. 6/6:** tacir/esnaf adresleri **gönderimden önce İYS'ye yüklenir ve ret listesi kontrol edilir**.
- **Md. 9/6, 10/1:** ret 3 iş günü içinde İYS'ye bildirilir ve gönderim durdurulur. Jetmail'in
  ret linki (`{{unsubscribe}}`) + İYS bildirimi ikisi birden.
- Kontrol listesi: [ ] İYS hesabı açık · [ ] `jetmail-import.csv` adresleri yüklendi · [ ] ret listesi
  çekildi, ret olanlar listeden silindi · [ ] ret/şikâyet işleme sorumlusu belli (kim, hangi gün).

### 2.2 KVKK notu

İsimli iş adresi kişisel veridir. Kurul **2022/861**: arama motorundan bulunan iş e-postasına
pazarlama; 6563 md. 6 savunması reddedildi (alıcı tacir değil avukattı), "alenileştirme" ve meşru
menfaat kabul edilmedi, **150.000 TL** (kvkk.gov.tr/Icerik/7580/2022-861); 2021/1243 ve 2022/1072
benzer. Tacir şirketin çalışanına soğuk e-posta için meşru menfaati açıkça kabul eden karar
bulunamadı → **yerleşmemiş alan, ceza riski var; karar kurucunun.** Azaltıcılar (hepsi uygulanır):

- yalnız kurumsal alan adı, unvan bazlı iş amacı (pazarlama karar vericisi), minimum veri;
- 03-desen yalnız firmanın kendi yayımladığı adreslerden desen çıkarır, arama motoru yok;
- her mailde açık kimlik (Luvi Host / RanksUp, adres, MERSİS) + aydınlatma metni `ranksup.ai/kvkk`
  + tek tık ret + "3 iş günü içinde durdururuz";
- ilk itirazda silme (liste + İYS + `cevaplar.csv`'de `ret`), kişisel adres asla;
- LinkedIn DM'si de "elektronik ileti" sayılabilir → aynı rejim; ret → `SKIPPED`, bir daha yazılmaz.

### 2.3 DNS — `go.ranksup.ai` (Namecheap → Advanced DNS)

Ayrı gönderim alt alanı: soğuk gönderim itibarı işlemsel maili (Resend, `mail.ranksup.ai` —
`docs/EMAIL-ALAN-ADI.md`) yakmasın. **Kök alanın SPF kaydına dokunulmaz** (Namecheap mail
yönlendirmesi `include:spf.efwd.registrar-servers.com` orada; bir alanda tek SPF olur).
Namecheap'te "Host" alanı `ranksup.ai`'ye göredir:

| Tür | Host | Değer | Not |
| --- | --- | --- | --- |
| TXT | `go` | `v=spf1 include:<jetmail spf> ~all` | `<jetmail spf>` yer tutucu — Jetmail panelindeki "SPF include" değeri; tek SPF kaydı |
| TXT | `<selector>._domainkey.go` | Jetmail'in verdiği DKIM (`v=DKIM1; k=rsa; p=…`) | selector adı ve anahtar **Jetmail panelden**; CNAME olarak veriyorsa CNAME |
| TXT | `_dmarc.go` | `v=DMARC1; p=quarantine; rua=mailto:dmarc@ranksup.ai` | `dmarc@ranksup.ai` çalışır olmalı (Namecheap yönlendirme); ilk 1-2 hafta raporları izleyin |
| CNAME | Jetmail'in istediği izleme host'u (ör. `link.go`) | Jetmail panel | tıklama/açılma izleme — isteğe bağlı, panel verirse |
| MX | `go` | Jetmail bounce/cevap işleme için verirse | vermezse ekleme |

Doğrulama (yayılma 15 dk - 1 saat):

```bash
dig +short TXT go.ranksup.ai
dig +short TXT <selector>._domainkey.go.ranksup.ai
dig +short TXT _dmarc.go.ranksup.ai
```

Üçü de beklenen değeri dönmeden Jetmail'de alan doğrulamaya geçmeyin.

### 2.4 Jetmail alan doğrulama

Jetmail → Gönderim alanları → `go.ranksup.ai` ekle → panelin verdiği SPF/DKIM değerlerini §2.3
tablosuna işle → "Doğrulandı". Gönderen: `RanksUp <arastirma@go.ranksup.ai>` (görünen ad açık
yazılır). Reply-To gerçek bir kutu olsun (cevaplar `cevaplar.csv`'ye işlenecek — §6).

### 2.5 Test gönderimi

- mail-tester.com ≥ 9/10; Gmail + Outlook + kurumsal M365 adresine deneme; SPF/DKIM/DMARC **PASS**.
- Ret linki çalışıyor ve listeden düşürüyor; aydınlatma linki açılıyor; merge alanları dolu
  (`{{firma}}` boş görünmüyor).
- Şablon sözcük kontrolü: SSO / SOC 2 / ekip koltuğu / tek kaynaklı yüzdeler / "40+ kurum ölçtük" /
  Kobipratik **yok**.

### 2.6 Isındırma takvimi ve durdurma eşikleri

Gönderim günleri Salı-Perşembe 09:30-11:30 (TR); günlük tavan 100 → 200 → 400:

| Hafta | Gün başına | Toplam (kümülatif) | Segment |
| --- | --- | --- | --- |
| 1 | 100 · 200 · 400 | 700 | `finans-k1` (yüksek güven) |
| 2 | 400 × 3 | 1.900 | `finans-k1` kalan + `finans-k2` |
| 3 | 400 × 3 | 3.100 | `eticaret-perakende-teknoloji-k1/k2` |
| 4 | 400 × 3 | 4.300 | `turizm-havayolu-telekom-otomotiv-k1/k2` |
| 5-6 | 400 × 3 | 6.000 | 2. dalga (`--dusuk-dahil`) + takipler |

Not: planın "≈ 4 hafta"sı 5 gönderim günü varsayar; Salı-Perşembe'ye sadık kalınırsa ~5,5 hafta.
Takip 1 (D+4, yalnız açanlara) ve Takip 2 (D+9, son) aynı günlük tavana **dahildir**.

**Durdurma eşikleri** (her gönderim gününün sonunda Jetmail raporundan):

| Sinyal | Eşik | Eylem |
| --- | --- | --- |
| Bounce | > %3 | dalga durur; `04-dogrula.ts` ile liste yeniden üretilir, bounce adresleri silinir |
| Şikâyet (spam) | > %0,2 | dalga durur; şablon + segment gözden geçirilir; DMARC raporu okunur |
| Ret | herhangi | 3 iş günü içinde İYS'ye bildir + listeden sil (otomatik `{{unsubscribe}}` + elle kontrol) |
| DMARC `p=quarantine` kaynaklı düşüş | açılma < %15 ilk gün | DKIM hizasını kontrol et (`dig`), gönderimi 100'e çek |

Eşik aşımından sonra yeniden başlarken tavan tekrar 100'den başlar.

---

## 3. Kaynak tablosu (Faz 1 kısa hali)

| Grup | `--only` adı | Kaynak | Biçim | Son sayım | Durum |
| --- | --- | --- | --- | --- | --- |
| Tümü | `seed` | `seed-firmalar.csv` | CSV | ~60 | her koşumda okunur |
| Finans | `tbb` | TBB internet adresleri | SSR (UA şart) | 58 | çalışıyor (plan ~70 demişti, sayfa 58 satır) |
| Finans | `seddk` | SEDDK sigorta/reasürans/BES | SSR | 71 | çalışıyor |
| Finans | `todeb` | TÖDEB EPK + ÖK (3 sayfa) | SSR | 77 | çalışıyor; temsilci adları 02'de |
| Finans | `fkb` | FKB üyeler | SSR | 133 | çalışıyor |
| Finans | `kap-yk` `kap-pys` `kap-bdk` | KAP YK / PYS / BDK | JSON (+SSR `--kap-detail`) | 129 / 93 / 99 | çalışıyor; web için `--kap-detail` |
| Tümü | `kap-igs` | KAP IGS (BIST şirketleri) | JSON (+SSR) | 753 | sektör yalnız `--kap-detail` ile (yoksa çoğu `diger`) |
| E-tic/per/tek | `bmd` | BMD markalar | SSR | 212 | çalışıyor |
| E-tic/per/tek | `tubisad` | TÜBİSAD üye listesi | SSR (UA şart) | 255 | çalışıyor; çoğu ad = alan adı (logo-only) |
| E-tic/per/tek | `tesid` | TESİD üyeler | SSR | 93 | çalışıyor |
| E-tic/per/tek | `rvd` | RVD üyeler | SSR (logo alt) | 102 | web yok; sektör `diger` (her sektörden reklamveren); 03 alan adını tahmin eder |
| Tümü | `fortune` | Fortune 500 TR (admin-ajax) | JSON/HTML | 500 | çalışıyor; kendi sektör etiketi `altsektor`'de; web çoğu boş |
| Tur/hav/tel/oto | `wiki-havayolu` | Wikipedia havayolu listesi | JSON | 13 | web yok |
| Tur/hav/tel/oto | `wiki-mvno` | Wikipedia MVNO listesi | JSON | son koşumda 0 satır | web yok; operatörler seed'de; `--only wiki-mvno` ile tek başına deneyip özeti okuyun |
| Tur/hav/tel/oto | `turob` | TÜROB 5 yıldızlı oteller (`?start=12,24,…`) | SSR (UA şart) | 119 | çalışıyor; zincirler tek satır |
| Tur/hav/tel/oto | `osd` | OSD üyeleri | SSR | 13 | çalışıyor |
| Tur/hav/tel/oto | `odmd` | ODMD distribütörler (sortial.aspx) | SSR | 66 marka → 47 distribütör | çalışıyor |
| Tur/hav/tel/oto | `oyder` | OYDER üyeler (800 bayi) | SSR | son koşumda 0 satır | "Yetkili" sütunu OKUNMAZ (KVKK); `--only oyder` ile tek başına deneyip özeti okuyun |
| — | — | SHGM havayolu PDF | PDF | 14 | **atlandı** (PDF metin paketi yok); Wikipedia + seed kapsıyor |

**JS-only kaynaklar** (statik HTML boş; yalnız `--via openclaw`, OpenClaw kurulu sunucuda):

| `--only` adı | Kaynak | Durum |
| --- | --- | --- |
| `etid` | ETİD üyeler (WordPress + JS) | script hazır, **canlı doğrulanmadı**; 0 sonuç dönerse çıkış kodu 2 |
| `btk` | BTK işletmeciler (Next.js SPA) | script hazır, **canlı doğrulanmadı** |
| — | TSB üye şirketler | plandaydı, **yazılmadı** (SEDDK aynı kümeyi kapsıyor) |
| — | TBB "Yönetici bilgileri" (GMY + alan) | plandaydı, **yazılmadı**; 02'de KAP + basın kapsıyor |
| — | Capital 500, KTB tesis formu, TOBB 100 | bilerek atlandı |

---

## 4. Karne üretimi (Faz 5) — yalnız "evet" diyen kuruma, 2 iş günü içinde

```bash
cd apps/api
node dist/cli/prospect-karne.js --help
# 1) kuru koşum: sorular + maliyet tahmini + çıktı yolları; LLM çağrısı ve dosya YOK
node dist/cli/prospect-karne.js --brand "Acme Bank" --host acmebank.com.tr --sektor finans --altsektor banka --dry-run
# 2) gerçek koşum (anahtarlar prod VPS'te → orada koş)
node dist/cli/prospect-karne.js --brand "Acme Bank" --host acmebank.com.tr --sektor finans --altsektor banka \
    --rakipler garantibbva.com.tr,isbank.com.tr --pdf [--yes] [--limit 2] [--only anthropic,gemini] [--force]
```

| Bayrak | Anlamı |
| --- | --- |
| `--brand` / `--host` / `--sektor` | zorunlu; marka ≥ 4 karakter; sektör üç anahtardan biri |
| `--altsektor` | `banka/odeme/sigorta/leasing/yatirim`, `eticaret/perakende/teknoloji`, `havayolu/otel/telekom/otomotiv`; eşleşmezse sert uyarı + `--yes` şartı |
| `--rakipler a.com,b.com` | rakip **alan adları**; cevapta aranır, rakip payına girer, raporda ★ |
| `--limit N` / `--only …` | ucuz test: N soru / seçili sağlayıcılar (`anthropic,gemini,openai,perplexity,xai,deepseek,meta`) |
| `--dry-run` / `--yes` / `--force` / `--pdf` | kuru · onay sorusunu atla · aynı günün çıktısını ez · Chrome headless PDF (`CHROME_PATH` ile yol) |

Çıktı: `data/karne/<host>-<yyyymmdd>.json | .html | .pdf`. Tarihli ad bilerek: iki-kaynak kuralı
"kesin hüküm için ≥ 2 farklı gün" ister, 2. günün koşumu 1. günün kanıtını ezmez; aynı gün tekrar
`--force` ister. Markalı soru (kurum adı geçen) sorulmaz, skora girmez (`containsBrand`).

**Maliyet:** 7 asistan × 10 soru = 70 çağrı; tavan ≈ $0,32 (Anthropic $0,03/probe baskın; diğerleri
< $0,01). Plan: $0,12-0,32/kurum; 60-120 karne ≈ $10-30. Gerçek tutar koşum sonunda servisin maliyet
defterinden (`addCost`) basılır. Tavan kontrolü yok → script **tek kurum** alır, toplu koşulmaz.
Yerel `.env`'de sağlayıcı anahtarı yok; gerçek karne prod VPS'te koşulur (DB bağlantısı da şart —
defter yazılamıyorsa para harcamadan durur).

**Gizlilik:** kurum bazlı sonuç **kamuya açılmaz**. Bu yüzden `--persist` kaldırıldı (PublicCitationCheck
kaydı herkese açık `/citation-check/history` ucundan dönüyordu); karne JSON+HTML dosyasıdır,
yalnız o kuruma iletilir, `data/karne` `.gitignore`'dadır. Kamuya yalnız toplu istatistik çıkar
(sektör bazlı, kurum adı yok) — o da tek kaynaklı sayı olmadan.

---

## 5. LinkedIn botu (Faz 8) — kişisel kurucu hesabı, tam otomatik, sıkı frenli

Ayrıntı: `docs/OPENCLAW-KURULUM.md` §11. Servis `apps/api/src/intel/linkedin-outreach.service.ts`,
kurallar `linkedin-outreach-rules.ts`, seçiciler `linkedin-selectors.ts`, worker işi
`LINKEDIN_OUTREACH_TICK`. LLM yok; yalnız `openclaw browser snapshot/click/type/press/screenshot`.

**Risk (kabul edildi):** otomasyon LinkedIn kullanım koşullarına aykırıdır; hesap kısıtlanabilir
ya da kapatılabilir. Parola hiçbir yerde tutulmaz. DM "ticari elektronik ileti" sayılabilir →
İYS/KVKK rejimi e-postayla aynı (§2.1-2.2).

### 5.1 Çerez aktarımı (Mac'te Chrome'da LinkedIn oturumu açıkken, repo kökünden)

```bash
OPENCLAW_HOST=luvi108 node scripts/oturum-aktar.mjs --site linkedin
# OPENCLAW_HOST verilmezse root@87.76.142.108; OPENCLAW_PROFILE (openclaw), CHROME_PROFILE (Default)
```

- Keychain izin penceresi → **Allow**. Zorunlu çerezler `li_at` + `JSESSIONID` (`"ajax:…"` çift tırnaklı
  gelir, normaldir); `bcookie`/`lidc` varsa yazılır. Değerler ekrana/diske yazılmaz.
- Doğrulama: script `linkedin.com/feed/` açar; "BAŞARILI … LinkedIn akışı geliyor" görmeden bota geçmeyin.
  Giriş duvarı regex'i (`Sign in | Oturum aç | Join now | …`) yanlış pozitif verirse daraltılır.
- Oturum ~aylık düşer; bot giriş duvarı görünce kendini duraklatır → tekrar aktar, panelden **Devam**.
- `scripts/x-oturum-aktar.mjs` artık `--site x` sarmalayıcısıdır.

### 5.2 Bayrak ve zamanlama

```
OPENCLAW_ENABLED=1
OPENCLAW_LINKEDIN_OUTREACH_ENABLED=1   # varsayılan KAPALI; ikisi birden gerekli
OPENCLAW_BIN=/usr/local/bin/openclaw-ranksup
```

Worker tick'i **30 dk'da bir** kuyruğa koyar (bayrak kapalıyken Redis'teki tekrar işi de silinir);
servis yalnız **hafta içi 09:00-18:00 Europe/Istanbul** işlem yapar, dışında "yapılacak yok" döner.
Bayrak kapalıyken tarayıcı hiç açılmaz.

### 5.3 `/admin/linkedin` (admin + PIN; sidebar "Araştırma > LinkedIn Outreach")

- Sayaçlar: bugün istek/mesaj, hafta istek (kalan), kuyruk, 7 günlük kabul oranı, durum (Çalışıyor /
  Duraklatıldı + neden). 60 sn'de bir tazelenir.
- Düğmeler: **Duraklat** (neden sorar) / **Devam**, **Kuru tick**, **Gerçek tick** (onay ister).
- CSV içe aktar (textarea): `ad,soyad,firma,unvan,sektor,kademe,profileUrl`; `profileUrl` tekil.
  Toplu iş için `05-linkedin-import.ts` (§1.6).
- Son 50 kayıt: durum rozeti `QUEUED → REQUESTED → ACCEPTED → MESSAGED → REPLIED` (+ `SKIPPED`, `FAILED`,
  `PAUSED`), tarihler, son hata, ekran görüntüsü dosya adı (yalnız ad; görüntü servis edilmez), **Atla**.
- Uçlar: `GET /intel/linkedin/overview`, `POST /intel/linkedin/import | pause | resume | tick`,
  `POST /intel/linkedin/prospects/:id/skip`.
### 5.3.1 Arama linkleriyle tarama (önerilen yol, 30.08.2026)

Panelde **"Arama linkleriyle tara"** kartı: LinkedIn'de aramanı kendin kur (ünvan, konum, şirket, bağlantı
derecesi filtreleri), adres çubuğundaki linki yapıştır — her satıra bir link, tek seferde ≤ 12 link.
Kampanya seç (**Müşteri adayı / Yatırımcı / İş birliği**) → "Taramayı başlat". Bot sayfayı gezer, hedef ünvanlı
kişileri kuyruğa yazar, **mesaj göndermez**. Firma kartın "Mevcut: … şirketinde …" satırından okunur; firması
okunamayan kişi kaydedilmez. CLI karşılığı:
`node dist/cli/linkedin-tick.js --urls "https://www.linkedin.com/search/results/people/?keywords=CMO" --kampanya YATIRIMCI --real`
(`--real` yalnız DB'ye yazar; LinkedIn'e istek/mesaj göndermez. `--urls-file <yol>` ile dosyadan da okunur.)

**Tarayıcı Mac'te ve GİZLİ çalışır** — `scripts/linkedin-tarayici.sh gizle` (gateway'i tazeler, Chrome'u başlatır,
pencereyi macOS "uygulamayı gizle" ile görünmez yapar, caffeinate açar). `durum` ile kontrol, `goster` ile geri al.
Neden Mac: LinkedIn veri merkezi IP'sini 429 + yönlendirme döngüsüyle kesiyor (29.08 denendi); headless Chrome ise
tespit riski taşıyor.

- **Firma adıyla otomatik araştırma** (alternatif) panelde düğme yok; sunucuda CLI:
  `cd /var/www/luviai/apps/api && set -a && . /var/www/luviai/.env && set +a && node dist/cli/linkedin-tick.js --research-only --research "Papara,Getir"`
  (`--research-only`: yalnız kuyruk doldurur, istek/mesaj atmaz, çalışma penceresine bakmaz — hafta sonu
  hazırlık için) ya da API `POST /intel/linkedin/tick` gövde `{ "dryRun": true, "research": [...] }`.
  Tick başına ≤ 3 firma, günde ≤ 50 araştırma (firma sayısı), firma başına ≤ 15 aday (kademe 1 önce).
  Nasıl arar (30.08.2026'da tarayıcıda doğrulandı): LinkedIn `title=`/`titleFreeText=` URL parametrelerini
  yutuyor; çalışan tek filtre **`currentCompany=["<sayısal id>"]`**. Kimlik: şirket araması → `/company/<slug>/`
  → "Çalışanları gör" bağlantısından okunur, KvStore'da 90 gün saklanır (`linkedin-outreach:company:<firma>`).
  **Her terim ayrı arama** (birleşik/boolean yok — kullanıcı kararı 30.08): `CEO`, `CTO`, `CMO`, `Founder`,
  `Kurucu`, `Genel Müdür`, `Director`, `Direktör`, `Pazarlama`, `Marketing`, `Growth`, `Marka`, `Brand`;
  sonuçlar profil URL'sine göre tekilleştirilir, firma başına ≤ 15 aday (kademe 1 önce, kesilen sayısı loglanır).
  Kimlik bulunamazsa `"<firma> <terim>"` anahtar kelimesi + kartta "Mevcut:" / başlıkta firma eşleşmesi
  zorunlu (eski çalışanlar elenir).
  Hedef unvan (`isTargetTitle`): C-level/kurucu/genel müdür/direktör/head/VP + pazarlama-marka-dijital-büyüme
  ailesi (müdür/uzman dahil); CFO/İK/hukuk/IT/mühendislik/operasyon/veri/stajyer elenir. Düz "Manager" tek
  başına yetmez. Kart okuma: yeni arayüzde `<li>` yok, profil bağlantısı kartı sarar — "Mevcut: X şirketinde Y"
  satırındaki pozisyon unvanı başlığa tercih edilir.

### 5.3.2 Kampanya şablonları

| Kampanya | Bağlantı notu (≤300 karakter) | Kabul sonrası mesaj |
| --- | --- | --- |
| **Müşteri adayı** (varsayılan) | Sektör araştırması + kuruma özel ücretsiz karne daveti | 7 asistanda markasız sorularla ölçüm, "Evet" yeterli |
| **Yatırımcı** | "RanksUp'ın kurucusuyum… kısa bir tanışma görüşmesi" | Ürün ne yapıyor + pazar tezi + 20 dk demo daveti; **rakam/traction şablonda YOK** (görüşmede, kaynağıyla) |
| **İş birliği** | Ajans / çözüm ortaklığı önerisi | Ölçüm bizde, müşteri ilişkisi sizde; örnek kurum için ücretsiz karne |

Üçü de kimlik açıklar ve **"istemezseniz bir daha yazmayacağım"** cümlesiyle biter (6563 md. 8/3 ret hakkı).
Kampanya kayıt bazındadır; panelden yalnız **Kuyrukta** olan kayıtlarda değiştirilebilir (istek gitmiş kişinin
şablonu değiştirilirse gönderilen metinle çelişir). Şablon metinleri `linkedin-outreach-rules.ts` içinde.

### 5.4 Frenler (kod sabiti; env ile yalnız **aşağı** çekilir — `LINKEDIN_MAX_REQUESTS_PER_DAY=10` gibi)

| Fren | Değer |
| --- | --- |
| Günlük bağlantı isteği / mesaj / araştırma | ≤ 20 / ≤ 15 / ≤ 50 |
| Haftalık istek | ≤ 80 |
| Tick başına işlem | ≤ 3; işlemler arası 2-6 dk rastgele; her istekten önce profilde 8-20 sn "okuma" + kaydırma |
| Aynı firmadan | günde ≤ 2 kişi |
| Kabul kontrolü | tick başına 5 `REQUESTED` |
| Otomatik `PAUSED` | ardışık 3 hata; "limit" / "doğrulama" / captcha / giriş duvarı; **olgunlaşmış** kabul oranı < %15 (72 sa - 14 gün penceresi, ≥ 20 istek) |
| Öldürme anahtarı | `LINKEDIN_MAX_ACTIONS_PER_TICK=0` → tick plan üretmez, tarayıcıya dokunmaz |

`LINKEDIN_ACCEPT_RATE_MIN` yalnız yukarı (daha sıkı) alınır. Duraklama bildirim üretir
(`notifications` SYSTEM + webhook); neden panelde görünür.

### 5.5 Akış ve başlangıç sırası

1. Oturum aktarımı (§5.1) → BAŞARILI.
2. 5 kişilik CSV → **Kuru tick**: profil açılır, derece okunur, "Bağlantı kur → Not ekle" doldurulur,
   **Gönder'e basılmaz**, her adımda ekran görüntüsü (`apps/api/data/linkedin/<id>-<adım>.png`), kayıt değişmez.
   Görüntülerde doğru alanların dolduğunu kontrol edin.
3. 3 kişiyle **Gerçek tick**; kabul geldikçe mesaj adımı (Faz 4 LinkedIn kısaltması, ~80 kelime, CTA "evet",
   "istemezseniz bir daha yazmayacağım") izlenir.
4. Ancak sonra worker bayrağı açılır.
5. Cevap gelince (`REPLIED`) bot o kişiye **bir daha yazmaz**; insan devralır, `cevaplar.csv`'ye işlenir.
   Ret isteyen → panelden **Atla** (`SKIPPED`).

Not/mesaj metni: `kurumsal-mail-sablonlari.md` §7 (bağlantı notu ≤ 300 karakter; hitap
"Merhaba {{ad}} {{soyad}}," — cinsiyet alanı yok, Bey/Hanım eklenmez).

---

## 6. Ölçüm ve takip (Faz 7)

**UTM kalıbı** (her linkte, takipler dahil):

```
https://ranksup.ai/…?utm_source=jetmail&utm_medium=email&utm_campaign=kurumsal-<sektor>-<varyant>
örnek: utm_campaign=kurumsal-finans-A · kurumsal-eticaret-B · kurumsal-turizm-A-t1 (Takip 1)
LinkedIn: utm_source=linkedin&utm_medium=dm&utm_campaign=kurumsal-<sektor>-li
```

`apps/web/src/lib/landing-track.ts` yalnız `utm_source / utm_medium / utm_campaign` yakalar
(`utm_content` **yok**) → varyant ve takip etiketi `campaign`'e gömülür. Olaylar `LandingEvent`
tablosunda; kendi testini koşan kurumlar `PublicCitationCheck` → `/admin/leads` ile listeyle eşlenir.

**`data/cevaplar.csv`** (elle; `.gitignore`'da) — sütunlar:

```
tarih,firma,kisi,kanal,segment,varyant,sonuc,not
2026-09-02,Acme Bank,A. Yılmaz,email,finans-k1,A,evet,karne 04.09 teslim
```

`kanal`: `email | linkedin` · `sonuc`: `evet | hayir | toplanti | ret | karne-teslim | cevap-yok`.
`ret` satırı = aynı gün Jetmail listesinden sil + İYS'ye bildir (3 iş günü) + LinkedIn'de `SKIPPED`.

**Hedefler:** açılma ≥ %30 · cevap %1-2 (6.000 → 60-120) · toplantı 15-25 · karne teslimi ≤ 2 iş günü ·
LinkedIn olgunlaşmış kabul ≥ %15. Haftalık okuma: Jetmail raporu (açılma, tıklama, bounce, şikâyet,
ret) + `LandingEvent` (campaign kırılımı) + `cevaplar.csv` sayımı; varyant kararı (A/B) ≥ 2 haftalık
veriyle, tek dalgadan hüküm verilmez.

---

## 7. Sık takılanlar

| Belirti | Bakılacak yer |
| --- | --- |
| 01 çıkış kodu 2 | özetteki "EKSİK KAYNAK" komutunu koş (`--only …`); TÜBİSAD/TBB/TÜROB 403 → UA (script zaten gönderir), geçici hata → tekrar |
| 03 "kisiler.csv bos/yok" | önce 02 koş; 03 yalnız kişisi olan firmaları işler |
| 04 `jetmail-import` çok küçük | çoğu alan adı desensiz → `guven=dusuk` atlanıyor; 2. dalga için `--dusuk-dahil` |
| Karne "hiçbir sağlayıcı anahtarı yok" | yerelde anahtar yok; prod VPS'te koş |
| Karne "bugünün çıktısı zaten var" | tarihli dosya korunur; bilerek ezmek için `--force` |
| Bot "yapılacak yok" | hafta içi 09-18 TR dışı, kuyruk boş, günlük limit dolu ya da bayrak kapalı |
| Bot sürekli `PAUSED` | durum kartındaki neden: oturum düştüyse §5.1; "limit" ise bir gün bekle; captcha ise Mac'te elle çöz, çerezleri yeniden aktar; kabul oranı düşükse not metnini gözden geçir |
| DMARC raporu gelmiyor | `dmarc@ranksup.ai` yönlendirmesi Namecheap'te var mı; `_dmarc.go` TXT `dig` ile |
