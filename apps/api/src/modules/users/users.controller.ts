import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query,
  HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { InviteUserDto } from './dto/invite-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AuthenticatedUser, PaginationQuery } from '@engineeringos/types';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'List all users in the company' })
  async findAll(@CurrentUser() user: AuthenticatedUser, @Query() query: PaginationQuery) {
    const result = await this.users.findAll(user.companyId, query);
    return { data: result.data, meta: { page: result.page, perPage: result.perPage, total: result.total, totalPages: result.totalPages }, error: null };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a specific user' })
  async findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return { data: await this.users.findOne(user.companyId, id), error: null };
  }

  @Post('invite')
  @Roles('company_admin', 'engineering_manager', 'project_manager')
  @ApiOperation({ summary: 'Invite a new user to the company' })
  async invite(@CurrentUser() user: AuthenticatedUser, @Body() dto: InviteUserDto) {
    return { data: await this.users.invite(user.companyId, user.id, dto), error: null };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a user profile or role' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return { data: await this.users.update(user.companyId, user.id, user.companyRole, id, dto), error: null };
  }

  @Delete(':id')
  @Roles('super_admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate a user (soft delete)' })
  async deactivate(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return { data: await this.users.deactivate(user.companyId, id), error: null };
  }

  // Deliberately tighter than invite()'s 3 roles: this hands back a live
  // credential (a link that lets anyone holding it set that user's
  // password), and RolesGuard only checks the CALLER's weight, never the
  // TARGET's -- gating this the same as invite() would let an
  // engineering_manager or project_manager reset a company_admin's own
  // password and take over their account. company_admin (RolesGuard's
  // minimum-weight check also lets super_admin through) matches how
  // deactivate() above is already gated tighter than invite() for the
  // same reason: account-security actions aren't invite-level.
  @Post(':id/admin-reset-password')
  @Roles('company_admin')
  @ApiOperation({ summary: "Generate a password reset link for a user, to deliver by hand (email fallback)" })
  async adminResetPassword(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return { data: await this.users.adminResetPassword(user.companyId, id), error: null };
  }
}