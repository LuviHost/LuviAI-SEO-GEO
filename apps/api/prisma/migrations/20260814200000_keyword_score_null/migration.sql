-- Olculemedigi icin 0 yazilmis skorlari NULL'a cevir.
--
-- NEDEN GUVENLI: aso-v2 skorlarinin TABANI 1.0'dir (analyzer.js zScore/izScore
-- her zaman en az 1 doner), normalizeScore ise 10 ile carpiyor. Yani gercek bir
-- olcum ASLA 0 uretemez — en dusuk deger 10'dur. DB'deki her 0, eski koddaki
-- iki yoldan birinden gelmistir:
--   `scores?.difficulty?.score ?? 0`   (alan yoksa 0)
--   `if (v == null || isNaN(v)) return 0;`  (olculemedi -> 0)
--
-- Sonuc olarak "magaza cevap vermedi" ile "olctuk, sifir cikti" ayni gorunuyordu
-- ve arayuz bu 0'lari gercek skor gibi basiyordu. Uretimde 91 kelimenin 40'i
-- difficulty=0 ve traffic=0 idi.
UPDATE `tracked_app_keywords` SET `difficulty` = NULL WHERE `difficulty` = 0;
UPDATE `tracked_app_keywords` SET `traffic`    = NULL WHERE `traffic`    = 0;
UPDATE `tracked_app_keywords` SET `popularity` = NULL WHERE `popularity` = 0;
