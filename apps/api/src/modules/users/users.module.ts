import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { SubscriptionModule } from '../subscription/subscription.module';
import { AuthModule } from '../auth/auth.module';

// AuthModule imported for AuthService.generatePasswordResetToken()/
// buildPasswordResetLink() -- the admin-assisted reset
// (UsersService.adminResetPassword) reuses forgotPassword()'s exact token
// scheme rather than duplicating it. No cycle: AuthModule itself doesn't
// import UsersModule.
@Module({
  imports: [SubscriptionModule, AuthModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}