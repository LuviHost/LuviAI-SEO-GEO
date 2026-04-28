-- ALTER `jobs.type` ENUM: SOCIAL_PUBLISH değeri eklendi (cron-tabanlı sosyal yayın)
ALTER TABLE `jobs`
  MODIFY `type` ENUM(
    'SITE_AUDIT',
    'AUTO_FIX',
    'BRAIN_GENERATE',
    'TOPIC_ENGINE',
    'GENERATE_ARTICLE',
    'PUBLISH_ARTICLE',
    'GENERATE_IMAGE',
    'IMPROVE_PAGE',
    'WEEKLY_BATCH',
    'PERFORMANCE_CHECK',
    'ONBOARDING_CHAIN',
    'SOCIAL_PUBLISH'
  ) NOT NULL;
