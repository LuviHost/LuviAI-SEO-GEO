# RanksUp — kurumsal (B2B) soğuk e-posta ve LinkedIn şablonları

Hedef: büyük kurumlarda **pazarlama tarafındaki karar verici** (CMO / Pazarlama Direktörü,
Dijital Pazarlama Müdürü, Marka ve İletişim Müdürü, Dijital Kanallar, Büyüme). IT / uyum /
hukuk tarafına ilk mesaj **atılmaz** — orada "yeni tedarikçi" sürecine girer, aylarca bekler.

Kurgu: **sektör araştırması daveti**. Ön ölçüm yapılmadı; bu yüzden "ölçtük" DENMEZ.
"Kurumunuzu araştırma kapsamına almak istiyoruz; 'evet' derseniz 2 iş günü içinde karnenizi
çıkarıp yalnız size iletiyoruz." Karne birebir ve gizli; kamuya yalnız toplu istatistik.
Karne üretimi: `apps/api/scripts/prospect-karne.ts` (bkz. `prospect/OKUBENI.md`).

KOBİ hunisi (`mail-sablonlari.md`) ile **karıştırma**: oradaki "bankaları çıkar" kuralı o
huniye özeldir; bu kampanya bankaları hedefler.

---

## 0. Göndermeden önce — zorunlu ön koşullar

1. **İYS kaydı** (Luvi Host tüzel kişi; MERSİS/e-Devlet). Yönetmelik md. 5/2: yalnız tacirlere
   yazsan bile kayıt zorunlu. Md. 6/6: tacir/esnaf adresleri gönderimden **önce** İYS'ye
   yüklenir, **ret listesi** kontrol edilir. Ret → 3 iş günü içinde İYS'ye bildir ve dur.
2. **KVKK:** isimli iş adresi kişisel veridir. Kurul 2022/861'de arama motorundan bulunan iş
   e-postasına pazarlama için 150.000 TL kesti. Bu yüzden: yalnız kurumsal alan adı, unvan
   bazlı iş amacı, her mailde aydınlatma linki (`ranksup.ai/kvkk`), ilk itirazda sil, kişisel
   adres (gmail vb.) asla. Risk sıfır değil — karar kurucunun.
3. **Gönderim alanı `go.ranksup.ai`** (Resend işlemsel için `mail.ranksup.ai` ayrı kalır).
   SPF + DKIM (Jetmail anahtarı) + DMARC `p=quarantine`. Test: mail-tester ≥ 9/10, Gmail +
   Outlook + kurumsal M365 adresine deneme.
4. **Isındırma:** gün 100 → 200 → 400. 6.000 ≈ 4 hafta. Salı-Perşembe 09:30-11:30.
   Bounce > %3 veya şikâyet > %0,2 → dalga durur, liste yeniden doğrulanır.
5. **Yasak ifadeler:** SSO, SOC 2, ekip koltuğu (yok, vaat edilmez); tek kaynaklı sayılar
   (%34,5 / 33× / %68,9); "40+ kurum ölçtük" tipi yer tutucular; BDDK/düzenleyici ilişkisi iması
   ("bağımsız araştırma" denir); Kobipratik adı **yazılı onaysız** geçmez — geçerse ortak
   kurucu ilişkisi de yazılır.
6. Fiyat sorulursa tek kaynak `apps/api/src/billing/plans.ts` (Kurumsal: iletişime geçin;
   $1.499/ay, 50 site, API + MCP + BYOK, hesap yöneticisi + SLA). `docs/PRICING.md` bayat.

Merge alanları (Jetmail): `{{ad}}` `{{soyad}}` `{{firma}}` `{{unvan}}` `{{sektor_sorusu}}`
`{{unsubscribe}}`. Jetmail'in kendi söz dizimi farklıysa (`%ad%` gibi) panelden eşle.

---

## 1. Konu satırları (A/B — 2 varyant dönüşümlü, etiketle)

- `{{firma}} — AI görünürlük karnesi (sektör araştırması)`
- `ChatGPT "{{sektor_sorusu}}" dendiğinde {{firma}} geçiyor mu?`
- `{{firma}} için 2 iş günlük bir soru`
- `Müşteriniz artık Google'a değil ChatGPT'ye soruyor — {{firma}} nerede?`

---

## 2. Şablon A — Finans (banka, ödeme / e-para, sigorta, leasing-faktoring)

