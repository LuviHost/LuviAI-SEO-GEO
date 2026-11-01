-- Bot IP dogrulamasi (2026-11-02)
--
-- ai_crawler_hits: dogrulanmis / dogrulanamayan istek sayaclari ve dogrulanamayanlarin durum
-- kovalari. crawler_hit_events: her isabetin dogrulama sonucu + nedeni + (Worker gonderdiyse) ASN.
-- Ham IP saklanmaz. Yalniz varsayilanli / bos birakilabilir sutun ekler; mevcut satirlar
-- "dogrulanamadi" (unknown) sayilir. Mevcut tablolarda veri degismez.

-- AlterTable
ALTER TABLE `ai_crawler_hits` ADD COLUMN `verifiedHits` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `unverifiedHits` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `unverified2xx` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `unverified4xx` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `unverified5xx` INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `crawler_hit_events` ADD COLUMN `verify` VARCHAR(12) NOT NULL DEFAULT 'unknown',
    ADD COLUMN `verifyReason` VARCHAR(24) NULL,
    ADD COLUMN `asn` INTEGER NULL;
