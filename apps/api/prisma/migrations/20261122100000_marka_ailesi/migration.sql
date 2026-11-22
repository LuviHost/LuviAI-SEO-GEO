-- Marka ailesi (22.11.2026): sitenin diger adlari (urun / alt marka) ve cevapta yakalanan ad.
-- Ikisi de bos baslar: mevcut siteler yalniz ana adla olculmeye devam eder.
ALTER TABLE `sites` ADD COLUMN `brandAliases` JSON NULL;
ALTER TABLE `geo_prompt_runs` ADD COLUMN `brandMatch` VARCHAR(80) NULL;
