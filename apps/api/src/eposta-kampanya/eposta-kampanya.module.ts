import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { LLMModule } from '../llm/llm.module.js';
import { EpostaKampanyaController } from './eposta-kampanya.controller.js';
import { EpostaKampanyaService } from './eposta-kampanya.service.js';
import { KisiselHazirlikService } from './kisisel-hazirlik.service.js';

/**
 * Kurumsal e-posta kampanyasi. Prisma global; worker servisi AppModule baglamindan alir.
 * Kisisel mail hazirligi AI olcumu (AuditModule → AiCitationService) ve LLM (faaliyet + soru) kullanir.
 */
@Module({
  imports: [AuditModule, LLMModule],
  controllers: [EpostaKampanyaController],
  providers: [EpostaKampanyaService, KisiselHazirlikService],
  exports: [EpostaKampanyaService],
})
export class EpostaKampanyaModule {}
