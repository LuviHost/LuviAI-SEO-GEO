-- AI cevaplarinin alintiladigi dis kaynaklar (GEO Faz 2, 2026-10).
--
-- Kaynak listesi yalniz iki yerde tutulur ("alintilanan dis kaynaklar"
-- raporu bunlari okur): AiCitationSnapshot.probes (JSON, sema degisikligi
-- yok) ve GeoPromptRun (Prompt Lab). GeoPromptRun'da probe basina satir var
-- ve uygun JSON kolonu yok — iki NULL'LANABILIR kolon eklenir. Geriye uyumlu:
-- eski satirlar NULL kalir (sourcesVersion NULL = kaynaklar yakalanmadan once
-- yazildi), geri doldurma YOK (eski cevaplarin kaynak listesi saklanmadi).
--
-- SQL `prisma migrate diff` ile semadan uretildi (veritabanina dokunmadan);
-- tek elle eklenen kisim `ALGORITHM=INSTANT`: nullable ADD COLUMN MySQL 8'de
-- zaten aninda uygulanir, ama sunucu INSTANT yapamazsa (orn. tablo satir
-- surumu sinirina ulasmissa) sessizce tabloyu KOPYALAYARAK kilitlemek yerine
-- hata verip durur. Bu durumda migration'i bakim penceresinde INSTANT'siz
-- calistirmak bilincli bir karar olmali.

-- AlterTable
ALTER TABLE `geo_prompt_runs` ADD COLUMN `sources` JSON NULL,
    ADD COLUMN `sourcesVersion` INTEGER NULL,
    ALGORITHM=INSTANT;
