-- SORUNUN KENDISINDE marka adi geciyor mu?
--
-- NEDEN GEREKLI: sorguda markanin adi gecince asistanin markayi anmasi
-- neredeyse totolojik. Sektor olcumu farki 33 kat veriyor — sorguda ismi
-- gecen markalar %68,9 oraninda anilirken yalnizca getirilen markalar %2,1.
-- Bugune kadar iki tur satir ayni havuzda, ayni agirlikta toplaniyordu:
--
--   * landing'de 10 sorunun 2'si tanimi geregi markali (BRAND kategorisi)
--   * public-citation sablonlarindaki {BRAND_HINT} yer tutucusu
--   * fan-out sablon dallarinin TAMAMI (fanout.service.ts icinde konu
--     secimi `ctx.brand || ctx.niche || ...` sirasiyla yapiliyor)
--
-- Sonuc: skor gorunurlugu degil prompt bilesimini olcuyordu. Dahasi kayiyordu
-- — AI fan-out uretimi her basarisiz olup sablona dustugunde markali satir
-- orani ziplyor, skor kendiliginden yukseliyor ve bu "iyilesme" gibi
-- okunuyordu.
--
-- Bundan sonra manset metrikler (mentionRate, citationRate, sentiment,
-- shareOfVoice) yalnizca `brandInQuery = false` satirlardan hesaplanir;
-- markali satirlar ayrica "taninirlik" olarak raporlanir.
--
-- DEFAULT false BILINCLI SECIM DEGIL, GECICI DURUM: mevcut satirlar icin bu
-- alan hic olculmedi. Eslesme Turkce katlama gerektirdigi icin (bkz.
-- common/text-normalize.ts — "İddaa" hic eslesmiyordu) SQL'de yapilamaz.
-- Migration'dan SONRA geri doldurma calistirilmali (apps/api icinden):
--   npx tsx scripts/backfill-brand-in-query.ts --apply
-- Calistirilmazsa tarihsel seri markasiz gorunur ve grafikte yapay bir
-- kirilma olusur.
ALTER TABLE `geo_prompt_runs` ADD COLUMN `brandInQuery` BOOLEAN NOT NULL DEFAULT false;

-- Esitlik kolonu range'den ONCE: content-opportunity.derive ve looker
-- mention-rate `siteId = ? AND brandInQuery = ? AND date >= ?` suzuyor;
-- b-tree'de range'den sonraki esitlik seek'te kullanilamaz.
CREATE INDEX `geo_prompt_runs_siteId_brandInQuery_date_idx`
  ON `geo_prompt_runs`(`siteId`, `brandInQuery`, `date`);
