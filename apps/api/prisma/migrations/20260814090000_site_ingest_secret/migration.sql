-- Live Crawler ingest kimlik dogrulamasi.
-- POST /api/tracker/events ucu edge kaynaklarindan beslendigi icin oturum
-- tasiyamaz ve @Public() kalmak zorunda. Onceki tek kontrol "siteId DB'de var
-- mi" idi; siteId ise dashboard URL'sinde ve snippet'te acikta durdugu icin
-- siteId'yi goren herkes sahte AI bot ziyareti enjekte edebiliyordu.
-- Bu kolon site basina HMAC-SHA256 sirrini tutar. NULL birakiliyor: sir ilk
-- snippet uretiminde (ensureIngestSecret) olusur, sirri olmayan site ingest
-- kabul etmez.
ALTER TABLE `sites` ADD COLUMN `ingestSecret` VARCHAR(191) NULL;
