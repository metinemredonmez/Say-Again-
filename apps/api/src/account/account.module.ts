import { Module } from '@nestjs/common';
import { QuotaModule } from '../quota/quota.module.js';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module.js';
import { UsersModule } from '../users/users.module.js';
import { MeController } from './me.controller.js';

@Module({
  imports: [UsersModule, QuotaModule, SubscriptionsModule],
  controllers: [MeController],
})
export class AccountModule {}
