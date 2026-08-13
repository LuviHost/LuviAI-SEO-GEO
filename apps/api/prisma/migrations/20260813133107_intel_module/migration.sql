-- Intel modulu: sektor istihbarati boru hatti (kaynak -> yayin -> kanit -> iddia -> ozet)

-- CreateTable
CREATE TABLE `intel_sources` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `key` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `kind` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `target` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `tier` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `topics` json NOT NULL,
  `weight` int NOT NULL DEFAULT '50',
  `intervalHours` int NOT NULL DEFAULT '24',
  `enabled` tinyint(1) NOT NULL DEFAULT '1',
  `note` text COLLATE utf8mb4_unicode_ci,
  `lastFetchedAt` datetime(3) DEFAULT NULL,
  `failCount` int NOT NULL DEFAULT '0',
  `lastError` text COLLATE utf8mb4_unicode_ci,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `intel_sources_key_key` (`key`),
  KEY `intel_sources_enabled_lastFetchedAt_idx` (`enabled`,`lastFetchedAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `intel_items` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sourceId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `fingerprint` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `url` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `title` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `author` varchar(191) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `publishedAt` datetime(3) DEFAULT NULL,
  `summary` text COLLATE utf8mb4_unicode_ci,
  `fullText` longtext COLLATE utf8mb4_unicode_ci,
  `status` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PENDING',
  `relevance` int DEFAULT NULL,
  `topics` json DEFAULT NULL,
  `triageNote` text COLLATE utf8mb4_unicode_ci,
  `engagement` int DEFAULT NULL,
  `meta` json DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `intel_items_fingerprint_key` (`fingerprint`),
  KEY `intel_items_status_relevance_idx` (`status`,`relevance`),
  KEY `intel_items_sourceId_createdAt_idx` (`sourceId`,`createdAt`),
  KEY `intel_items_publishedAt_idx` (`publishedAt`),
  CONSTRAINT `intel_items_sourceId_fkey` FOREIGN KEY (`sourceId`) REFERENCES `intel_sources` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `intel_claims` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `statement` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `slug` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `topics` json NOT NULL,
  `status` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'EMERGING',
  `confidence` double NOT NULL DEFAULT '0',
  `supportWeight` int NOT NULL DEFAULT '0',
  `refuteWeight` int NOT NULL DEFAULT '0',
  `productAreas` json DEFAULT NULL,
  `guidance` text COLLATE utf8mb4_unicode_ci,
  `actionStatus` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'OPEN',
  `actionNote` text COLLATE utf8mb4_unicode_ci,
  `firstSeenAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `lastEvidenceAt` datetime(3) DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `intel_claims_slug_key` (`slug`),
  KEY `intel_claims_status_confidence_idx` (`status`,`confidence`),
  KEY `intel_claims_actionStatus_idx` (`actionStatus`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `intel_evidence` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `claimId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `itemId` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `grade` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `stance` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `quote` text COLLATE utf8mb4_unicode_ci,
  `sampleSize` int DEFAULT NULL,
  `weight` int NOT NULL DEFAULT '0',
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `intel_evidence_claimId_itemId_key` (`claimId`,`itemId`),
  KEY `intel_evidence_claimId_weight_idx` (`claimId`,`weight`),
  KEY `intel_evidence_itemId_fkey` (`itemId`),
  CONSTRAINT `intel_evidence_claimId_fkey` FOREIGN KEY (`claimId`) REFERENCES `intel_claims` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `intel_evidence_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `intel_items` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `intel_digests` (
  `id` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `period` varchar(191) COLLATE utf8mb4_unicode_ci NOT NULL,
  `date` datetime(3) NOT NULL,
  `body` longtext COLLATE utf8mb4_unicode_ci NOT NULL,
  `stats` json DEFAULT NULL,
  `emailedAt` datetime(3) DEFAULT NULL,
  `createdAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `intel_digests_period_date_key` (`period`,`date`),
  KEY `intel_digests_date_idx` (`date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
