import { deriveAction } from './audit.interceptor';

// RBAC Phase 6: the access-control mutations added across Phases 1-5
// (project membership, permission grants, organization-slot membership,
// snag verification) all previously fell through to deriveAction()'s
// generic last-segment fallback -- which for these exact routes produced
// unreadable labels like "verify.created" or "members.created", not
// obviously distinguishable from a routine resource create. These tests
// lock in the explicit, semantic ROUTE_MAP entries added for them.
describe('deriveAction', () => {
  it('labels adding a project member', () => {
    expect(deriveAction('POST', '/api/v1/projects/project-1/members'))
      .toEqual({ action: 'project_member.added', resourceType: 'project_member' });
  });

  it('labels removing a project member', () => {
    expect(deriveAction('DELETE', '/api/v1/projects/project-1/members/user-1'))
      .toEqual({ action: 'project_member.removed', resourceType: 'project_member' });
  });

  it('labels granting a project permission', () => {
    expect(deriveAction('POST', '/api/v1/projects/project-1/permission-grants'))
      .toEqual({ action: 'project_permission.granted', resourceType: 'project_permission_grant' });
  });

  it('labels revoking a project permission', () => {
    expect(deriveAction('DELETE', '/api/v1/projects/project-1/permission-grants/user-1/manage_rfis'))
      .toEqual({ action: 'project_permission.revoked', resourceType: 'project_permission_grant' });
  });

  it('labels assigning an organization-slot member', () => {
    expect(deriveAction('POST', '/api/v1/projects/project-1/organizations/client/members'))
      .toEqual({ action: 'project_organization.member_added', resourceType: 'project_organization_member' });
  });

  it('labels removing an organization-slot member', () => {
    expect(deriveAction('DELETE', '/api/v1/projects/project-1/organizations/members/user-1'))
      .toEqual({ action: 'project_organization.member_removed', resourceType: 'project_organization_member' });
  });

  it('labels verifying a snag item', () => {
    expect(deriveAction('POST', '/api/v1/projects/project-1/snag-items/snag-1/verify'))
      .toEqual({ action: 'snag_item.verified', resourceType: 'snag_item' });
  });

  // Phase 7: RFI lifecycle and snag creation were previously uncovered
  // entirely -- these fell through to the generic fallback, same gap as
  // the access-control routes above before RBAC Phase 6 fixed those.
  it('labels creating an RFI', () => {
    expect(deriveAction('POST', '/api/v1/projects/project-1/rfis'))
      .toEqual({ action: 'rfi.created', resourceType: 'rfi' });
  });

  it('labels responding to an RFI, not the generic update fallback', () => {
    expect(deriveAction('POST', '/api/v1/projects/project-1/rfis/rfi-1/respond'))
      .toEqual({ action: 'rfi.responded', resourceType: 'rfi' });
  });

  it('labels closing an RFI, not the generic update fallback', () => {
    expect(deriveAction('POST', '/api/v1/projects/project-1/rfis/rfi-1/close'))
      .toEqual({ action: 'rfi.closed', resourceType: 'rfi' });
  });

  it('labels a plain RFI field edit as a generic update', () => {
    expect(deriveAction('PATCH', '/api/v1/rfis/rfi-1'))
      .toEqual({ action: 'rfi.updated', resourceType: 'rfi' });
  });

  it('labels creating a snag item, distinct from verifying one', () => {
    expect(deriveAction('POST', '/api/v1/projects/project-1/snag-items'))
      .toEqual({ action: 'snag_item.created', resourceType: 'snag_item' });
  });

  // Sanity check against a pre-existing, unrelated ROUTE_MAP entry -- confirms
  // the new access-control entries were appended, not inserted somewhere that
  // shadows an earlier match.
  it('still labels an unrelated existing route unchanged', () => {
    expect(deriveAction('PATCH', '/api/v1/projects/project-1'))
      .toEqual({ action: 'project.updated', resourceType: 'project' });
  });

  it('falls back to the generic URL-derived label for a genuinely unmapped route', () => {
    expect(deriveAction('POST', '/api/v1/projects/project-1/submittals'))
      .toEqual({ action: 'submittals.created', resourceType: 'submittals' });
  });
});
