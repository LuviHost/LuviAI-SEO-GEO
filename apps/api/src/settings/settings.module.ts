import { Global, Module } from '@nestjs/common';
import { SettingsController } from './settings.controller.js';
import { SettingsService } from './settings.service.js';

/**
 * SettingsModule — runtime degistirilebilen operasyonel/plan/model ayarlari.
 * Global cunku api icindeki her servis (ve worker) settings.get(...) cagirabilsin.
 */
@Global()
@Module({
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
