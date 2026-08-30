-- LinkedIn erisiminde kampanya turu (musteri / yatirimci / is birligi)
ALTER TABLE `linkedin_prospects`
  ADD COLUMN `kampanya` ENUM('MUSTERI', 'YATIRIMCI', 'ISBIRLIGI') NOT NULL DEFAULT 'MUSTERI';
