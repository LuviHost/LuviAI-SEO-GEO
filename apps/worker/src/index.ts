import 'dotenv/config';
import { Worker } from 'bullmq';
import IORedis from 'ioredis';

const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

// 7 job tipi — her biri ayrı handler
import { handleSiteAudit } from './jobs/site-audit.js';
import { handleAutoFix } from './jobs/auto-fix.js';
import { handleBrainGenerate } from './jobs/brain-generate.js';
import { handleTopicEngine } from './jobs/topic-engine.js';
import { handleGenerateArticle } from './jobs/generate-article.js';
import { handlePublishArticle } from './jobs/publish-article.js';
import { handleImprovePage } from './jobs/improve-page.js';

const handlers: Record<string, (data: any) => Promise<any>> = {
  SITE_AUDIT: handleSiteAudit,
  AUTO_FIX: handleAutoFix,
  BRAIN_GENERATE: handleBrainGenerate,
  TOPIC_ENGINE: handleTopicEngine,
  GENERATE_ARTICLE: handleGenerateArticle,
  PUBLISH_ARTICLE: handlePublishArticle,
  IMPROVE_PAGE: handleImprovePage,
};

const worker = new Worker(
  'luviai-jobs',
  async (job) => {
    const handler = handlers[job.name];
    if (!handler) throw new Error(`Bilinmeyen job tipi: ${job.name}`);
    return handler(job.data);
  },
  {
    connection,
    concurrency: 4,
  },
);

worker.on('completed', (job) => console.log(`✅ ${job.name} (${job.id})`));
worker.on('failed', (job, err) => console.error(`❌ ${job?.name} (${job?.id}):`, err.message));

console.log('🔧 LuviAI Worker başlatıldı (concurrency=4, 7 job tipi)');
