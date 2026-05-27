// Nest application context'ten AnalyticsService.captureSnapshot tetikle
(async () => {
  try {
    process.chdir('/var/www/luviai/apps/api');
    const { NestFactory } = require('@nestjs/core');
    const appMod = await import('file:///var/www/luviai/apps/api/dist/app.module.js');
    console.log('Loading Nest app...');
    const app = await NestFactory.createApplicationContext(appMod.AppModule, { logger: ['error', 'warn', 'log'] });
    const svcMod = await import('file:///var/www/luviai/apps/api/dist/analytics/analytics.service.js');
    const svc = app.get(svcMod.AnalyticsService);
    console.log('Triggering captureSnapshot for cmp6036790001artdfumwec57...');
    const result = await svc.captureSnapshot('cmp6036790001artdfumwec57', undefined, { silent: false });
    console.log('Result:', JSON.stringify(result, null, 2));
    await app.close();
  } catch (err) {
    console.error('ERROR:', err.message);
    console.error(err.stack);
  }
})();
