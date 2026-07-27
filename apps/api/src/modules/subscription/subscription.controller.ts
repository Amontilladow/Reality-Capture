import { Controller, Get, Post, Body, Req, Headers, RawBodyRequest } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import type { Request } from 'express';
import { SubscriptionService } from './subscription.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { AuthenticatedUser } from '@engineeringos/types';

@ApiTags('subscription')
@Controller('subscription')
export class SubscriptionController {
  constructor(private readonly sub: SubscriptionService) {}

  @Get('plans')
  @Public()
  @ApiOperation({ summary: 'List all public subscription plans' })
  async getPlans() {
    return { data: await this.sub.getPlans(), error: null };
  }

  @Get()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current subscription and usage' })
  async getSubscription(@CurrentUser() u: AuthenticatedUser) {
    return { data: await this.sub.getSubscription(u.companyId), error: null };
  }

  @Post('checkout')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a Stripe checkout session for plan upgrade' })
  async checkout(@CurrentUser() u: AuthenticatedUser, @Body() dto: { tier: string; returnUrl: string }) {
    return { data: await this.sub.createCheckoutSession(u.companyId, dto.tier, dto.returnUrl), error: null };
  }

  @Post('webhooks/stripe')
  @Public()
  @ApiOperation({ summary: 'Stripe webhook receiver' })
  async stripeWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') sig: string,
  ) {
    await this.sub.handleStripeWebhook(req.rawBody ?? Buffer.alloc(0), sig);
    return { received: true };
  }
}