-- Panelden verilen yoneticilik: kurucu /admin/users'tan hesap yonetici yapar
ALTER TABLE `users`
  ADD COLUMN `adminYetkiAt` DATETIME(3) NULL,
  ADD COLUMN `adminYetkiVeren` VARCHAR(191) NULL;
