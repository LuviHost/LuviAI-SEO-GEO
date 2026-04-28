-- Site (userId, url) çiftine unique constraint — aynı kullanıcı aynı siteyi
-- iki kez ekleyemesin. URL service'te normalize edilir (lowercase host,
-- trailing slash, query/fragment temizlenir).
CREATE UNIQUE INDEX `sites_userId_url_key` ON `sites`(`userId`, `url`);
