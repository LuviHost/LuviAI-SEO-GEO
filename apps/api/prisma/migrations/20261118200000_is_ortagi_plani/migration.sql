-- Is ortagi plani (18.11.2026, sahip: ajans musterilerinin markalari icin; panelde satilmaz,
-- yonetici atar, odeme havale + elle fatura). Yeni deger SONA eklenir: mevcut satirlar ve
-- varsayilan ('TRIAL') degismez, tablo yeniden yazilmaz (MySQL ENUM'a sondan ekleme yalniz
-- tanimi degistirir).
ALTER TABLE `users` MODIFY `plan` ENUM('TRIAL', 'STARTER', 'PRO', 'AGENCY', 'ENTERPRISE', 'PARTNER') NOT NULL DEFAULT 'TRIAL';