`{{sektor_sorusu}}` örnekleri: "bana bir dijital banka öner" · "KOBİ için en uygun POS hangisi"
· "yurt dışından ödeme almak için hangi kuruluş" · "en uygun kasko hangi şirkette"

```
Sayın {{ad}} {{soyad}},

RanksUp olarak Türkiye finans sektörü için bağımsız bir AI görünürlük araştırması yürütüyoruz.

Müşteriler artık "en iyi dijital banka" diye Google'da aramak yerine ChatGPT, Gemini ve
Perplexity'ye "{{sektor_sorusu}}" diye soruyor; cevapta 10 sonuç değil 3 isim geçiyor.
O üç isimden biri değilseniz o müşteri kurumunuzu hiç değerlendirmedi.

{{firma}}'yı araştırma kapsamına almak istiyoruz. Onayınızla, 7 AI asistanında (ChatGPT,
Claude, Gemini, Perplexity, Grok, DeepSeek, Meta AI) marka adı geçmeyen gerçek müşteri
sorularıyla ölçüp yalnız size iletiyoruz:

1. Görünürlük karnesi — hangi asistan sizi öneriyor, hangisi rakibi
2. Aynı sorularda kimin önerildiği ve kaçıncı sırada geçtiğiniz
3. Hiç görünmediğiniz sorular ve kapatma planı

Kurum bazlı sonuç kamuya açılmaz; yalnız toplu sektör istatistiği paylaşılır.
Veri tarafı: KVKK uyumlu, Türkiye'de barındırma, AES-256-GCM.

Karnenizi çıkarmamı ister misiniz? Kısa bir "evet" yeterli, 2 iş günü içinde iletiyorum.

Saygılarımla,
[Ad Soyad] · Kurucu, RanksUp (Luvi Host)
[adres] · [MERSİS] · ranksup.ai
Aydınlatma metni: ranksup.ai/kvkk · Bu iletiyi almak istemiyorsanız: {{unsubscribe}}
(3 iş günü içinde durduruyoruz.)
```

## 3. Şablon B — E-ticaret / perakende / teknoloji

`{{sektor_sorusu}}` örnekleri: "telefon almak için hangi site güvenilir" · "hızlı market
teslimatı için hangi uygulama" · "en iyi indirim dönemi hangi mağazada" · "çocuk için güvenli
tablet nereden alınır"

```
Sayın {{ad}} {{soyad}},

RanksUp olarak Türkiye e-ticaret ve perakende sektörü için bağımsız bir AI görünürlük
araştırması yürütüyoruz.

Alışveriş kararı artık çoğu zaman bir AI cevabıyla başlıyor: müşteri ChatGPT'ye
"{{sektor_sorusu}}" diye soruyor ve cevapta 2-3 marka geçiyor. Reklamla o cevaba
girilmiyor; içerik ve yapısal sinyallerle giriliyor.

{{firma}}'yı araştırma kapsamına almak istiyoruz. Onayınızla 7 AI asistanında, marka adı
geçmeyen gerçek alışveriş sorularıyla ölçüp yalnız size iletiyoruz: hangi asistanlar sizi
öneriyor, aynı sorularda kim öne çıkıyor, hangi ürün kategorilerinde hiç görünmüyorsunuz
ve bunu kapatmak için 90 günlük plan.

Kurum bazlı sonuç kamuya açılmaz. Veri tarafı: KVKK uyumlu, Türkiye'de barındırma.

Karnenizi çıkarmamı ister misiniz? "Evet" yeterli, 2 iş günü içinde iletiyorum.

Saygılarımla,
[Ad Soyad] · Kurucu, RanksUp (Luvi Host)
[adres] · [MERSİS] · ranksup.ai
Aydınlatma metni: ranksup.ai/kvkk · Bu iletiyi almak istemiyorsanız: {{unsubscribe}}
```

## 4. Şablon C — Turizm / havayolu / telekom / otomotiv

`{{sektor_sorusu}}` örnekleri: "İstanbul-Londra için hangi havayolu" · "yurt dışında internet
için hangi operatör" · "aile için hangi SUV" · "Antalya'da çocuklu aile için hangi otel"

