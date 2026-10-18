import { Module } from '@nestjs/common';
import { MeController } from './me.controller.js';
import { AdminModule } from '../admin/admin.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AccountDeletionService } from './account-deletion.service.js';
import { AccountPurgeService } from './account-purge.service.js';
import { AccountPurgeCron } from './account-purge.cron.js';
import { KvSweepCron } from '../common/kv-sweep.cron.js';

// PaytrService (BillingModule), EmailService (EmailModule) ve ApiKeysService
// (ApiKeysModule) global; AppleSiwaService AuthModule'den gelir.
// KvSweepCron burada: veri saklama isleri (kalici hesap silme + kv_store'da
// suresi dolan kayitlarin silinmesi) tek modulde dursun; ortak bir cron modulu yok.
@Module({
  imports: [AdminModule, AuthModule],
  controllers: [MeController],
  providers: [AccountDeletionService, AccountPurgeService, AccountPurgeCron, KvSweepCron],
})
export class MeModule {}
