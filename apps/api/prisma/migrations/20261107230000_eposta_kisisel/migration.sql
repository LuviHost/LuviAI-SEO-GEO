-- Kisisel kurumsal mail (2026-11-07)
--
-- eposta_hedefleri: firmaya ozel faaliyet cumlesi, ornek soru ve o sorunun AI olcumu. Yalniz bos birakilabilir
-- sutun ekler; mevcut satirlar "hazirlanmamis" sayilir. Mevcut veride degisiklik yok.

-- AlterTable
ALTER TABLE `eposta_hedefleri` ADD COLUMN `kisisel` JSON NULL,
    ADD COLUMN `kisiselDurum` VARCHAR(16) NULL,
    ADD COLUMN `kisiselAt` DATETIME(3) NULL;

-- CreateIndex
CREATE INDEX `eposta_hedefleri_kisiselDurum_idx` ON `eposta_hedefleri`(`kisiselDurum`);
