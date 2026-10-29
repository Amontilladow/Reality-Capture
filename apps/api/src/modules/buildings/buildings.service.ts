import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { IssuesService } from '../issues/issues.service';
import { SnaggingService } from '../snagging/snagging.service';

@Injectable()
export class BuildingsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly issues: IssuesService,
    private readonly snagging: SnaggingService,
  ) {}

  async createBuilding(companyId: string, projectId: string, userId: string, dto: { name: string; code?: string; description?: string; totalLevels?: number }) {
    // withTenant required -- buildings carries the tenant_isolation RLS policy;
    // a plain this.db.query() never sets app.current_company_id.
    const [b] = await this.db.withTenant(companyId, sql => sql`
      INSERT INTO buildings (company_id, project_id, name, code, description, total_levels)
      VALUES (${companyId}, ${projectId}, ${dto.name}, ${dto.code ?? null}, ${dto.description ?? null}, ${dto.totalLevels ?? null})
      RETURNING *`);
    return b;
  }

  async updateBuilding(companyId: string, projectId: string, buildingId: string, dto: Partial<{ name: string; code: string; description: string; totalLevels: number; phase: string }>) {
    // H-1 fix (KNOWN_ISSUES_AND_REMEDIATION.md): this previously scoped only
    // by company_id -- a user authorized for a different project in the
    // same company (RequireProjectPermission only checks the URL's
    // :projectId, never that buildingId actually belongs to it) could
    // rename/re-phase any building by guessing its UUID. buildings has its
    // own project_id column, so this is a direct WHERE addition.
    //
    // withTenant required -- buildings carries the tenant_isolation RLS policy;
    // a plain this.db.query() never sets app.current_company_id.
    const [b] = await this.db.withTenant(companyId, sql => sql`
      UPDATE buildings SET
        name = COALESCE(${dto.name ?? null}, name),
        code = COALESCE(${dto.code ?? null}, code),
        description = COALESCE(${dto.description ?? null}, description),
        total_levels = COALESCE(${dto.totalLevels ?? null}, total_levels),
        phase = COALESCE(${dto.phase ?? null}, phase),
        updated_at = NOW()
      WHERE id = ${buildingId} AND project_id = ${projectId} AND company_id = ${companyId}
      RETURNING *`);
    if (!b) throw new NotFoundException('Building not found.');
    return b;
  }

  // H-1 fix: buildings is the only table in this hierarchy that carries
  // project_id directly -- levels only has building_id, and locations only
  // has level_id (building-hierarchy pins) OR drawing_id (floor-plan pins,
  // see migration 005's comment), neither of which carries project_id
  // either. These three shared helpers resolve "does this
  // building/level/location actually belong to this project" by joining
  // up to buildings.project_id (or, for a location, also trying
  // drawings.project_id via its drawing_id path), throwing NotFoundException
  // on a mismatch exactly like issues.service.ts's findOne() does for
  // issues. Every mutating/reading method below that takes a
  // building/level/location id now goes through one of these first.
  private async assertBuildingInProject(companyId: string, projectId: string, buildingId: string): Promise<void> {
    const [row] = await this.db.withTenant(companyId, sql => sql`
      SELECT id FROM buildings WHERE id = ${buildingId} AND project_id = ${projectId} AND company_id = ${companyId}`);
    if (!row) throw new NotFoundException('Building not found.');
  }

  private async assertLevelInProject(companyId: string, projectId: string, levelId: string): Promise<void> {
    const [row] = await this.db.withTenant(companyId, sql => sql`
      SELECT lvl.id FROM levels lvl
      JOIN buildings b ON b.id = lvl.building_id
      WHERE lvl.id = ${levelId} AND b.project_id = ${projectId} AND b.company_id = ${companyId}`);
    if (!row) throw new NotFoundException('Level not found.');
  }

  private async getLocationInProject(companyId: string, projectId: string, locationId: string): Promise<{ id: string; name: string; description: string | null }> {
    const [row] = await this.db.withTenant(companyId, sql => sql`
      SELECT loc.id, loc.name, loc.description
      FROM locations loc
      LEFT JOIN levels lvl ON lvl.id = loc.level_id
      LEFT JOIN buildings b ON b.id = lvl.building_id
      LEFT JOIN drawings d ON d.id = loc.drawing_id
      WHERE loc.id = ${locationId} AND loc.company_id = ${companyId} AND loc.archived_at IS NULL
        AND COALESCE(b.project_id, d.project_id) = ${projectId}`);
    if (!row) throw new NotFoundException('Location not found.');
    return row as { id: string; name: string; description: string | null };
  }

  async createLevel(companyId: string, projectId: string, buildingId: string, dto: { name: string; elevationM?: number; levelOrder: number }) {
    await this.assertBuildingInProject(companyId, projectId, buildingId);
    // withTenant required -- levels carries the tenant_isolation RLS policy;
    // a plain this.db.query() never sets app.current_company_id.
    const [l] = await this.db.withTenant(companyId, sql => sql`
      INSERT INTO levels (company_id, building_id, name, elevation_m, level_order)
      VALUES (${companyId}, ${buildingId}, ${dto.name}, ${dto.elevationM ?? null}, ${dto.levelOrder})
      RETURNING *`);
    return l;
  }

  async getLevels(companyId: string, projectId: string, buildingId: string) {
    // H-1 fix: joined through to buildings.project_id -- a building in a
    // different project (or one that doesn't exist) now correctly yields
    // an empty list, the same "nothing found" shape this already had for a
    // bogus buildingId, rather than leaking another project's levels.
    return this.db.withTenant(companyId, sql => sql`
      SELECT lvl.* FROM levels lvl
      JOIN buildings b ON b.id = lvl.building_id
      WHERE lvl.building_id = ${buildingId} AND b.project_id = ${projectId} AND b.company_id = ${companyId}
      ORDER BY lvl.level_order`);
  }

  async createLocation(companyId: string, projectId: string, levelId: string, dto: { name: string; description?: string; coordinatesOnPlan?: { x: number; y: number } }) {
    await this.assertLevelInProject(companyId, projectId, levelId);
    const coords = dto.coordinatesOnPlan ? `(${dto.coordinatesOnPlan.x},${dto.coordinatesOnPlan.y})` : null;
    // withTenant required -- locations carries the tenant_isolation RLS policy;
    // a plain this.db.query() never sets app.current_company_id.
    const [loc] = await this.db.withTenant(companyId, sql => sql`
      INSERT INTO locations (company_id, level_id, name, description, coordinates_on_plan)
      VALUES (${companyId}, ${levelId}, ${dto.name}, ${dto.description ?? null}, ${coords}::point)
      RETURNING *`);
    return loc;
  }

  async getLocations(companyId: string, projectId: string, levelId: string) {
    // H-1 fix: see getLevels()'s identical comment above.
    return this.db.withTenant(companyId, sql => sql`
      SELECT loc.*,
        COUNT(DISTINCT c.id) AS capture_count,
        COUNT(DISTINCT i.id) FILTER (WHERE i.status NOT IN ('closed','void')) AS open_issue_count
      FROM locations loc
      JOIN levels lvl ON lvl.id = loc.level_id
      JOIN buildings b ON b.id = lvl.building_id
      LEFT JOIN captures c ON c.location_id = loc.id
      LEFT JOIN issues i ON i.location_id = loc.id
      WHERE loc.level_id = ${levelId} AND loc.archived_at IS NULL
        AND b.project_id = ${projectId} AND b.company_id = ${companyId}
      GROUP BY loc.id
      ORDER BY loc.name`);
  }

  // Rename / re-describe / reposition a location -- covers both
  // building-hierarchy locations and floor-plan pins (a pin is a location
  // with no level). posXNorm/posYNorm let a pin be moved to a new spot.
  async updateLocation(
    companyId: string,
    projectId: string,
    locationId: string,
    dto: { name?: string; description?: string; posXNorm?: number; posYNorm?: number; elementId?: string | null },
  ) {
    await this.getLocationInProject(companyId, projectId, locationId);
    // elementId is distinguished from "not provided" so a pin can be
    // explicitly unlinked from its BIM element (elementId: null), not just
    // linked -- the other fields here can only ever be set, never cleared.
    const elementIdProvided = Object.prototype.hasOwnProperty.call(dto, 'elementId');
    // H-1 follow-up: a non-null elementId was never checked against this
    // project -- a user authorized for Project A could link Project B's
    // BIM element to a Project A location pin by supplying its id. The
    // null case (explicit unlink) is left alone -- there's nothing to
    // validate when clearing the link.
    if (elementIdProvided && dto.elementId != null) {
      const [row] = await this.db.withTenant(companyId, sql => sql`
        SELECT 1 FROM bim_elements WHERE id = ${dto.elementId ?? null} AND project_id = ${projectId} AND company_id = ${companyId}
      `);
      if (!row) throw new NotFoundException('BIM element not found.');
    }
    // withTenant required -- locations carries the tenant_isolation RLS policy;
    // a plain this.db.query() never sets app.current_company_id.
    const [loc] = await this.db.withTenant(companyId, sql => sql`
      UPDATE locations SET
        name        = COALESCE(${dto.name ?? null}, name),
        description = COALESCE(${dto.description ?? null}, description),
        pos_x_norm  = COALESCE(${dto.posXNorm ?? null}, pos_x_norm),
        pos_y_norm  = COALESCE(${dto.posYNorm ?? null}, pos_y_norm),
        element_id  = CASE WHEN ${elementIdProvided} THEN ${dto.elementId ?? null} ELSE element_id END
      WHERE id = ${locationId} AND company_id = ${companyId} AND archived_at IS NULL
      RETURNING *`);
    if (!loc) throw new NotFoundException('Location not found.');
    return loc;
  }

  // Soft-delete: hides a pin from normal views without destroying it or
  // anything attached to it (photos, videos, notes all survive). Site
  // photos are often one-of-a-kind -- a real delete is never worth the risk.
  async archiveLocation(companyId: string, projectId: string, locationId: string) {
    await this.getLocationInProject(companyId, projectId, locationId);
    // withTenant required -- locations carries the tenant_isolation RLS policy;
    // a plain this.db.query() never sets app.current_company_id.
    const [loc] = await this.db.withTenant(companyId, sql => sql`
      UPDATE locations SET archived_at = NOW()
      WHERE id = ${locationId} AND company_id = ${companyId} AND archived_at IS NULL
      RETURNING *`);
    if (!loc) throw new NotFoundException('Location not found.');
    return loc;
  }

  // Converts a pin's auto-created Issue into a Snag item. Works identically
  // whether the pin came from a floor-plan drawing (drawings.service.ts
  // createPin()) or a BIM element (bim.service.ts createPinForElement()) --
  // it's location-based, not drawing/element-based. The new snag item takes
  // over issues.location_id's role via its own location_id; the Issue is
  // then deleted so a pin is never linked to both at once.
  async convertPinToSnag(companyId: string, projectId: string, locationId: string, userId: string, userRole: string) {
    // H-1 fix: projectId was already a parameter here but was never
    // actually checked against the location -- a user authorized for a
    // different project in the same company could pass another project's
    // locationId and have its name/description leak into a brand-new snag
    // item created in THIS project (the issue lookup just below happens to
    // filter by project_id, so it silently finds no matching issue, but
    // the location itself was never re-verified).
    const loc = await this.getLocationInProject(companyId, projectId, locationId);

    // withTenant required -- issues carries the tenant_isolation RLS policy.
    const [issue] = await this.db.withTenant(companyId, sql => sql`
      SELECT id, title, description FROM issues
      WHERE location_id = ${locationId} AND company_id = ${companyId} AND project_id = ${projectId}
      ORDER BY created_at ASC LIMIT 1`);

    const title = (issue?.title as string | undefined) ?? (loc.name as string | undefined) ?? 'Untitled pin';
    const description = (issue?.description as string | undefined) ?? (loc.description as string | undefined);

    const snag = await this.snagging.create(companyId, projectId, userId, { title, description, locationId });

    // Only delete the Issue once the Snag item was successfully created.
    if (issue) {
      await this.issues.delete(companyId, projectId, issue.id as string, userId, userRole);
    }

    return snag;
  }
}