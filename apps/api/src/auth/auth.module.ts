import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import { JwtAuth } from './jwt-auth.provider.js';
import { DrizzleRefreshTokenStore } from './refresh-token.store.js';

@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [JwtAuth, DrizzleRefreshTokenStore],
})
export class AuthModule {}
