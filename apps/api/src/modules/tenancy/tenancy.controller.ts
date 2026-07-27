import { Controller, Get, Post, Delete, Patch, Body, ConflictException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { TenancyService } from './tenancy.service';
import { RegisterCompanyDto } from './dto/register-company.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { DatabaseService } from '../../database/database.service';
import type { AuthenticatedUser } from '@engineeringos/types';

@ApiTags('company')
@Controller('company')
export class TenancyController {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly db: DatabaseService,
  ) {}

  // TEMPORARY — deployment verification cleanup, removed in the very next commit.
  @Public()
  @Delete('_cleanup-deploy-test')
  async cleanupDeployTest() {
    const result = await this.db.query`DELETE FROM companies WHERE slug = 'deploy-test-co' RETURNING id`;
    return { data: { deletedCount: result.length }, error: null };
  }

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
  @Roles('company_admin')
  @ApiOperation({ summary: 'Update company settings' })
  async updateSettings(@CurrentUser() u: AuthenticatedUser, @Body() settings: Record<string, unknown>) {
    return { data: await this.tenancy.updateSettings(u.companyId, settings), error: null };
  }
}
