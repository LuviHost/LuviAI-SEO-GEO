-- Pazarlama onayi + soguk gonderim araci durumu (2026-11-02)
--
-- public_citation_subscribers: rapor onayindan ayri pazarlama e-postasi onayi (varsayilan bos kutu) ve
-- onayin alindigi form surumu. Bos birakilabilir sutunlar; mevcut aboneler "onay yok" sayilir.
-- eposta_hedefleri.durum: DIS_ARAC eklenir (soguk gonderim aracina aktarildi). Mevcut degerler korunur.

-- AlterTable
ALTER TABLE `public_citation_subscribers` ADD COLUMN `marketingConsentAt` DATETIME(3) NULL,
    ADD COLUMN `marketingConsentSource` VARCHAR(40) NULL;

-- AlterTable
ALTER TABLE `eposta_hedefleri` MODIFY `durum` ENUM('YENI', 'IYS_DOSYADA', 'SIRADA', 'GONDERILDI', 'HATA', 'BOUNCE', 'RET', 'SPAM', 'HARIC', 'DIS_ARAC') NOT NULL DEFAULT 'YENI';
