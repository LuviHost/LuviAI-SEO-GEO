import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { SessionOnly } from '../auth/session-only.decorator.js';
import { SiteAiKeysService } from './site-ai-keys.service.js';

/**
 * BYOK anahtarlarini yonetme uclari yalniz panel oturumuyla (@SessionOnly).
 *
 * NEDEN: /sites/:id/ai-keys yolu api-keys.service ROUTE_RESOURCE eslesmesinde
 * yok ('ai-keys' bilinmeyen alt kaynak); AuthGuard bu durumda HERHANGI bir
 * ':write' anahtarini (orn. yalniz 'social:write') yeterli sayiyordu. Sizmis
 * bir anahtarla musterinin saglayici anahtari degistirilebilir, silinebilir
 * ya da kayitli anahtarla tekrar tekrar test cagrisi attirilip musterinin
 * saglayici hesabina maliyet yazdirilabilirdi. Durum okumasi (GET) anahtarla
 * da acik; cevapta anahtarin yalniz ilk 8 karakteri var. SDK ve MCP bu
 * uclari cagirmiyor.
 */
@Controller('sites/:siteId/ai-keys')
export class SiteAiKeysController {
  constructor(private readonly svc: SiteAiKeysService) {}

  /** Plan + BYOK durumu — UI'da kart bilgileri */
  @Get()
  async status(@Param('siteId') siteId: string) {
    return this.svc.getStatus(siteId);
  }

  /** BYOK ekle/guncelle */
  @SessionOnly()
  @Post()
  async upsert(
    @Param('siteId') siteId: string,
    @Body() body: { provider: string; key: string },
  ) {
    return this.svc.upsertKey(siteId, body.provider, body.key);
  }

  /** Belirli provider'in BYOK key'ini sil */
  @SessionOnly()
  @Delete(':provider')
  async remove(@Param('siteId') siteId: string, @Param('provider') provider: string) {
    return this.svc.deleteKey(siteId, provider);
  }

  /** Kayitli BYOK'u tekrar test et */
  @SessionOnly()
  @Post(':provider/test')
  async retest(@Param('siteId') siteId: string, @Param('provider') provider: string) {
    return this.svc.retestKey(siteId, provider);
  }
}
