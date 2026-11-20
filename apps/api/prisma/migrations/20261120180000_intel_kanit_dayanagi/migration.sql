-- Kanit bagimsizligi (20.11.2026): ayni calismayi aktaran yayinlar tek kanit sayilsin.
-- NULL = yayin kendisi birincil kaynak; mevcut kanitlar etiketlenene kadar boyle sayilir.
ALTER TABLE `intel_evidence` ADD COLUMN `basis` VARCHAR(120) NULL;
