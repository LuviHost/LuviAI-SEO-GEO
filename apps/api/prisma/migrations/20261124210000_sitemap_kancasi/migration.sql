-- Yayin sonrasi site haritasi tetigi: site basina tek amacli anahtarin SHA-256'si
ALTER TABLE `sites` ADD COLUMN `sitemapKancaHash` VARCHAR(64) NULL;
CREATE UNIQUE INDEX `sites_sitemapKancaHash_key` ON `sites`(`sitemapKancaHash`);
