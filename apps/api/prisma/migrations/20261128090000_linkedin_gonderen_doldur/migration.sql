-- LinkedIn takip listesinde "kim gonderdi" (28.11.2026). Gonderen bos kalan kayitlar (elle kayitlar,
-- e-posta kayitlari, eski bot) ikinci yonetici baslamadan once tek hesaptan (kurucu) gitti.
-- Kurucu = ilk ajan kaydi (20261127150000 gecisi eski anahtari kurucuya bagladi; anahtar yenileme
-- createdAt'i degistirmez). Ajan yoksa @kurucu NULL kalir ve hicbir satira dokunulmaz.
SET @kurucu = (SELECT a.`userId` FROM `linkedin_claude_ajanlar` a ORDER BY a.`createdAt` ASC LIMIT 1);

UPDATE `linkedin_prospects` SET `gonderenId` = @kurucu
  WHERE `gonderenId` IS NULL AND `status` <> 'QUEUED' AND @kurucu IS NOT NULL;
