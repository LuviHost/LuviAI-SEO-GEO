-- Resend "Transient" (gecici) geri donmeleri gecici olarak isaretlenir: otomatik frene sayilmaz.
-- Satir BOUNCE kalir — o adrese tekrar yazilmaz. Kalici (Permanent) ve belirsiz (Undetermined) dokunulmaz.
UPDATE `eposta_hedefleri`
SET `sonOlay` = 'soft_bounce'
WHERE `durum` = 'BOUNCE' AND `sonOlay` = 'bounce' AND `hata` LIKE 'Transient:%';
