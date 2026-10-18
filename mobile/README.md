# RanksUp — Mobil App (Expo)

RanksUp'ın mobil uygulaması: ücretsiz AI görünürlük testi, hesap özeti, bildirimler
ve ASO. Ekranlar yalnız API'den gelen gerçek veriyi gösterir; veri yoksa bunu
açıkça söyler (örnek/uydurma sayı yok).

- **Estetik:** sıcak-koyu — espresso zemin `#17100B`, ateş gradyanı
  `#F36D32 → #B63325`, krem metin.
- **Tipografi:** Sora (display), Plus Jakarta Sans (gövde), JetBrains Mono (veri).
- **Ekranlar:** İlk açılış (bir kez) · Ana sayfa · AI Görünürlük · ASO · Site analizi · Hesap · Hesabı sil.
- **Diller:** TR / EN (header'daki TR/EN ile anlık geçiş).

## Çalıştır

```bash
cd mobile
npm install          # bağımlılıklar (ilk sefer)
npx expo start       # Metro başlar, QR çıkar
```

Google/Apple girişi native modül ister (Expo Go'da çalışmaz); EAS dev/prod build kullan.

## Yapı

```
app/
  _layout.tsx        root: font yükleme, dil + kimlik + analiz provider'ları
  index.tsx          İlk açılış: alan adı → gerçek public test (/analyze); bir kez gösterilir
  app.tsx            Uygulama kabuğu: header + içerik + alt bar (Ana sayfa · Görünürlük · [analiz] · ASO · Hesap)
  analyze.tsx        Public AI görünürlük testi + 90 gün e-posta takibi (açık rıza kutusu)
  connect.tsx        Hesap: Google / Apple / API anahtarı, bağlı hesap, yasal metinler
  delete-account.tsx Hesabı sil (5.1.1(v)) — silinecek hesap maskeli e-postayla gösterilir
src/
  api.ts             API istemcisi (public test, takip, /me, /notifications, ASO, ASA, hesap silme)
  auth.tsx           Kimlik (SecureStore'da Bearer token) + GET /me
  store.ts           Son analiz sonucu (sekmeler arası paylaşılır)
  visibility.ts      Görünürlük skoru — web summarize() ile aynı tanım (kilitli/markalı/ölçülmeyen hariç)
  aso-live.ts        ASO sıra etiketleri ve seçim yardımcıları
  account.ts         maskEmail, bas harfler
  format.ts          TR/EN sayı ve tarih biçimleri
  legal.tsx          Gizlilik Politikası / KVKK / Kullanım Koşulları bağlantıları (5.1.1(i))
  i18n.ts            TR/EN metinler
  theme.ts           renk/font/tip ölçeği token'ları
  components.tsx     Orb, ikonlar, buton, kart, metrik, logolar
  screens/
    Home.tsx         girişsiz: dürüst tanıtım · bağlı: /me/dashboard + /notifications
    Visibility.tsx   AI görünürlük skoru + asistan bazında + rakip payı + genel öneriler
    Aso.tsx          takip edilen uygulamalar, anahtar kelime sıraları, ASA (bağlıysa), mağaza araması
```

## Doğrulama

- `npx tsc --noEmit` — tip kontrolü (spec dosyaları hariç tutulur).
- Saf modül testleri (mobil kendi test koşucusunu taşımaz; API'nin vitest'i kullanılır):
  `../apps/api/node_modules/.bin/vitest run --root . src`
- `cd ../apps/web && npm run guard:ui` — mobil inline fontSize / sabit hex sayımı tabanı aşmamalı.
