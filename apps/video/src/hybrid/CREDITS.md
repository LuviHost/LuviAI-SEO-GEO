# Hibrit tanıtım videosu — kaynaklar ve lisanslar

Video (`Hybrid-dikey`, `Hybrid-yatay`) tamamen ücretsiz kaynaklardan üretilir; harici servis, hesap ya da ücretli lisans yok.

## Stok görüntü — Mixkit

Lisans: **Mixkit Stock Video Free License** — <https://mixkit.co/license/#videoFree>

- Ticari ve kişisel kullanım serbest, atıf gerekmez.
- Klipler **tek başına yeniden dağıtılamaz** (stok kütüphanesi gibi paylaşılamaz). Bu yüzden ham klipler
  `apps/video/public/stock/` altında durur ve **git'e girmez** (`apps/video/.gitignore`). Yeniden render için
  aşağıdaki sayfalardan (hesap gerekmez) indirip aynı dosya adıyla `public/stock/` altına koy.
- Görüntüdeki kişiler markayı onaylıyormuş gibi sunulmaz: ekrandaki metin ürün açıklamasıdır, alıntı ya da
  müşteri yorumu değildir.

| Sahne | Biçim | Dosya (`public/stock/`) | Kaynak |
|---|---|---|---|
| Kanca — "Müşterin telefondan soruyor:" | dikey | `woman-typing-on-her-cell-phone-43270.mp4` | <https://mixkit.co/free-stock-video/woman-typing-on-her-cell-phone-43270/> |
| Kanca — "Müşterin telefondan soruyor:" | yatay | `hands-of-a-person-typing-on-a-cell-phone-4915.mp4` | <https://mixkit.co/free-stock-video/hands-of-a-person-typing-on-a-cell-phone-4915/> |
| Kanca — "Cevapta sen var mısın?" | dikey | `entrepreneur-woman-typing-on-her-laptop-42652.mp4` | <https://mixkit.co/free-stock-video/entrepreneur-woman-typing-on-her-laptop-42652/> |
| Kanca — "Cevapta sen var mısın?" | yatay | `thoughtful-woman-working-in-her-office-42656.mp4` | <https://mixkit.co/free-stock-video/thoughtful-woman-working-in-her-office-42656/> |
| Özet — "Görünürlüğünü ölç, eksikleri gör, içeriği RanksUp yazsın." | ikisi | `portrait-of-female-entrepreneur-in-her-office-21217.mp4` | <https://mixkit.co/free-stock-video/portrait-of-female-entrepreneur-in-her-office-21217/> |

## Müzik ve efektler

Kodla sentezlenir (`scripts/audio/synth-pillars.mjs` + `styles.mjs`, "normal" üslup: chill-hop, 90 BPM); örnek/sample
yok, üçüncü taraf müzik yok → `public/audio/pillars/hibrit.wav`, -14 LUFS. Seslendirme yok.

## Yazı tipleri

Sora ve Plus Jakarta Sans — SIL Open Font License 1.1 (`public/fonts/OFL.txt`).

## Ekran metinleri

Panel ve kapanış metinleri `src/pillars/script.json`'daki doğrulanmış sütun metinlerinden kopyalanır (`resolve.mjs`);
iddiaların kaynağı `apps/video/README.md` "Tanıtım videoları — 5 sütun". Panel verileri "Örnek …" etiketli, örnek
site kurgusal (`ornekklinik.com`). AI asistanları yalnız metin etiketi (üçüncü taraf logosu yok).
