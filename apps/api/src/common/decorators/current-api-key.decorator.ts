import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface ApiKeyContext {
  apiKeyId: string;
  companyId: string;
  scopes: string[];
}

// Parallel to current-user.decorator.ts's @CurrentUser(), but for the
// Public API's API-key-authenticated requests -- ApiKeyAuthGuard populates
// request.apiKeyContext the same way JwtStrategy.validate() populates
// request.user, since an API-key request never carries an AuthenticatedUser.
export const CurrentApiKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ApiKeyContext => {
    const request = ctx.switchToHttp().getRequest();
    return request.apiKeyContext as ApiKeyContext;
  },
);
