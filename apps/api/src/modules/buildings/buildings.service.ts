import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class BuildingsService {
  constructor(private readonly db: DatabaseService) {}

  async createBuilding(companyId: string, projectId: string, userId: string, dto: { name: string; code?: string; description?: string; totalLevels?: number }) {
    const [b] = await this.db.query`
      INSERT INTO buildings (company_id, project_id, name, code, description, total_levels)
      VALUES (${companyId}, ${projectId}, ${dto.name}, ${dto.code ?? null}, ${dto.description ?? null}, ${dto.totalLevels ?? null})
      RETURNING *`;
    return b;
  }

  async updateBuilding(companyId: string, buildingId: string, dto: Partial<{ name: string; code: string; description: string; totalLevels: number; phase: string }>) {
    const [b] = await this.db.query`
      UPDATE buildings SET
        name = COALESCE(${dto.name ?? null}, name),
        code = COALESCE(${dto.code ?? null}, code),
        description = COALESCE(${dto.description ?? null}, description),
        total_levels = COALESCE(${dto.totalLevels ?? null}, total_levels),
        phase = COALESCE(${dto.phase ?? null}, phase),
        updated_at = NOW()
      WHERE id = ${buildingId} AND company_id = ${companyId}
      RETURNING *`;
    if (!b) throw new NotFoundException('Building not found.');
    return b;
  }

  async createLevel(companyId: string, buildingId: string, dto: { name: string; elevationM?: number; levelOrder: number }) {
    const [l] = await this.db.query`
      INSERT INTO levels (company_id, building_id, name, elevation_m, level_order)
      VALUES (${companyId}, ${buildingId}, ${dto.name}, ${dto.elevationM ?? null}, ${dto.levelOrder})
      RETURNING *`;
    return l;
  }

  async getLevels(companyId: string, buildingId: string) {
    return this.db.withTenant(companyId, sql => sql`
      SELECT * FROM levels WHERE building_id = ${buildingId} ORDER BY level_order`);
  }

  async createLocation(companyId: string, levelId: string, dto: { name: string; description?: string; coordinatesOnPlan?: { x: number; y: number } }) {
    const coords = dto.coordinatesOnPlan ? `(${dto.coordinatesOnPlan.x},${dto.coordinatesOnPlan.y})` : null;
    const [loc] = await this.db.query`
      INSERT INTO locations (company_id, level_id, name, description, coordinates_on_plan)
      VALUES (${companyId}, ${levelId}, ${dto.name}, ${dto.description ?? null}, ${coords}::point)
      RETURNING *`;
    return loc;
  }

  async getLocations(companyId: string, levelId: string) {
    return this.db.withTenant(companyId, sql => sql`
      SELECT l.*,
        COUNT(DISTINCT c.id) AS capture_count,
        COUNT(DISTINCT i.id) FILTER (WHERE i.status NOT IN ('closed','void')) AS open_issue_count
      FROM locations l
      LEFT JOIN captures c ON c.location_id = l.id
      LEFT JOIN issues i ON i.location_id = l.id
      WHERE l.level_id = ${levelId} AND l.archived_at IS NULL
      GROUP BY l.id
      ORDER BY l.name`);
  }

  // Rename / re-describe / reposition a location -- covers both
  // building-hierarchy locations and floor-plan pins (a pin is a location
  // with no level). posXNorm/posYNorm let a pin be moved to a new spot.
  async updateLocation(
    companyId: string,
    locationId: string,
    dto: { name?: string; description?: string; posXNorm?: number; posYNorm?: number; elementId?: string | null },
  ) {
    // elementId is distinguished from "not provided" so a pin can be
    // explicitly unlinked from its BIM element (elementId: null), not just
    // linked -- the other fields here can only ever be set, never cleared.
    const elementIdProvided = Object.prototype.hasOwnProperty.call(dto, 'elementId');
    const [loc] = await this.db.query`
      UPDATE locations SET
        name        = COALESCE(${dto.name ?? null}, name),
        description = COALESCE(${dto.description ?? null}, description),
        pos_x_norm  = COALESCE(${dto.posXNorm ?? null}, pos_x_norm),
        pos_y_norm  = COALESCE(${dto.posYNorm ?? null}, pos_y_norm),
        element_id  = CASE WHEN ${elementIdProvided} THEN ${dto.elementId ?? null} ELSE element_id END
      WHERE id = ${locationId} AND company_id = ${companyId} AND archived_at IS NULL
      RETURNING *`;
    if (!loc) throw new NotFoundException('Location not found.');
    return loc;
  }

  // Soft-delete: hides a pin from normal views without destroying it or
  // anything attached to it (photos, videos, notes all survive). Site
  // photos are often one-of-a-kind -- a real delete is never worth the risk.
  async archiveLocation(companyId: string, locationId: string) {
    const [loc] = await this.db.query`
      UPDATE locations SET archived_at = NOW()
      WHERE id = ${locationId} AND company_id = ${companyId} AND archived_at IS NULL
      RETURNING *`;
    if (!loc) throw new NotFoundException('Location not found.');
    return loc;
  }
}