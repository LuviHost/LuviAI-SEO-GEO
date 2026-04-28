-- LinkedIn avatar CDN URL'leri default 191 char'i asabiliyor
ALTER TABLE `social_channels` MODIFY `externalAvatar` VARCHAR(1000) NULL;
