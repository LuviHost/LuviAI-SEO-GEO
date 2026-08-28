# RanksUp — soğuk e-posta şablonları (Jetmail, 6.000 hak)

## Kurallar (göndermeden önce)
- **Alan adı:** ana domainden değil, `mail.ranksup.ai` gibi ayrı alt alan adından gönder; SPF + DKIM + DMARC (p=quarantine) kur. Jetmail'de "özel gönderim alanı" olarak doğrula.
- **Isınma:** 1. hafta günde 150, 2. hafta 300, sonra 500. Şikâyet %0,3 / bounce %3 üstüne çıkarsa dur.
- **Liste hijyeni:** göndermeden önce doğrulama servisinden geçir (geçersiz adresler bounce = itibar kaybı). `info@`, `iletisim@`, `rezervasyon@` gibi kurumsal adresler; kişisel gmail'lere gönderme.
- **Segment:** Oteller (rezervasyon + "yakınımda otel" AI soruları), Kuaför/güzellik (yerel hizmet, "en iyi kuaför X ilçesi"), KOBİ/hizmet (muhasebe, hukuk, klinik). **Bankaları çıkar.**
  - Not (28.08.2026): "Bankaları çıkar" yalnız bu KOBİ/self-servis hunisi içindir. Büyük kurumlar (banka, e-ticaret, havayolu, telekom, otomotiv) için ayrı kampanya: `kurumsal-mail-sablonlari.md` — karar verici hedefli, İYS/KVKK ön koşullu.
- **Hukuk:** her mailde açık kimlik (ad, şirket, adres), tek tıkla ret linki (Jetmail unsubscribe), İYS kaydı. Şahıs işletmelerine ilk mailde satış değil "ücretsiz test sonucu" ver.
- **Kanıt kuralı:** tek kaynaklı sayı (33×, %68,9, %34,5) kullanma. Müşteri adı (Kobipratik) yazılı onaysız geçmez.
- **Uzunluk:** 90-130 kelime, düz metin görünümü, tek CTA, ek yok, görsel yok (ilk mailde).

Değişkenler: `{{firma}}` `{{sehir}}` `{{sektor_sorusu}}` `{{ad}}` (Jetmail merge alanları).

---

## Konu satırı seçenekleri (A/B — 2-3 tanesini dönüşümlü kullan)
1. `{{firma}} ChatGPT'de görünüyor mu? (30 saniyelik test)`
2. `Müşteriler artık Google'a değil ChatGPT'ye soruyor — {{firma}} cevapta var mı?`
3. `{{sehir}}'de "{{sektor_sorusu}}" diye sorduk`
4. `Sitenizi 7 AI asistana sorduk — sonuç`

Preheader: `Ücretsiz, üyeliksiz, kart yok. Sonucu 30 saniyede görün.`

---

## Şablon 1 — Otel / turizm

**Konu:** `{{sehir}}'de "iyi bir otel" diye sorduk — {{firma}} cevapta yoktu`

Merhaba {{ad}},

Misafirler artık "{{sehir}}'de aile için iyi bir otel" sorusunu Google'a değil ChatGPT'ye, Gemini'ye, Perplexity'ye soruyor. Cevap 2-3 otel adı içeriyor; listede olmayan otel o misafir için hiç var olmuyor.

RanksUp tam bunu ölçüyor: sitenizi her gün 7 AI asistana soruyor, hangi soruda anıldığınızı, hangisinde rakibin önerildiğini gösteriyor — ve eksik olduğunuz soruya cevap veren içeriği üretip yayınlıyor.

Ücretsiz test: **ranksup.ai** adresine sitenizi yazın, 30 saniyede "AI sizi öneriyor mu?" cevabını görün. Üyelik, kart yok.

Sonucu birlikte yorumlamak isterseniz bu maile yanıt vermeniz yeterli.

Emir Burgazlı
Kurucu, RanksUp · ranksup.ai
[Bu tür e-postaları almak istemiyorsanız tek tıkla çıkın: {{unsubscribe}}]

---

## Şablon 2 — Kuaför / güzellik / yerel hizmet

**Konu:** `"{{sehir}} en iyi kuaför" — AI kimi öneriyor?`

Merhaba {{ad}},

Bir müşteri telefonuna "{{sehir}}'de iyi bir kuaför" yazdığında artık karşısına bir liste değil, tek bir cevap çıkıyor: "Şu üç salonu öneririm." O üç ismin içinde olup olmadığınızı bilmiyorsanız, müşteriyi kimin aldığını da bilmiyorsunuz.

RanksUp bunu 30 saniyede gösteriyor: sitenizi yazın, 7 AI asistanın sizi önerip önermediğini görün — ücretsiz, üyeliksiz. Sonra isterseniz, eksik olduğunuz soruların cevabını sizin adınıza yazıp yayınlıyoruz.

Test: **ranksup.ai**

Emir Burgazlı
Kurucu, RanksUp
[Çıkmak için: {{unsubscribe}}]

---

## Şablon 3 — KOBİ / profesyonel hizmet (muhasebe, hukuk, klinik, ajans)

**Konu:** `{{firma}} için 7 AI asistandan gelen cevap`

Merhaba {{ad}},

Potansiyel müşteriniz "{{sektor_sorusu}}" diye ChatGPT'ye sorduğunda cevapta {{firma}} geçiyor mu? Çoğu işletme geçmiyor — ve bunu ölçen bir raporu da yok; Search Console AI cevaplarını göstermiyor.

RanksUp her gün 7 AI asistanı (ChatGPT, Claude, Gemini, Perplexity, Grok, DeepSeek, Meta) test eder, marka adınızın geçtiği soruları skordan ayırır (o tanınırlık, görünürlük değil), kaybettiğiniz soru için içeriği üretip yeniden ölçer.

30 saniyelik ücretsiz test: **ranksup.ai** — üyelik ve kart yok.

Emir Burgazlı
Kurucu, RanksUp
[Çıkmak için: {{unsubscribe}}]

---

## Takip 1 (3 gün sonra, yalnız açıp tıklamayanlara değil — açanlara)

**Konu:** `Re: {{firma}} ChatGPT'de görünüyor mu?`

Merhaba {{ad}}, kısa bir hatırlatma: testi çalıştırdıysanız sonucu birlikte yorumlayabilirim — 15 dakikalık bir görüşme yeter, satış konuşması değil. Çalıştırmadıysanız link: ranksup.ai

Emir

## Takip 2 (7 gün sonra — son)

**Konu:** `Son mesaj — {{firma}}`

Merhaba {{ad}}, bir daha yazmayacağım. Tek soru: müşterileriniz AI'a sorduğunda sizi mi öneriyor, rakibinizi mi? Bilmek istemiyorsanız bu maili silin; istiyorsanız ranksup.ai'de 30 saniye.

Emir

---

## Ölçüm
- Jetmail'de segment etiketi (otel / kuaför / kobi) + konu satırı varyantı etiketi.
- Hedef: açılma %35+, tıklama %3+, test çalıştırma %1+ (6.000 → ~60 test → 10-15 görüşme).
- Test çalıştıranlar `PublicCitationCheck` tablosuna düşer (domain + tarih) — Jetmail listesiyle eşleştirip "test etti / etmedi" takibi yapılır.
