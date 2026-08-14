-- Taramayi KIMIN baslattigini kalici olarak kaydet.
--
-- NEDEN: runAudit() zaten `trigger: 'user' | 'system'` parametresi aliyordu ama
-- bu deger yalnizca kota kararinda kullanilip atiliyordu — Audit satirina hicbir
-- sey yazilmiyordu. Sonuc: gecmiste bir taramanin kullanici tarafindan mi,
-- zamanlanmis cron tarafindan mi, yoksa bir dogrulama testi tarafindan mi
-- baslatildigi ANLASILAMIYOR.
--
-- Bu iki yerde somut zarar veriyor:
--  1. "Ne kadar is yapildi" raporu: AUDIT_CRON acildigi anda her haftalik
--     otomatik tarama gecmise dusup sayiyi sisirir; musteriye gosterilen
--     "6 tarama yapildi" cumlesi yalan olur.
--  2. Uretimde dogrulama icin calistirilan taramalar kullanici taramalarindan
--     ayirt edilemiyor (bu migration tam olarak boyle bir durumda yazildi).
--
-- Varsayilan 'user': mevcut 32 satirin tamami elle baslatilmis gercek
-- taramalar, cunku AUDIT_CRON hic acilmadi. Yanlis etiketlemektense dogru
-- varsayilani vermek daha dogru.
ALTER TABLE `audits` ADD COLUMN `trigger` VARCHAR(16) NOT NULL DEFAULT 'user';

-- Rapor ve gecmis sorgulari "site + tarih + kaynak" uzerinden filtreleyecek.
CREATE INDEX `audits_siteId_trigger_ranAt_idx` ON `audits`(`siteId`, `trigger`, `ranAt`);
