-- Yonetici hesap ayarlari (18.11.2026): kapali asistanlar ve site basina soru tavani.
-- Ikisi de NULL varsayilanli: mevcut hesaplarda hicbir sey degismez (plan degerleri gecerli).
ALTER TABLE `users` ADD COLUMN `disabledEngines` JSON NULL,
    ADD COLUMN `promptsPerSiteOverride` INTEGER NULL;
