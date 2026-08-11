# RanksUp — Mobil App (Expo)

AI Ajan konsepti mobil uygulama. Claude Design "RanksUp Mobile" tasarımının
gerçek Expo / React Native implementasyonu.

- **Estetik:** sıcak-koyu ("komuta"/ajan) — espresso zemin `#17100B`, ateş
  gradyanı `#F36D32 → #B63325`, krem metin.
- **Tipografi:** Sora (display), Plus Jakarta Sans (gövde), JetBrains Mono (veri).
- **Ekranlar:** Onboarding (3) · Ajan feed · AI Görünürlük · ASO · Studio.
- **Diller:** TR / EN (header'daki TR/EN ile anlık geçiş).

## Çalıştır

```bash
cd mobile
npm install          # bağımlılıklar (ilk sefer)
npx expo start       # Metro başlar, QR çıkar
```

Telefonunda **Expo Go** uygulamasını aç, QR'ı okut → app cihazında açılır.
Simülatör için: `npx expo start` sonrası `i` (iOS) veya `a` (Android).

## Yapı

```
app/
  _layout.tsx      root: font yükleme, dil provider, koyu tema
  index.tsx        Onboarding (site bağla → AI analiz → hazır)
  app.tsx          Uygulama kabuğu: header + içerik + alt bar (4 sekme)
src/
  theme.ts         renk/font/spacing token'ları
  i18n.ts          TR/EN metinler + veri (motorlar, keyword'ler, feed)
  fonts.ts         Google Fonts (expo-font)
  components.tsx    Orb, ikonlar, gradyan buton, kart, spinner, ekran zemini
  screens/
    Agent.tsx      Ajan feed + onay bekleyen aksiyon kartı
    Visibility.tsx AI görünürlük skoru + 7 motor + GEO roadmap
    Aso.tsx        ASO skor halkası + keyword + Apple Search Ads
    Studio.tsx     içerik üretimi → 3 varyant
```

## Doğrulama

- `npx tsc --noEmit` — tip kontrolü temiz.
- `npx expo export -p ios` — Metro bundle başarılı (JS/import/babel çözülüyor).

## Sıradaki (planlanan)

- Push bildirimleri: `expo-notifications` + push token'ı `Site`/`User`'a kaydet.
- Gerçek veri: `api.ranksup.ai` uçlarına bağlama (şu an tasarım verisi).
- Kimlik: mobil için JWT giriş akışı.
- EAS Build ile mağaza dağıtımı.
