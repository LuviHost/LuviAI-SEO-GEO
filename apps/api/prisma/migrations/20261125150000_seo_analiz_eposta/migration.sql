-- Ucretsiz SEO analizi: sonucu gormek icin e-posta, ticari ileti onayi, onbellek kopyasi isareti
ALTER TABLE `public_seo_analyses`
  ADD COLUMN `email` VARCHAR(191) NULL,
  ADD COLUMN `pazarlamaIzni` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `onbellek` BOOLEAN NOT NULL DEFAULT false;