```
Sayın {{ad}} {{soyad}},

RanksUp olarak Türkiye'de seyahat, telekom ve otomotiv markaları için bağımsız bir AI
görünürlük araştırması yürütüyoruz.

Müşteri artık karşılaştırma sitesi gezmek yerine ChatGPT'ye "{{sektor_sorusu}}" diye
soruyor. Cevapta 3 marka geçiyor; gerisi değerlendirmeye bile girmiyor.

{{firma}}'yı araştırma kapsamına almak istiyoruz. Onayınızla 7 AI asistanında, marka adı
geçmeyen gerçek müşteri sorularıyla ölçüp yalnız size iletiyoruz: hangi asistan sizi
öneriyor, aynı soruda kim önde, hangi senaryolarda hiç yoksunuz ve kapatma planı.

Kurum bazlı sonuç kamuya açılmaz. Veri tarafı: KVKK uyumlu, Türkiye'de barındırma.

Karnenizi çıkarmamı ister misiniz? "Evet" yeterli, 2 iş günü içinde iletiyorum.

Saygılarımla,
[Ad Soyad] · Kurucu, RanksUp (Luvi Host)
[adres] · [MERSİS] · ranksup.ai
Aydınlatma metni: ranksup.ai/kvkk · Bu iletiyi almak istemiyorsanız: {{unsubscribe}}
```

---

## 5. Takip 1 (D+4, yalnız açanlara)

Konu: `Re: {{firma}} — AI görünürlük karnesi`

```
Sayın {{ad}} {{soyad}},

Geçen hafta {{firma}} için sektör araştırması karnesi teklif etmiştim. Tek soru:
"{{sektor_sorusu}}" sorusuna AI asistanlarının verdiği cevapta {{firma}}'nın geçip
geçmediğini görmek ister misiniz?

"Evet" yazmanız yeterli; 2 iş günü içinde yalnız size iletiyorum. Cevap vermezseniz
bir kez daha yazıp kapatacağım.

[Ad Soyad] · RanksUp · {{unsubscribe}}
```

## 6. Takip 2 (D+9, son)

Konu: `Son mesaj — {{firma}} sektör bulguları`

```
Sayın {{ad}} {{soyad}},

Bu son mesajım; bir daha yazmayacağım.

Araştırmanın toplu bulgusunu (kurum adı yok, sektör geneli) rapor yayımlandığında
isterseniz iletebilirim. {{firma}}'ya özel karne teklifi de açık kalıyor — "evet" yeterli.

Zaman ayırdığınız için teşekkürler.
[Ad Soyad] · RanksUp · {{unsubscribe}}
```

---

## 7. LinkedIn (Faz 8 botu kullanır)

**Bağlantı notu (≤300 karakter):**
```
Merhaba {{ad}} Bey/Hanım, RanksUp'ta Türkiye {{sektor_adi}} sektörü için bağımsız bir AI
görünürlük araştırması yürütüyorum; {{firma}} kapsamda. Kurumunuza özel karneyi ücretsiz
paylaşmak için bağlantı kurmak isterim.
```
(Bey/Hanım eki: `kisiler.csv`'de cinsiyet alanı YOK; bot bunu bilemez → notta hitap
**"Merhaba {{ad}} {{soyad}},"** kullanılır, Bey/Hanım eklenmez.)

**Kabul sonrası mesaj (~80 kelime):**
```
Merhaba {{ad}} {{soyad}}, bağlantı için teşekkürler.

Müşteriler artık "{{sektor_sorusu}}" sorusunu Google'a değil ChatGPT'ye soruyor ve cevapta
3 isim geçiyor. RanksUp olarak 7 AI asistanında, marka adı geçmeyen gerçek sorularla
{{firma}}'nın nerede göründüğünü ölçüp yalnız size iletebilirim — kurum bazlı sonuç
kamuya açılmaz.

Karnenizi çıkarmamı ister misiniz? "Evet" yeterli, 2 iş günü içinde iletiyorum.
İstemezseniz bir daha yazmayacağım.
```

---

## 8. Ölçüm

- Linkler: `?utm_source=jetmail&utm_medium=email&utm_campaign=kurumsal-<sektor>-<varyant>`
  (`landing-track.ts` yalnız source/medium/campaign yakalar; varyant campaign'e gömülü).
- Hedef: açılma ≥ %30, cevap %1-2 (6.000 → 60-120), toplantı 15-25, karne teslimi ≤ 2 iş günü.
- Cevaplar `prospect/data/cevaplar.csv` (firma, kişi, tarih, sonuç: evet / hayır / toplantı / ret).
- Kendi testini koşan kurumlar `PublicCitationCheck` → `/admin/leads` ile listeyle eşlenir.
