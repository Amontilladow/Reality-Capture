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

  async updateBuilding(companyId: string, buildingId: string, dto: Partial<{ name: string; code: string; description: string; totalLevels: number }>) {
    const [b] = await this.db.query`
      UPDATE buildings SET
        name = COALESCE(${dto.name ?? null}, name),
        code = COALESCE(${dto.code ?? null}, code),
        description = COALESCE(${dto.description ?? null}, description),
        total_levels = COALESCE(${dto.totalLevels ?? null}, total_levels),
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
      WHERE l.level_id = ${levelId}
      GROUP BY l.id
      ORDER BY l.name`);
  }
}