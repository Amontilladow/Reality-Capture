import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../../database/database.service';
import type { CompanyRole } from '@engineeringos/types';
import { resolveVisibleTargetUserId } from '../workforce-visibility.util';
import type { SetShiftPreferenceDto } from './dto/set-shift-preference.dto';
import type { AssignShiftDto } from './dto/assign-shift.dto';
import type { RequestAbsenceDto } from './dto/request-absence.dto';

const DEFAULT_SCHEDULE_LOOKAHEAD_DAYS = 14;

// Shifts are forward-looking ("what's coming up"), unlike activity/
// productivity's trailing-7-days default -- defaults to today through two
// weeks out when no explicit range is given.
function resolveScheduleRange(from?: string, to?: string): { from: string; to: string } {
  const rangeStart = from ? new Date(from) : new Date();
  const rangeEnd = to ? new Date(to) : new Date(rangeStart.getTime() + DEFAULT_SCHEDULE_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000);
  return { from: rangeStart.toISOString().slice(0, 10), to: rangeEnd.toISOString().slice(0, 10) };
}

@Injectable()
export class SchedulingService {
  constructor(private readonly db: DatabaseService) {}

  // ── Shift preferences (self-service upsert; one row per day-of-week) ──

  async setMyShiftPreference(companyId: string, userId: string, dto: SetShiftPreferenceDto) {
    return this.db.withTenant(companyId, async (sql) => {
      const [row] = await sql`
        INSERT INTO workforce_shift_preferences (company_id, user_id, day_of_week, preferred, start_time, end_time)
        VALUES (${companyId}, ${userId}, ${dto.dayOfWeek}, ${dto.preferred ?? true}, ${dto.startTime ?? null}, ${dto.endTime ?? null})
        ON CONFLICT (user_id, day_of_week) DO UPDATE SET
          preferred = EXCLUDED.preferred,
          start_time = EXCLUDED.start_time,
          end_time = EXCLUDED.end_time,
          updated_at = NOW()
        RETURNING *`;
      return row;
    });
  }

  async getMyShiftPreferences(companyId: string, userId: string) {
    return this.db.withTenant(companyId, sql => sql`
      SELECT * FROM workforce_shift_preferences WHERE user_id = ${userId} ORDER BY day_of_week`);
  }

  // Company-wide, for whoever is building the schedule -- admin only (see
  // @Roles on the controller route), same "sees everyone, not gated by
  // reporting chain" precedent as ReportingLinesController/ApplicationsController.
  async getCompanyShiftPreferences(companyId: string) {
    return this.db.withTenant(companyId, sql => sql`
      SELECT wsp.*, u.first_name, u.last_name
      FROM workforce_shift_preferences wsp
      JOIN users u ON u.id = wsp.user_id
      ORDER BY u.first_name, u.last_name, wsp.day_of_week`);
  }

  // ── Shift assignments (admin-managed; one row per user per calendar date) ──

  async assignShift(companyId: string, assignerId: string, dto: AssignShiftDto) {
    if (dto.endTime <= dto.startTime) {
      throw new BadRequestException({ code: 'INVALID_SHIFT_TIMES', message: 'endTime must be after startTime.' });
    }
    return this.db.withTenant(companyId, async (sql) => {
      const [user] = await sql`SELECT id FROM users WHERE id = ${dto.userId}`;
      if (!user) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found.' });

      const [row] = await sql`
        INSERT INTO workforce_shift_assignments (company_id, user_id, shift_date, start_time, end_time, assigned_by)
        VALUES (${companyId}, ${dto.userId}, ${dto.shiftDate}, ${dto.startTime}, ${dto.endTime}, ${assignerId})
        ON CONFLICT (user_id, shift_date) DO UPDATE SET
          start_time = EXCLUDED.start_time,
          end_time = EXCLUDED.end_time,
          assigned_by = EXCLUDED.assigned_by,
          updated_at = NOW()
        RETURNING *`;
      return row;
    });
  }

