-- AI cevaplarinin alintiladigi dis kaynaklar (GEO Faz 2, 2026-10).
--
-- AiCitationSnapshot.probes, AiCitationRun.providers ve Audit.checks zaten JSON;
-- kaynak listesi oraya probe alani olarak yazilir (sema degisikligi yok).
-- GeoPromptRun'da (Prompt Lab) probe basina satir var ve uygun JSON kolonu
-- yok — iki NULL'LANABILIR kolon eklenir. Geriye uyumlu: eski satirlar NULL
-- kalir (sourcesVersion NULL = kaynaklar yakalanmadan once yazildi), geri
-- doldurma YOK (eski cevaplarin kaynak listesi saklanmadi). MySQL 8'de
-- NULL'lanabilir ADD COLUMN aninda (INSTANT) uygulanir.
-- SQL `prisma migrate diff` ile semadan uretildi (veritabanina dokunmadan).

-- AlterTable
ALTER TABLE `geo_prompt_runs` ADD COLUMN `sources` JSON NULL,
    ADD COLUMN `sourcesVersion` INTEGER NULL;
