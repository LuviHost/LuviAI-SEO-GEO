-- Sprint B: Whitelabel + Agency
ALTER TABLE `users` ADD COLUMN `whitelabelEnabled` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `users` ADD COLUMN `whitelabelBrandName` VARCHAR(120) NULL;
ALTER TABLE `users` ADD COLUMN `whitelabelLogoUrl` VARCHAR(500) NULL;
ALTER TABLE `users` ADD COLUMN `whitelabelPrimaryColor` VARCHAR(20) NULL;
ALTER TABLE `users` ADD COLUMN `whitelabelDomain` VARCHAR(191) NULL;
ALTER TABLE `users` ADD COLUMN `whitelabelEmailFrom` VARCHAR(120) NULL;
ALTER TABLE `users` ADD COLUMN `parentAgencyId` VARCHAR(191) NULL;

CREATE INDEX `users_parentAgencyId_idx` ON `users`(`parentAgencyId`);
CREATE UNIQUE INDEX `users_whitelabelDomain_key` ON `users`(`whitelabelDomain`);

ALTER TABLE `users` ADD CONSTRAINT `users_parentAgencyId_fkey`
  FOREIGN KEY (`parentAgencyId`) REFERENCES `users`(`id`) ON DELETE SET NULL;
