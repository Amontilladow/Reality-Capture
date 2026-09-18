import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SchedulingService } from './scheduling.service';
import { SetShiftPreferenceDto } from './dto/set-shift-preference.dto';
import { AssignShiftDto } from './dto/assign-shift.dto';
import { RequestAbsenceDto } from './dto/request-absence.dto';
import { DecideAbsenceDto } from './dto/decide-absence.dto';
import { ActivitySummaryQueryDto } from '../activities/dto/activity-summary-query.dto';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequireFeature } from '../../../common/decorators/require-feature.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import type { AuthenticatedUser } from '@engineeringos/types';

@ApiTags('workforce')
@ApiBearerAuth()
@RequireFeature('workforce')
@Controller('workforce/scheduling')
export class SchedulingController {
  constructor(private readonly svc: SchedulingService) {}

  // ── Shift preferences ──

  @Post('shift-preferences')
  @ApiOperation({ summary: 'Set (or change) the current user\'s own shift preference for one day of the week' })
  async setMyShiftPreference(@CurrentUser() u: AuthenticatedUser, @Body() dto: SetShiftPreferenceDto) {
    return { data: await this.svc.setMyShiftPreference(u.companyId, u.id, dto), error: null };
  }

  @Get('shift-preferences/me')
  @ApiOperation({ summary: 'Get the current user\'s own shift preferences' })
  async getMyShiftPreferences(@CurrentUser() u: AuthenticatedUser) {
    return { data: await this.svc.getMyShiftPreferences(u.companyId, u.id), error: null };
  }

  @Get('shift-preferences')
  @Roles('company_admin')
  @ApiOperation({ summary: 'List every user\'s shift preferences company-wide (admin only, for building a schedule)' })
  async getCompanyShiftPreferences(@CurrentUser() u: AuthenticatedUser) {
    return { data: await this.svc.getCompanyShiftPreferences(u.companyId), error: null };
  }

  // ── Shift assignments ──

  @Post('shifts')
  @Roles('company_admin')
  @ApiOperation({ summary: 'Assign (or change) one user\'s shift for one calendar date (admin only)' })
  async assignShift(@CurrentUser() u: AuthenticatedUser, @Body() dto: AssignShiftDto) {
    return { data: await this.svc.assignShift(u.companyId, u.id, dto), error: null };
  }

  @Get('shifts/me')
  @ApiOperation({ summary: 'Get the current user\'s own assigned shifts for a date range' })
  async getMyShifts(@CurrentUser() u: AuthenticatedUser, @Query() query: ActivitySummaryQueryDto) {
    return { data: await this.svc.getShifts(u.companyId, u.id, query.from, query.to), error: null };
  }

  // Declared after 'me' so the literal route keeps matching
  // /workforce/scheduling/shifts/me -- same ordering reason as
  // ActivitiesController.
  @Get('shifts/:userId')
  @ApiOperation({ summary: 'Get another user\'s assigned shifts (manager/leadership visibility only)' })
  async getShiftsForUser(@CurrentUser() u: AuthenticatedUser, @Param('userId') userId: string, @Query() query: ActivitySummaryQueryDto) {
    return { data: await this.svc.getShifts(u.companyId, u.id, query.from, query.to, userId, u.companyRole), error: null };
  }

  @Get('shifts')
  @Roles('company_admin')
  @ApiOperation({ summary: 'Company-wide shift schedule for a date range (admin only)' })
  async getCompanyShifts(@CurrentUser() u: AuthenticatedUser, @Query() query: ActivitySummaryQueryDto) {
    return { data: await this.svc.getCompanyShifts(u.companyId, query.from, query.to), error: null };
  }

  // ── Absences ──

  @Post('absences')
  @ApiOperation({ summary: 'Request an absence (vacation/sick/personal/other) for the current user' })
  async requestAbsence(@CurrentUser() u: AuthenticatedUser, @Body() dto: RequestAbsenceDto) {
    return { data: await this.svc.requestAbsence(u.companyId, u.id, dto), error: null };
  }

  @Get('absences/me')
  @ApiOperation({ summary: 'Get the current user\'s own absence requests' })
  async getMyAbsences(@CurrentUser() u: AuthenticatedUser) {
    return { data: await this.svc.getAbsences(u.companyId, u.id), error: null };
  }

  @Get('absences/:userId')
  @ApiOperation({ summary: 'Get another user\'s absence requests (manager/leadership visibility only)' })
  async getAbsencesForUser(@CurrentUser() u: AuthenticatedUser, @Param('userId') userId: string) {
    return { data: await this.svc.getAbsences(u.companyId, u.id, userId, u.companyRole), error: null };
  }

  @Get('absences')
  @Roles('company_admin')
  @ApiOperation({ summary: 'Company-wide absence requests, pending only by default (admin only)' })
  async getCompanyAbsences(@CurrentUser() u: AuthenticatedUser, @Query('includeDecided') includeDecided?: string) {
    return { data: await this.svc.getCompanyAbsences(u.companyId, includeDecided === 'true'), error: null };
  }

  @Patch('absences/:absenceId/decide')
  @Roles('company_admin')
  @ApiOperation({ summary: 'Approve or deny a pending absence request (admin only)' })
  async decideAbsence(@CurrentUser() u: AuthenticatedUser, @Param('absenceId') absenceId: string, @Body() dto: DecideAbsenceDto) {
    return { data: await this.svc.decideAbsence(u.companyId, u.id, absenceId, dto.status), error: null };
  }
}
