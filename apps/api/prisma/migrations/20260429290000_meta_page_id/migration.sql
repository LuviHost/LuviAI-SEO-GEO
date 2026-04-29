-- Faz 11.3: Meta Page ID + Instagram Actor ID
-- Campaign creation + page post boost icin gerekli (account ID ad set'leri tutar,
-- Page ID page post + audience targeting + reklam yayini icin lazim).
ALTER TABLE `sites` ADD COLUMN `metaPageId` VARCHAR(191) NULL;
ALTER TABLE `sites` ADD COLUMN `metaInstagramActorId` VARCHAR(191) NULL;
