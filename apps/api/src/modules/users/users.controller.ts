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
  @Roles('company_admin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate a user (soft delete)' })
  async deactivate(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return { data: await this.users.deactivate(user.companyId, id), error: null };
  }
}