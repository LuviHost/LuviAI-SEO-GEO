import { Module, type OnModuleInit } from '@nestjs/common';
import { PublishTargetsController } from './publish-targets.controller.js';
import { PublishTargetsService } from './publish-targets.service.js';
import { registerAdapterEgressGuard } from './adapter-egress.js';

@Module({
  controllers: [PublishTargetsController],
  providers: [PublishTargetsService],
  exports: [PublishTargetsService],
})
export class PublishTargetsModule implements OnModuleInit {
  /**
   * Adaptorlerin korumali ag erisimini kaydeder (adapter-egress.ts).
   *
   * NEDEN burada: API (main.ts) ve worker (createApplicationContext) ayni
   * AppModule'u kurar; ikisinde de onModuleInit istek/is almadan once calisir.
   * Yayin cagiran servislerin (publisher, snippet, statik HTML, kok dosya,
   * takili sayfa, alt metni) hicbiri degismeden korunur.
   */
  onModuleInit(): void {
    registerAdapterEgressGuard();
  }
}
