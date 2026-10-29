import { NotFoundException } from '@nestjs/common';
import { BuildingsService } from './buildings.service';
import type { DatabaseService } from '../../database/database.service';
import type { IssuesService } from '../issues/issues.service';
import type { SnaggingService } from '../snagging/snagging.service';

// H-1 fix (KNOWN_ISSUES_AND_REMEDIATION.md): every mutating/reading route in
// this module except createBuilding() previously scoped only by
// company_id (or, for locations, didn't even use the projectId parameter
// it already had) -- RequireProjectPermission at the controller only
// confirms the caller has the permission on the URL's :projectId, never
// that the building/level/location id actually belongs to it. A user
// authorized for a different project in the same company could
// read/create/rename/archive any building/level/location hierarchy node by
// guessing its UUID. These tests cover both directions for every affected
// method: rejected when the resource belongs to a different project,
// allowed when it really is in the caller's project.
describe('BuildingsService project-scoping (H-1)', () => {
  const companyId = 'company-1';
  const projectId = 'project-1';
  const buildingId = 'building-1';
  const levelId = 'level-1';
  const locationId = 'location-1';

  function makeService() {
    const withTenant = jest.fn();
    const db = { withTenant };
    const issues = { delete: jest.fn() };
    const snagging = { create: jest.fn() };
    const svc = new BuildingsService(
      db as unknown as DatabaseService,
      issues as unknown as IssuesService,
      snagging as unknown as SnaggingService,
    );
    return { svc, withTenant, issues, snagging };
  }

  describe('updateBuilding', () => {
    it("rejects updating a building that belongs to a different project in the caller's company", async () => {
      const { svc, withTenant } = makeService();
      withTenant.mockResolvedValueOnce([]); // UPDATE ... WHERE project_id = wrong -> no match
      await expect(svc.updateBuilding(companyId, projectId, 'other-projects-building', { name: 'Hacked' }))
        .rejects.toThrow(NotFoundException);
    });

    it('updates a building that really is in this project', async () => {
      const { svc, withTenant } = makeService();
      withTenant.mockResolvedValueOnce([{ id: buildingId, name: 'Tower A' }]);
      const result = await svc.updateBuilding(companyId, projectId, buildingId, { name: 'Tower A' });
      expect(result).toEqual({ id: buildingId, name: 'Tower A' });
    });
  });

  describe('createLevel', () => {
    it("rejects creating a level on a building in a different project", async () => {
      const { svc, withTenant } = makeService();
      withTenant.mockResolvedValueOnce([]); // assertBuildingInProject finds nothing
      await expect(svc.createLevel(companyId, projectId, 'other-projects-building', { name: 'L1', levelOrder: 1 }))
        .rejects.toThrow(NotFoundException);
      expect(withTenant).toHaveBeenCalledTimes(1); // never reached the INSERT
    });

    it('creates a level on a building that really is in this project', async () => {
      const { svc, withTenant } = makeService();
      withTenant
        .mockResolvedValueOnce([{ id: buildingId }]) // assertBuildingInProject
        .mockResolvedValueOnce([{ id: levelId, name: 'L1' }]); // INSERT
      const result = await svc.createLevel(companyId, projectId, buildingId, { name: 'L1', levelOrder: 1 });
      expect(result).toEqual({ id: levelId, name: 'L1' });
    });
  });

  describe('getLevels', () => {
    it('returns no levels for a building that belongs to a different project (not an error -- same shape as a nonexistent building)', async () => {
      const { svc, withTenant } = makeService();
      withTenant.mockResolvedValueOnce([]);
      const result = await svc.getLevels(companyId, projectId, 'other-projects-building');
      expect(result).toEqual([]);
    });

    it('returns levels for a building that really is in this project', async () => {
      const { svc, withTenant } = makeService();
      withTenant.mockResolvedValueOnce([{ id: levelId, name: 'L1' }]);
      const result = await svc.getLevels(companyId, projectId, buildingId);
      expect(result).toEqual([{ id: levelId, name: 'L1' }]);
    });
  });

  describe('createLocation', () => {
    it('rejects creating a location on a level in a different project', async () => {
      const { svc, withTenant } = makeService();
      withTenant.mockResolvedValueOnce([]); // assertLevelInProject finds nothing
      await expect(svc.createLocation(companyId, projectId, 'other-projects-level', { name: 'Loc' }))
        .rejects.toThrow(NotFoundException);
      expect(withTenant).toHaveBeenCalledTimes(1); // never reached the INSERT
    });

    it('creates a location on a level that really is in this project', async () => {
      const { svc, withTenant } = makeService();
      withTenant
        .mockResolvedValueOnce([{ id: levelId }]) // assertLevelInProject
        .mockResolvedValueOnce([{ id: locationId, name: 'Loc' }]); // INSERT
      const result = await svc.createLocation(companyId, projectId, levelId, { name: 'Loc' });
      expect(result).toEqual({ id: locationId, name: 'Loc' });
    });
  });

  describe('getLocations', () => {
    it('returns no locations for a level that belongs to a different project', async () => {
      const { svc, withTenant } = makeService();
      withTenant.mockResolvedValueOnce([]);
      const result = await svc.getLocations(companyId, projectId, 'other-projects-level');
      expect(result).toEqual([]);
    });

    it('returns locations for a level that really is in this project', async () => {
      const { svc, withTenant } = makeService();
      withTenant.mockResolvedValueOnce([{ id: locationId, name: 'Loc' }]);
      const result = await svc.getLocations(companyId, projectId, levelId);
      expect(result).toEqual([{ id: locationId, name: 'Loc' }]);
    });
  });

  describe('updateLocation', () => {
    it('rejects updating a location that belongs to a different project (building-hierarchy path)', async () => {
      const { svc, withTenant } = makeService();
      withTenant.mockResolvedValueOnce([]); // getLocationInProject finds nothing
      await expect(svc.updateLocation(companyId, projectId, 'other-projects-location', { name: 'Hacked' }))
        .rejects.toThrow(NotFoundException);
      expect(withTenant).toHaveBeenCalledTimes(1); // never reached the UPDATE
    });

    it('updates a location that really is in this project', async () => {
      const { svc, withTenant } = makeService();
      withTenant
        .mockResolvedValueOnce([{ id: locationId, name: 'Loc', description: null }]) // getLocationInProject
        .mockResolvedValueOnce([{ id: locationId, name: 'Renamed' }]); // UPDATE
      const result = await svc.updateLocation(companyId, projectId, locationId, { name: 'Renamed' });
      expect(result).toEqual({ id: locationId, name: 'Renamed' });
    });

    // H-1 follow-up: the location itself can be in the right project while
    // the BIM element being linked to it belongs to a different one in the
    // same company -- the test above doesn't cover this case.
    it('rejects linking a BIM element that belongs to a different project, and writes no update', async () => {
      const { svc, withTenant } = makeService();
      withTenant
        .mockResolvedValueOnce([{ id: locationId, name: 'Loc', description: null }]) // getLocationInProject
        .mockResolvedValueOnce([]); // element exists, but not in this project
      await expect(svc.updateLocation(companyId, projectId, locationId, { elementId: 'element-from-other-project' }))
        .rejects.toThrow(NotFoundException);
      expect(withTenant).toHaveBeenCalledTimes(2); // never reached the UPDATE
    });

    it('links a BIM element that really is in this project', async () => {
      const { svc, withTenant } = makeService();
      withTenant
        .mockResolvedValueOnce([{ id: locationId, name: 'Loc', description: null }]) // getLocationInProject
        .mockResolvedValueOnce([{ id: 'element-1' }]) // assertElementInProject-equivalent check
        .mockResolvedValueOnce([{ id: locationId, elementId: 'element-1' }]); // UPDATE
      const result = await svc.updateLocation(companyId, projectId, locationId, { elementId: 'element-1' });
      expect(result).toEqual({ id: locationId, elementId: 'element-1' });
    });

    it('explicitly unlinking a BIM element (elementId: null) skips the ownership check entirely', async () => {
      const { svc, withTenant } = makeService();
      withTenant
        .mockResolvedValueOnce([{ id: locationId, name: 'Loc', description: null }]) // getLocationInProject
        .mockResolvedValueOnce([{ id: locationId, elementId: null }]); // UPDATE -- no element check in between
      const result = await svc.updateLocation(companyId, projectId, locationId, { elementId: null });
      expect(result).toEqual({ id: locationId, elementId: null });
      expect(withTenant).toHaveBeenCalledTimes(2);
    });
  });

  describe('archiveLocation', () => {
    it('rejects archiving a location that belongs to a different project', async () => {
      const { svc, withTenant } = makeService();
      withTenant.mockResolvedValueOnce([]);
      await expect(svc.archiveLocation(companyId, projectId, 'other-projects-location'))
        .rejects.toThrow(NotFoundException);
      expect(withTenant).toHaveBeenCalledTimes(1);
    });

    it('archives a location that really is in this project', async () => {
      const { svc, withTenant } = makeService();
      withTenant
        .mockResolvedValueOnce([{ id: locationId, name: 'Loc', description: null }])
        .mockResolvedValueOnce([{ id: locationId, archivedAt: '2026-01-01T00:00:00Z' }]);
      const result = await svc.archiveLocation(companyId, projectId, locationId);
      expect(result).toEqual({ id: locationId, archivedAt: '2026-01-01T00:00:00Z' });
    });
  });

  // convertPinToSnag: projectId was already a parameter here before the
  // fix, but was never checked against the location -- the clearest H-1
  // instance in this module, since it looked safe (projectId threaded
  // through) without actually being enforced.
  describe('convertPinToSnag', () => {
    it("rejects converting a pin whose location belongs to a different project in the caller's company", async () => {
      const { svc, withTenant, snagging } = makeService();
      withTenant.mockResolvedValueOnce([]); // getLocationInProject finds nothing
      await expect(svc.convertPinToSnag(companyId, projectId, 'other-projects-location', 'user-1', 'project_manager'))
        .rejects.toThrow(NotFoundException);
      expect(snagging.create).not.toHaveBeenCalled();
    });

    it('converts a pin whose location really is in this project, using the location name/description as a fallback title', async () => {
      const { svc, withTenant, snagging } = makeService();
      withTenant
        .mockResolvedValueOnce([{ id: locationId, name: 'Pin A', description: 'A pin' }]) // getLocationInProject
        .mockResolvedValueOnce([]); // no matching issue for this location/project
      snagging.create.mockResolvedValue({ id: 'snag-1', title: 'Pin A' });

      const result = await svc.convertPinToSnag(companyId, projectId, locationId, 'user-1', 'project_manager');

      expect(result).toEqual({ id: 'snag-1', title: 'Pin A' });
      expect(snagging.create).toHaveBeenCalledWith(companyId, projectId, 'user-1', {
        title: 'Pin A', description: 'A pin', locationId,
      });
    });
  });
});
