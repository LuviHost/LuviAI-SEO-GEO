-- Panelden elle girilen arama sorgusu. syncCatalog() `target` alanini koddaki
-- INTEL_SOURCES'tan ezdigi icin override AYRI alanda tutuluyor; bos ise
-- katalog degeri gecerli kalir.
ALTER TABLE `intel_sources` ADD COLUMN `targetOverride` TEXT NULL;
