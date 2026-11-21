import { Module } from '@nestjs/common';
import {
  StoreWebhooksController,
  SubscriptionsController,
} from './subscriptions.controller.js';
import { SubscriptionsService } from './subscriptions.service.js';

@Module({
  controllers: [SubscriptionsController, StoreWebhooksController],
  providers: [SubscriptionsService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
