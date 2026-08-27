-- Audit sorunlarinin sablon (URL deseni) bazli ozeti — "yuzlerce sayfa hatasi cogu
-- zaman tek bilesen duzeltmesidir". Tarama uretilirken hesaplanir (issue-grouping.ts);
-- eski taramalarda NULL, UI o zaman eski duz listeyi gosterir.
ALTER TABLE `audits` ADD COLUMN `issueGroups` JSON NULL;
