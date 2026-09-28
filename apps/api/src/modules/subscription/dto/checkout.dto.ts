import { IsString, IsNotEmpty, IsUrl } from 'class-validator';

export class CheckoutDto {
  // Not restricted to a hardcoded tier list here -- createCheckoutSession()
  // already looks the tier up against the live subscription_plans table and
  // throws NotFoundException for anything that doesn't exist, which stays
  // correct even if plans are added/removed later.
  @IsString() @IsNotEmpty()
  tier: string;

  @IsUrl({ require_tld: false })
  returnUrl: string;
}
