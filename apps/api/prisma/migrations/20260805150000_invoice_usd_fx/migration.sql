-- Fiyatlandirma USD bazina gecti; tahsilat PayTR uzerinden TL yapiliyor.
--
-- NEDEN: Fiyat listesi TL sabitken kod icinde 1 USD = 40 TL varsayiliyordu.
-- Kur bu varsayimin uzerine ciktiginda fiyat sessizce dusuyor, maliyetler
-- (LLM API, video uretimi) USD oldugu icin marj eriyordu. Artik fiyat USD'de
-- sabit, TL tutari siparis aninda TCMB kuruyla hesaplaniyor.
--
-- Bu iki alan faturayi DENETLENEBILIR yapar: hangi USD fiyatin hangi kurla
-- hangi TL tutarina dondugu kayit altina alinir. Turkiye'de dovize endeksli
-- faturalandirmada kullanilan kurun belgelenmesi gerekir.
--
-- Mevcut kayitlar NULL kalir (o donemde fiyat zaten TL kanonikti).

ALTER TABLE `invoices` ADD COLUMN `amountUsd` DECIMAL(10, 2) NULL;
ALTER TABLE `invoices` ADD COLUMN `fxRate` DECIMAL(12, 4) NULL;
