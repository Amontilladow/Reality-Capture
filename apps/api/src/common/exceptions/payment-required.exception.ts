import { HttpException, HttpStatus } from '@nestjs/common';
export class PaymentRequiredException extends HttpException {
  constructor(feature: string, message?: string) {
    super(
      {
        code: 'SUBSCRIPTION_LIMIT_EXCEEDED',
        message: message ?? `Your current plan does not include '${feature}'. Upgrade to continue.`,
        feature,
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}