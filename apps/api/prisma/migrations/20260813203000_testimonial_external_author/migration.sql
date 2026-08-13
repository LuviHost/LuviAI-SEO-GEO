-- Landing referanslari her zaman bir panel kullanicisina ait olmak zorunda degil.
-- Musteri firmalarin kurucularindan alinan referanslarda o kisinin RanksUp
-- hesabi olmayabiliyor; userId zorunlu oldugu icin tek cikis yolu o kisi adina
-- sahte hesap acmakti. userId nullable yapildi ve gorunen ad icin ayri bir
-- alan eklendi.
--
-- authorName DOLU olan bir kayit, kisinin YAZILI ONAYI alinmadan
-- approved=true yapilmamalidir (bkz. TestimonialsService.listPublic yorumu).
ALTER TABLE `testimonials` MODIFY `userId` VARCHAR(191) NULL;
ALTER TABLE `testimonials` ADD COLUMN `authorName` VARCHAR(191) NULL;
