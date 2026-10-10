// Phase 6 security audit regression tests: this repo has no e2e test
// harness (0 *.e2e-spec.ts files exist despite a test:e2e script being
// configured), so controller-level @RequireProjectPermission wiring isn't
// otherwise covered by anything in the automated suite -- a future edit
// could silently remove one of these decorators and nothing would fail.
// These tests read the real NestJS route metadata directly off each fixed
// controller method (the same metadata ProjectPermissionGuard itself reads
// via Reflector at request time -- see project-permission.guard.ts), so
// they fail if any of the four Phase 6 authorization fixes is ever
// accidentally reverted, without needing a running HTTP server or database.
import 'reflect-metadata';
import { PROJECT_PERMISSION_KEY } from '../../decorators/require-project-permission.decorator';
import { ProjectsController } from '../../../modules/projects/projects.controller';
import { BuildingsController } from '../../../modules/buildings/buildings.controller';
import { RiskController } from '../../../modules/risk/risk.controller';

function permissionsOn(prototype: object, methodName: string): string[] | undefined {
  return Reflect.getMetadata(PROJECT_PERMISSION_KEY, Object.getOwnPropertyDescriptor(prototype, methodName)!.value);
}

describe('Phase 6 regression: previously-ungated mutating routes now require manage_project_records', () => {
  it('ProjectsController.update (PATCH /projects/:id) -- was reachable by ANY authenticated company user before this fix', () => {
    expect(permissionsOn(ProjectsController.prototype, 'update')).toEqual(['manage_project_records']);
  });

  it('ProjectsController.getBrandingUploadUrl (POST /projects/:id/branding/upload-url)', () => {
    expect(permissionsOn(ProjectsController.prototype, 'getBrandingUploadUrl')).toEqual(['manage_project_records']);
  });

  it.each([
    'createBuilding',
    'updateBuilding',
    'createLevel',
    'createLocation',
    'updateLocation',
    'archiveLocation',
  ])('BuildingsController.%s -- was reachable by ANY authenticated company user before this fix', (method) => {
    expect(permissionsOn(BuildingsController.prototype, method)).toEqual(['manage_project_records']);
  });

  it.each([
    'recalculate',
    'setHumanAssessmentByEntity',
    'setHumanAssessment',
    'setMatrixOverride',
    'clearMatrixOverride',
    'override',
    'clearOverride',
    'setStatus',
    'assignOwner',
  ])('RiskController.%s -- was reachable by ANY authenticated company user before this fix', (method) => {
    expect(permissionsOn(RiskController.prototype, method)).toEqual(['manage_project_records']);
  });

  // Reads were deliberately left ungated, consistent with this platform's
  // company-wide read-visibility model -- confirms the fix didn't
  // over-correct and accidentally lock out legitimate read access too.
  it('reads remain ungated: BuildingsController.getLevels/getLocations, RiskController.getSummary', () => {
    expect(permissionsOn(BuildingsController.prototype, 'getLevels')).toBeUndefined();
    expect(permissionsOn(BuildingsController.prototype, 'getLocations')).toBeUndefined();
    expect(permissionsOn(RiskController.prototype, 'getSummary')).toBeUndefined();
  });

  // convertToSnag enforces its own creator-or-admin check by delegating to
  // IssuesService.delete() -- deliberately not given a redundant/stricter
  // gate here, confirmed still true.
  it('BuildingsController.convertToSnag remains ungated at this layer (enforces its own check downstream)', () => {
    expect(permissionsOn(BuildingsController.prototype, 'convertToSnag')).toBeUndefined();
  });
});
