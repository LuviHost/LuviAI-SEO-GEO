-- Hukmun GERCEKTEN degistigi an.
--
-- NEDEN updatedAt YETMIYOR: intel.cron.ts gunluk ozetten hemen once
-- recomputeAll() cagiriyor ve claim-ledger.service.ts icindeki recompute()
-- deger degismese bile kosulsuz update() yapiyordu. Prisma'nin @updatedAt
-- alani boylece her gece TUM satirlarda tazeleniyordu.
--
-- Ozet ise "donem icinde degisen iddialar"i `updatedAt >= since` ile
-- suzuyordu — yani her sabah defterin tamami eslesiyordu. Gorunen sonuc:
--
--   * e-posta konusundaki "745 iddia" toplam iddia sayisiydi, degisim degil
--   * "Curutulen iddialar (MIT)" bolumu o gunun mitlerini degil defterdeki
--     TUM mitleri listeliyordu (yeni kaniti olmayanlar dahil)
--
-- Modulun kendi ilkesiyle celisiyordu: "Ne degisti her zaman ne var'dan
-- onemli" (digest.service.ts dosya basi).
--
-- updatedAt oldugu gibi birakiliyor — teknik denetim alanidir, urun anlami
-- yuklenmemeli. Ayri alan, kosullu yazma mantigindan daha okunakli.
--
-- NULL baslangic: mevcut iddialar icin "en son ne zaman hukum degistirdi"
-- bilgisi gecmise donuk uretilemez. NULL = "henuz degisim kaydedilmedi";
-- ilk gercek degisimde dolar. Ozet NULL satirlari kapsam disi birakir, yani
-- ilk gun ozet dogal olarak kisa gelir — bu dogru davranis.
ALTER TABLE `intel_claims` ADD COLUMN `lastChangedAt` DATETIME(3) NULL;

CREATE INDEX `intel_claims_lastChangedAt_idx` ON `intel_claims`(`lastChangedAt`);
