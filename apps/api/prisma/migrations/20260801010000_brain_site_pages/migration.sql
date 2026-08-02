-- Brain'e gercek site sayfa envanteri.
-- Yazar ajani ic link verirken SADECE bu listedeki URL'leri kullanabilir;
-- boylece uydurma (404) ic linkler uretilmez.
ALTER TABLE `brains` ADD COLUMN `sitePages` JSON NULL;
ALTER TABLE `brains` ADD COLUMN `sitePagesAt` DATETIME(3) NULL;
