import { Controller, Get, Post, Patch, Body, ConflictException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { TenancyService } from './tenancy.service';
import { RegisterCompanyDto } from './dto/register-company.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '@engineeringos/types';

@ApiTags('company')
@Controller('company')
export class TenancyController {
  constructor(private readonly tenancy: TenancyService) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Register a new company — creates company_admin user and starts 30-day trial' })
  async register(@Body() dto: RegisterCompanyDto) {
    // Check slug uniqueness before attempting insert
    const existing = await this.tenancy.findBySlug(dto.slug);
    if (existing) throw new ConflictException(`The slug "${dto.slug}" is already taken.`);

    const result = await this.tenancy.register({
      companyName: dto.companyName,
      slug: dto.slug,
      adminEmail: dto.adminEmail,
      adminFirstName: dto.adminFirstName,
      adminLastName: dto.adminLastName,
      adminPassword: dto.adminPassword,
    });

    return { data: { company: result.company, user: result.user }, error: null };
  }

  @Get()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current company details and subscription' })
  async getCompany(@CurrentUser() u: AuthenticatedUser) {
    return { data: await this.tenancy.findById(u.companyId), error: null };
  }

  @Patch('settings')
  @ApiBearerAuth()
  @Roles('super_admin')
  @ApiOperation({ summary: 'Update company settings' })
  async updateSettings(@CurrentUser() u: AuthenticatedUser, @Body() settings: Record<string, unknown>) {
    return { data: await this.tenancy.updateSettings(u.companyId, settings), error: null };
  }

  // ── Self-signup code ──────────────────────────────────────────────────────
  // Both gated to super_admin, same as updateSettings() above -- whoever
  // holds this code can create an account under this company, so viewing
  // and regenerating it get the same sensitivity level as any other
  // company-wide security setting.
  @Get('signup-code')
  @ApiBearerAuth()
  @Roles('super_admin')
  @ApiOperation({ summary: "Get this company's current self-signup code, if one has been generated" })
  async getSignupCode(@CurrentUser() u: AuthenticatedUser) {
    return { data: await this.tenancy.getSignupCode(u.companyId), error: null };
  }

  @Post('signup-code/regenerate')
  @ApiBearerAuth()
  @Roles('super_admin')
  @ApiOperation({ summary: 'Generate a new self-signup code, invalidating the previous one immediately' })
  async regenerateSignupCode(@CurrentUser() u: AuthenticatedUser) {
    return { data: await this.tenancy.regenerateSignupCode(u.companyId), error: null };
  }
}
