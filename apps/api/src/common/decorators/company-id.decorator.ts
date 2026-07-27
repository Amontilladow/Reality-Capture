import { createParamDecorator, ExecutionContext } from '@nestjs/common';
export const CompanyId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string =>
    ctx.switchToHttp().getRequest().user?.companyId as string,
);