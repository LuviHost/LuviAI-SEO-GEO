-- Sprint Onboarding: Hibrit yayin akisi + 6 adimli wizard

ALTER TABLE `sites`
  ADD COLUMN `publishApprovalMode`     VARCHAR(32) NOT NULL DEFAULT 'manual_approve',
  ADD COLUMN `autoGenerationFrequency` VARCHAR(32) NOT NULL DEFAULT 'weekly',
  ADD COLUMN `autoGenerationHour`      INT         NOT NULL DEFAULT 9,
  ADD COLUMN `onboardingStep`          INT         NOT NULL DEFAULT 1,
  ADD COLUMN `onboardingCompletedAt`   DATETIME(3) NULL;
