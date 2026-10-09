-- Alinti eslestirme yontemi surumu (Dalga B1, 2026-10): 1 = metin.includes(host),
-- 2 = etiket sinirli eslesme (audit/host-match.ts). Mevcut satirlar 1 kalir (geri
-- doldurma YOK: saklanan alintilar 220 karakter, durust yeniden hesap mumkun degil).
-- prisma migrate diff ile uretildi; izole MySQL 8.4 uzerinde "No difference detected".

-- AlterTable
ALTER TABLE `ai_citation_snapshots` ADD COLUMN `matchVersion` INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `ai_citation_runs` ADD COLUMN `matchVersion` INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE `geo_prompt_runs` ADD COLUMN `matchVersion` INTEGER NOT NULL DEFAULT 1;

