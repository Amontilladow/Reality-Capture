import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../../database/database.service';
import type { CompanyRole } from '@engineeringos/types';
import { isAtLeast } from '../workforce-role.util';
import type { EnrollDeviceDto } from './dto/enroll-device.dto';
import type { HeartbeatDeviceDto } from './dto/heartbeat-device.dto';

@Injectable()
export class DevicesService {
  constructor(private readonly db: DatabaseService) {}

  async enroll(companyId: string, userId: string, dto: EnrollDeviceDto) {
    const [device] = await this.db.withTenant(companyId, sql => sql`
      INSERT INTO devices (company_id, user_id, platform, hostname, device_fingerprint, agent_version, last_seen_at)
      VALUES (${companyId}, ${userId}, ${dto.platform}, ${dto.hostname ?? null}, ${dto.deviceFingerprint ?? null}, ${dto.agentVersion ?? null}, NOW())
      RETURNING *`);
    return device;
  }

  // Own devices for a regular user; every company device once the caller's
  // role weight reaches company_admin (view_own vs. manage_devices, see
  // docs/workforce-intelligence-architecture.md).
  async list(companyId: string, userId: string, companyRole: CompanyRole) {
    if (isAtLeast(companyRole, 'company_admin')) {
      return this.db.withTenant(companyId, sql => sql`
        SELECT * FROM devices ORDER BY last_seen_at DESC NULLS LAST`);
    }
    return this.db.withTenant(companyId, sql => sql`
      SELECT * FROM devices WHERE user_id = ${userId} ORDER BY last_seen_at DESC NULLS LAST`);
  }

  async heartbeat(companyId: string, userId: string, companyRole: CompanyRole, deviceId: string, dto: HeartbeatDeviceDto) {
    const device = await this.assertAccess(companyId, userId, companyRole, deviceId);
    const [updated] = await this.db.withTenant(companyId, sql => sql`
      UPDATE devices SET last_seen_at = NOW(), agent_version = COALESCE(${dto.agentVersion ?? null}, agent_version)
      WHERE id = ${device.id} RETURNING *`);
    return updated;
  }

  async revoke(companyId: string, userId: string, companyRole: CompanyRole, deviceId: string) {
    const device = await this.assertAccess(companyId, userId, companyRole, deviceId);
    const [revoked] = await this.db.withTenant(companyId, sql => sql`
      UPDATE devices SET is_active = false, revoked_at = NOW(), revoked_by = ${userId}
      WHERE id = ${device.id} RETURNING *`);
    return revoked;
  }

  private async assertAccess(companyId: string, userId: string, companyRole: CompanyRole, deviceId: string) {
    const [device] = await this.db.withTenant(companyId, sql => sql`
      SELECT * FROM devices WHERE id = ${deviceId}`);
    if (!device) throw new NotFoundException({ code: 'DEVICE_NOT_FOUND', message: 'Device not found.' });
    if (device.userId !== userId && !isAtLeast(companyRole, 'company_admin')) {
      throw new ForbiddenException({ code: 'NOT_DEVICE_OWNER', message: 'You do not own this device.' });
    }
    return device;
  }
}
