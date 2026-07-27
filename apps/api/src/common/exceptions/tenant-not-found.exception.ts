import { ForbiddenException } from '@nestjs/common';
export class TenantNotFoundException extends ForbiddenException {
  constructor() {
    super({ code: 'TENANT_NOT_FOUND', message: 'Company not found or access denied.' });
  }
}