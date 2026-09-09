# RanksUp — kurumsal (B2B) soğuk e-posta ve LinkedIn şablonları

Hedef: büyük kurumlarda **pazarlama tarafındaki karar verici** (CMO / Pazarlama Direktörü,
Dijital Pazarlama Müdürü, Marka ve İletişim Müdürü, Dijital Kanallar, Büyüme). IT / uyum /
hukuk tarafına ilk mesaj **atılmaz** — orada "yeni tedarikçi" sürecine girer, aylarca bekler.

Kurgu: **kurucudan kısa bir gözlem + ücretsiz ölçüm teklifi.** Ön ölçüm yapılmadı; bu yüzden
"sizi ölçtük" DENMEZ — "ölçüyoruz" (genel yetkinlik) denir. Çağrı, metindeki "kısa bir görüşme"
cümlesidir; alıcı doğrudan yanıt yazar. Sonuç birebir ve gizli ("sonucu yalnız sizinle
paylaşıyoruz"). Rapor üretimi: `apps/api/src/cli/prospect-karne.ts` (bkz. `prospect/OKUBENI.md`).

Ton (kurucunun LinkedIn mesajlarına verdiği geri bildirim): "çok hazır / bot gibi" metin
**reddedildi**. İstenen: doğal, tek fikir, gözlem dili, yumuşak kapanış ("Uygun değilse de
anlayışla karşılarım."). Ölçülmemiş sayı ("cevapta 3 isim geçiyor"), buton CTA ve "bu maile
kısa bir yanıt yazın" tipi talimat **yok**; konu satırı ≤ 60 karakter, büyük harf/ünlem yok.
Kaynaksız sayı YOK — "yedi AI asistanı" kodda doğrulanmış tek sayıdır.

KOBİ hunisi (`mail-sablonlari.md`) ile **karıştırma**: oradaki "bankaları çıkar" kuralı o
huniye özeldir; bu kampanya bankaları hedefler.

---

## 0. Göndermeden önce — zorunlu ön koşullar

1. **İYS kaydı** (Luvi Host tüzel kişi; MERSİS/e-Devlet). Yönetmelik md. 5/2: yalnız tacirlere
   yazsan bile kayıt zorunlu. Md. 6/6: tacir/esnaf adresleri gönderimden **önce** İYS'ye
   yüklenir, **ret listesi** kontrol edilir. Ret → 3 iş günü içinde İYS'ye bildir ve dur.
2. **KVKK:** isimli iş adresi kişisel veridir. Kurul 2022/861'de arama motorundan bulunan iş
   e-postasına pazarlama için 150.000 TL kesti. Bu yüzden: yalnız kurumsal alan adı, unvan
   bazlı iş amacı, her mailde aydınlatma linki (`ranksup.ai/kvkk#kurumsal-iletisim`), ilk
   itirazda sil, kişisel adres (gmail vb.) asla. Risk sıfır değil — karar kurucunun.
3. **Gönderim adresi `info@ranksup.ai`** (ana alan adı; karar: ayrı bir `go.` alt alanı
   şimdilik YOK, ileride itibar ayrımı gerekirse açılır. Resend işlemsel için
   `mail.ranksup.ai` ayrı kalır). Mailjet Send API v3.1 (`06-mailjet.ts`); SPF + DKIM
   (Mailjet anahtarı) + DMARC durumu `--dns` ile bakılır. Test: mail-tester ≥ 9/10, Gmail +
   Outlook + kurumsal M365 adresine deneme (`--test` GERÇEK mail atar; yalnız kendi adresine).
4. **Isındırma:** gün 100 → 200 (script üst sınırı 200; 400 için GUNLUK_KOTA bilinçli yükseltilir). 6.000 ≈ 4 hafta. Salı-Perşembe 09:30-11:30.
   Bounce > %3 veya şikâyet > %0,2 → dalga durur, liste yeniden doğrulanır.
5. **Yasak ifadeler:** SSO, SOC 2, ekip koltuğu (yok, vaat edilmez); tek kaynaklı sayılar
   (%34,5 / 33× / %68,9); "40+ kurum ölçtük" tipi yer tutucular; "cevapta 3 isim / 2-3 marka
   geçiyor" gibi ölçülmemiş sayılar (→ "birkaç kurum adı"); BDDK/düzenleyici ilişkisi
   iması; Kobipratik adı **yazılı onaysız** geçmez — geçerse ortak kurucu ilişkisi de yazılır.
6. Fiyat sorulursa tek kaynak `apps/api/src/billing/plans.ts` (Kurumsal: iletişime geçin;
   $1.499/ay, 50 site, API + MCP + BYOK, hesap yöneticisi + SLA). `docs/PRICING.md` bayat.

Merge alanları (script `{{x}}` → Mailjet `{{var:x}}` çevirir): `{{ad}}` `{{soyad}}` `{{firma}}`
(kısa marka adı, ek almaz — cümle eksiz kurulur) `{{unvan}}` `{{sektor_sorusu}}` `{{gonderen_ad}}`
`{{gonderen_unvan}}` `{{gonderen_adres}}` `{{mersis}}` `{{gonderen_eposta}}` `{{unsubscribe}}`
(→ `[[UNSUB_LINK_EN]]` (Mailjet TR etiketi sunmuyorsa; panelden doğrula)) · HTML'de `{{var:varyant}}` (konu varyantı A/B, utm_campaign'e gömülü).

---

## 1. Konu satırları (A/B — 2 varyant dönüşümlü, etiketle; ≤ 60 karakter, büyük harf/ünlem yok)

- A: `{{firma}} — AI asistanlarında görünürlük`
- B: `ChatGPT {{firma}} hakkında ne söylüyor?`
- Ön izleme (preheader, HTML'de): `İnsanlar "{{sektor_sorusu}}" sorusunu artık bir AI asistanına soruyor.`

(Eski "…dendiğinde {{firma}} geçiyor mu?" kalıbı soru metniyle 60 karakteri aşıyordu;
`06-mailjet.ts` içindeki `KONU` haritası bu iki satırla eşlenmeli. En uzun kısa ad
"Wyndham Grand İstanbul Europe" ile A tam 60 karakter; `--dry-run` aşanları uyarır.)

---

## 2. Şablon A — Finans (banka, ödeme / e-para, sigorta, leasing-faktoring)

`{{sektor_sorusu}}` örnekleri: "bana bir dijital banka öner" · "KOBİ için en uygun POS hangisi"
· "yurt dışından ödeme almak için hangi kuruluş" · "en uygun kasko hangi şirkette"

```
Sayın {{ad}} {{soyad}},

Ben {{gonderen_ad}}, RanksUp'ın kurucusuyum. Markaların ChatGPT, Gemini, Perplexity gibi AI asistanlarında nasıl göründüğünü ölçüyoruz.

Bir gözlemi paylaşmak istedim: insanlar "{{sektor_sorusu}}" gibi soruları artık arama motoruna değil bir AI asistanına soruyor. Asistanın cevabında birkaç kurum adı geçiyor; o listede olmayan kurum, o müşterinin gündemine hiç girmiyor. Bunun yeni bir görünürlük kanalı olduğunu ve çoğu kurumun burada nerede durduğunu bilmediğini görüyoruz.

{{firma}} için bunu somut olarak gösterebiliriz: yedi AI asistanına marka adı geçmeyen gerçek müşteri soruları sorup hangi asistanın sizi önerdiğini, yanınızda kimin öne çıktığını ve hangi sorularda hiç görünmediğinizi tek bir raporda ortaya koyuyoruz. Çalışma ücretsiz; sonucu yalnız sizinle paylaşıyoruz.

İlgilenirseniz kısa bir görüşmede nasıl ölçtüğümüzü ve {{firma}} için neler görebileceğimizi anlatmak isterim. Uygun değilse de anlayışla karşılarım.

Saygılarımla,
{{gonderen_ad}}
{{gonderen_unvan}}
{{gonderen_adres}} · MERSİS {{mersis}} · ranksup.ai

Bu ileti, 6563 sayılı Kanun md. 6/2 kapsamında tacir alıcıya gönderilen bir ticari elektronik iletidir; İYS üzerinden kaydedilmiştir.
Aydınlatma metni: ranksup.ai/kvkk#kurumsal-iletisim · Bu iletiyi almak istemiyorsanız: {{unsubscribe}}
(3 iş günü içinde durduruyoruz.)
```

## 3. Şablon B — E-ticaret / perakende / teknoloji

`{{sektor_sorusu}}` örnekleri: "telefon almak için hangi site güvenilir" · "hızlı market
teslimatı için hangi uygulama" · "en iyi indirim dönemi hangi mağazada" · "çocuk için güvenli
tablet nereden alınır"

```
Sayın {{ad}} {{soyad}},

Ben {{gonderen_ad}}, RanksUp'ın kurucusuyum. Markaların ChatGPT, Gemini, Perplexity gibi AI asistanlarında nasıl göründüğünü ölçüyoruz.

Bir gözlemi paylaşmak istedim: insanlar "{{sektor_sorusu}}" gibi alışveriş sorularını artık arama motoruna değil bir AI asistanına soruyor. Asistanın cevabında birkaç marka adı geçiyor; o listede olmayan marka, o müşterinin gündemine hiç girmiyor. Reklamla o cevaba girilmiyor; içerik ve yapısal sinyallerle giriliyor. Bunun yeni bir görünürlük kanalı olduğunu ve çoğu markanın burada nerede durduğunu bilmediğini görüyoruz.

{{firma}} için bunu somut olarak gösterebiliriz: yedi AI asistanına marka adı geçmeyen gerçek alışveriş soruları sorup hangi asistanın sizi önerdiğini, yanınızda kimin öne çıktığını ve hangi sorularda hiç görünmediğinizi tek bir raporda ortaya koyuyoruz. Çalışma ücretsiz; sonucu yalnız sizinle paylaşıyoruz.

İlgilenirseniz kısa bir görüşmede nasıl ölçtüğümüzü ve {{firma}} için neler görebileceğimizi anlatmak isterim. Uygun değilse de anlayışla karşılarım.

Saygılarımla,
{{gonderen_ad}}
{{gonderen_unvan}}
{{gonderen_adres}} · MERSİS {{mersis}} · ranksup.ai

Bu ileti, 6563 sayılı Kanun md. 6/2 kapsamında tacir alıcıya gönderilen bir ticari elektronik iletidir; İYS üzerinden kaydedilmiştir.
Aydınlatma metni: ranksup.ai/kvkk#kurumsal-iletisim · Bu iletiyi almak istemiyorsanız: {{unsubscribe}}
(3 iş günü içinde durduruyoruz.)
```

## 4. Şablon C — Turizm / havayolu / telekom / otomotiv

`{{sektor_sorusu}}` örnekleri: "İstanbul-Londra için hangi havayolu" · "yurt dışında internet
için hangi operatör" · "aile için hangi SUV" · "Antalya'da çocuklu aile için hangi otel"

```
Sayın {{ad}} {{soyad}},

Ben {{gonderen_ad}}, RanksUp'ın kurucusuyum. Markaların ChatGPT, Gemini, Perplexity gibi AI asistanlarında nasıl göründüğünü ölçüyoruz.

Bir gözlemi paylaşmak istedim: insanlar "{{sektor_sorusu}}" gibi soruları artık karşılaştırma sitesi gezmek yerine bir AI asistanına soruyor. Asistanın cevabında birkaç marka adı geçiyor; o listede olmayan marka, o müşterinin gündemine hiç girmiyor. Bunun yeni bir görünürlük kanalı olduğunu ve çoğu markanın burada nerede durduğunu bilmediğini görüyoruz.

{{firma}} için bunu somut olarak gösterebiliriz: yedi AI asistanına marka adı geçmeyen gerçek müşteri soruları sorup hangi asistanın sizi önerdiğini, yanınızda kimin öne çıktığını ve hangi senaryolarda hiç görünmediğinizi tek bir raporda ortaya koyuyoruz. Çalışma ücretsiz; sonucu yalnız sizinle paylaşıyoruz.

İlgilenirseniz kısa bir görüşmede nasıl ölçtüğümüzü ve {{firma}} için neler görebileceğimizi anlatmak isterim. Uygun değilse de anlayışla karşılarım.

Saygılarımla,
{{gonderen_ad}}
{{gonderen_unvan}}
{{gonderen_adres}} · MERSİS {{mersis}} · ranksup.ai

Bu ileti, 6563 sayılı Kanun md. 6/2 kapsamında tacir alıcıya gönderilen bir ticari elektronik iletidir; İYS üzerinden kaydedilmiştir.
Aydınlatma metni: ranksup.ai/kvkk#kurumsal-iletisim · Bu iletiyi almak istemiyorsanız: {{unsubscribe}}
(3 iş günü içinde durduruyoruz.)
```

---

## 5. Takip 1 (D+4, yalnız açanlara)

Konu: `Re: {{firma}} — AI asistanlarında görünürlük`

```
Sayın {{ad}} {{soyad}},

Geçen hafta {{firma}} için AI asistanlarındaki görünürlüğü ücretsiz ölçmeyi önermiştim.
Tek soru: "{{sektor_sorusu}}" sorusuna AI asistanlarının verdiği cevapta {{firma}} adının
geçip geçmediğini görmek ister misiniz?

Kısa bir görüşme yeterli; sonucu yalnız sizinle paylaşıyoruz. Uygun değilse de anlayışla
karşılarım; bir kez daha yazıp kapatacağım.

{{gonderen_ad}} · {{gonderen_unvan}} · Bu iletiyi almak istemiyorsanız: {{unsubscribe}}
```

## 6. Takip 2 (D+9, son)

Konu: `Son mesaj — {{firma}} için AI görünürlük`

```
Sayın {{ad}} {{soyad}},

Bu son mesajım; bir daha yazmayacağım.

{{firma}} için ücretsiz ölçüm teklifi açık kalıyor; ilgilenirseniz bu maile yanıt vermeniz
yeterli, kısa bir görüşmede nasıl ölçtüğümüzü anlatırım.

Zaman ayırdığınız için teşekkürler.
{{gonderen_ad}} · {{gonderen_unvan}} · Bu iletiyi almak istemiyorsanız: {{unsubscribe}}
```

---

## 7. LinkedIn (Faz 8 botu kullanır)

**Bağlantı notu (≤300 karakter):**
```
Merhaba {{ad}} {{soyad}}, RanksUp'ın kurucusuyum; markaların ChatGPT, Gemini, Perplexity
gibi AI asistanlarında nasıl göründüğünü ölçüyoruz. {{firma}} için bunu ücretsiz
gösterebilirim; bağlantı kurmak isterim.
```
(Bey/Hanım eki: `kisiler.csv`'de cinsiyet alanı YOK; bot bunu bilemez → notta hitap
**"Merhaba {{ad}} {{soyad}},"** kullanılır, Bey/Hanım eklenmez.)

**Kabul sonrası mesaj (~80 kelime):**
```
Merhaba {{ad}} {{soyad}}, bağlantı için teşekkürler.

Bir gözlemi paylaşmak istedim: insanlar "{{sektor_sorusu}}" gibi soruları artık arama
motoruna değil bir AI asistanına soruyor; cevapta birkaç kurum adı geçiyor, o listede
olmayan kurum o müşterinin gündemine hiç girmiyor. {{firma}} için yedi AI asistanına
marka adı geçmeyen gerçek sorular sorup nerede göründüğünüzü tek raporda gösterebiliriz;
ücretsiz, sonucu yalnız sizinle paylaşıyoruz.

İlgilenirseniz kısa bir görüşmede anlatmak isterim. Uygun değilse de anlayışla karşılarım.
```

---

## 8. Ölçüm

- Linkler: `?utm_source=jetmail&utm_medium=email&utm_campaign=kurumsal-<sektor>-{{var:varyant}}`
  (`landing-track.ts` yalnız source/medium/campaign yakalar; varyant campaign'e gömülü,
  Mailjet `var:varyant` değişkenini script doldurur).
- Hedef: açılma ≥ %30, cevap %1-2 (6.000 → 60-120), toplantı 15-25, rapor teslimi ≤ 2 iş günü.
- Cevaplar `prospect/data/cevaplar.csv` (firma, kişi, tarih, sonuç: olumlu / olumsuz / toplantı / ret).
- Kendi testini koşan kurumlar `PublicCitationCheck` → `/admin/leads` ile listeyle eşlenir.
