import { Module } from '@nestjs/common';
import { EpostaKampanyaController } from './eposta-kampanya.controller.js';
import { EpostaKampanyaService } from './eposta-kampanya.service.js';

/** Kurumsal e-posta kampanyasi (Mailjet). Prisma global; worker servisi AppModule baglamindan alir. */
@Module({
  controllers: [EpostaKampanyaController],
  providers: [EpostaKampanyaService],
  exports: [EpostaKampanyaService],
})
export class EpostaKampanyaModule {}
