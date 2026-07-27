import { SetMetadata } from '@nestjs/common';
export const FEATURE_KEY = 'requiredFeature';
/** Require a subscription feature flag. Returns 402 if the company plan lacks it. */
export const RequireFeature = (flag: string) => SetMetadata(FEATURE_KEY, flag);