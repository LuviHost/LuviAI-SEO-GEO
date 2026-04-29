-- Webhook notification alanlari (Slack / Discord)
ALTER TABLE `sites` ADD COLUMN `notifyWebhookUrl` VARCHAR(500) NULL;
ALTER TABLE `sites` ADD COLUMN `notifyWebhookKind` VARCHAR(20) NULL;