  // Same targetUserId/callerCompanyRole convention as
  // ActivitiesService.getMySummary -- self by default, a visibility-checked
  // other user via the reporting-chain/leadership rule otherwise.
  async getShifts(
    companyId: string,
    callerId: string,
    fromInput?: string,
    toInput?: string,
    targetUserId?: string,
    callerCompanyRole?: CompanyRole,
  ) {
    const userId = await resolveVisibleTargetUserId(this.db, companyId, callerId, callerCompanyRole, targetUserId);
    const { from, to } = resolveScheduleRange(fromInput, toInput);
    return this.db.withTenant(companyId, sql => sql`
      SELECT * FROM workforce_shift_assignments
      WHERE user_id = ${userId} AND shift_date >= ${from} AND shift_date <= ${to}
      ORDER BY shift_date`);
  }

  async getCompanyShifts(companyId: string, fromInput?: string, toInput?: string) {
    const { from, to } = resolveScheduleRange(fromInput, toInput);
    return this.db.withTenant(companyId, sql => sql`
      SELECT wsa.*, u.first_name, u.last_name
      FROM workforce_shift_assignments wsa
      JOIN users u ON u.id = wsa.user_id
      WHERE wsa.shift_date >= ${from} AND wsa.shift_date <= ${to}
      ORDER BY wsa.shift_date, u.first_name, u.last_name`);
  }

  // ── Absences (self-requested, admin-decided) ──

  async requestAbsence(companyId: string, userId: string, dto: RequestAbsenceDto) {
    if (dto.endDate < dto.startDate) {
      throw new BadRequestException({ code: 'INVALID_ABSENCE_RANGE', message: 'endDate must be on or after startDate.' });
    }
    return this.db.withTenant(companyId, async (sql) => {
      const [row] = await sql`
        INSERT INTO workforce_absences (company_id, user_id, absence_type, start_date, end_date, reason)
        VALUES (${companyId}, ${userId}, ${dto.absenceType}, ${dto.startDate}, ${dto.endDate}, ${dto.reason ?? null})
        RETURNING *`;
      return row;
    });
  }

  async getAbsences(
    companyId: string,
    callerId: string,
    targetUserId?: string,
    callerCompanyRole?: CompanyRole,
  ) {
    const userId = await resolveVisibleTargetUserId(this.db, companyId, callerId, callerCompanyRole, targetUserId);
    return this.db.withTenant(companyId, sql => sql`
      SELECT * FROM workforce_absences WHERE user_id = ${userId} ORDER BY start_date DESC`);
  }

  // Company-wide "who's out when" -- admin only. Defaults to pending
  // requests (the actionable queue) unless includeDecided is set, so the
  // admin screen doesn't have to wade through a growing history of already-
  // decided requests just to find the ones awaiting a decision.
  async getCompanyAbsences(companyId: string, includeDecided: boolean) {
    return this.db.withTenant(companyId, async (sql) => {
      if (includeDecided) {
        return sql`
          SELECT wa.*, u.first_name, u.last_name
          FROM workforce_absences wa
          JOIN users u ON u.id = wa.user_id
          ORDER BY wa.start_date DESC`;
      }
      return sql`
        SELECT wa.*, u.first_name, u.last_name
        FROM workforce_absences wa
        JOIN users u ON u.id = wa.user_id
        WHERE wa.status = 'pending'
        ORDER BY wa.start_date`;
    });
  }

  async decideAbsence(companyId: string, deciderId: string, absenceId: string, status: 'approved' | 'denied') {
    return this.db.withTenant(companyId, async (sql) => {
      const [existing] = await sql`SELECT id, status FROM workforce_absences WHERE id = ${absenceId}`;
      if (!existing) throw new NotFoundException({ code: 'ABSENCE_NOT_FOUND', message: 'Absence request not found.' });
      if (existing.status !== 'pending') {
        throw new ForbiddenException({ code: 'ABSENCE_ALREADY_DECIDED', message: 'This request has already been decided.' });
      }

      const [row] = await sql`
        UPDATE workforce_absences
        SET status = ${status}, decided_by = ${deciderId}, decided_at = NOW(), updated_at = NOW()
        WHERE id = ${absenceId}
        RETURNING *`;
      return row;
    });
  }
}
