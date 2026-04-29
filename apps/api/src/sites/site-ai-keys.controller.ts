import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { SiteAiKeysService } from './site-ai-keys.service.js';

@Controller('sites/:siteId/ai-keys')
export class SiteAiKeysController {
  constructor(private readonly svc: SiteAiKeysService) {}

  /** Plan + BYOK durumu — UI'da kart bilgileri */
  @Get()
  async status(@Param('siteId') siteId: string) {
    return this.svc.getStatus(siteId);
  }

  /** BYOK ekle/guncelle */
  @Post()
  async upsert(
    @Param('siteId') siteId: string,
    @Body() body: { provider: string; key: string },
  ) {
    return this.svc.upsertKey(siteId, body.provider, body.key);
  }

  /** Belirli provider'in BYOK key'ini sil */
  @Delete(':provider')
  async remove(@Param('siteId') siteId: string, @Param('provider') provider: string) {
    return this.svc.deleteKey(siteId, provider);
  }

  /** Kayitli BYOK'u tekrar test et */
  @Post(':provider/test')
  async retest(@Param('siteId') siteId: string, @Param('provider') provider: string) {
    return this.svc.retestKey(siteId, provider);
  }
}
