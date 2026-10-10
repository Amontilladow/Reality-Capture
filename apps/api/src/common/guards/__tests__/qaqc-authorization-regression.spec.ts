// QAQC NCR/SOR brief §2: create/close/attachment routes must be gated by
// an EXPLICIT role list (@RequireExactRoles), never @Roles()'s minimum-
// weight threshold -- see exact-roles.guard.ts's own comment for why
// @Roles('qa_qc_manager') would incorrectly also admit every higher-weight
// role. Same reflection-based convention as phase6-authorization-
// regression.spec.ts: reads the real NestJS route metadata directly, so
// this fails if the decorator is ever accidentally swapped or removed,
// without needing a running HTTP server or database.
import 'reflect-metadata';
import { EXACT_ROLES_KEY } from '../../decorators/require-exact-roles.decorator';
import { QaqcController } from '../../../modules/qaqc/qaqc.controller';

function exactRolesOn(methodName: string): string[] | undefined {
  return Reflect.getMetadata(EXACT_ROLES_KEY, Object.getOwnPropertyDescriptor(QaqcController.prototype, methodName)!.value);
}

describe('QAQC authorization: explicit role lists, not weight thresholds', () => {
  it('create (POST /projects/:id/qaqc) -- only qa_qc_manager + admin override, NOT the higher-weight roles above it', () => {
    const roles = exactRolesOn('create');
    expect(roles).toEqual(['qa_qc_manager', 'company_admin', 'super_admin']);
    // The whole point of this test: a weight-threshold check would also
    // admit these, since they outrank qa_qc_manager in COMPANY_ROLE_WEIGHT.
    expect(roles).not.toContain('construction_manager');
    expect(roles).not.toContain('project_manager');
    expect(roles).not.toContain('bim_manager');
    expect(roles).not.toContain('engineering_manager');
    expect(roles).not.toContain('technical_director');
  });

  it('close (POST /qaqc/:id/close) -- construction/technical/QAQC-in-charge + admin override', () => {
    expect(exactRolesOn('close')).toEqual(['construction_manager', 'technical_director', 'qa_qc_manager', 'company_admin', 'super_admin']);
  });

  it.each(['getAttachmentUploadUrl', 'addAttachment', 'deleteAttachment'])(
    'QaqcController.%s -- attachment management shares the union of issue+close roles',
    (method) => {
      expect(exactRolesOn(method)).toEqual(['qa_qc_manager', 'construction_manager', 'technical_director', 'company_admin', 'super_admin']);
    },
  );

  it.each(['findAll', 'findOne', 'getSummary', 'downloadPdf', 'getAttachments'])(
    'QaqcController.%s -- read routes carry no role restriction at all',
    (method) => {
      expect(exactRolesOn(method)).toBeUndefined();
    },
  );
});
