/**
 * Ham bot ziyaret satirlarinin (CrawlerHitEvent) saklama suresi, gun.
 *
 * Live crawler (live-crawler.service.ts purgeOld) bundan eski satirlari siler.
 * Sayfa tarama kapsami (crawler-analytics.service.ts) ham yollari bu tablodan
 * okur; daha uzun bir pencere istendiginde eski ziyaretlerin yollari artik
 * yoktur ve oran "en az" diye isaretlenir. Iki taraf ayni sayiyi bilsin diye
 * tek yerde.
 */
export const CRAWLER_EVENT_RETENTION_DAYS = 60;
