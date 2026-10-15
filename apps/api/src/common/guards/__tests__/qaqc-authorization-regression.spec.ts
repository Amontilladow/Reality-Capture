// QAQC NCR/SOR/WIR/MIR brief §2: create/respond/confirm/attachment/capture
// routes must be gated by an EXPLICIT role list (@RequireExactRoles), never
// @Roles()'s minimum-weight threshold -- see exact-roles.guard.ts's own
// comment for why @Roles('qa_qc_manager') would incorrectly also admit
// every higher-weight role. Same reflection-based convention as phase6-
// authorization-regression.spec.ts: reads the real NestJS route metadata
// directly, so this fails if a decorator is ever accidentally swapped or
// removed, without needing a running HTTP server or database.
//
// NCR/SOR and WIR/MIR swap issuer/responder roles (see qaqc.service.ts's
// own comment), which can't be expressed as a single static role list per
// route since one route serves all four types -- so create/respond carry
// the BROADENED union here (a coarse pre-filter against bim_manager,
// commercial_manager, consultant, client_representative, etc.), and the
// exact-for-this-type enforcement is asserted separately in
// qaqc.service.spec.ts's 'create'/'respond' describe blocks, which test the
// real per-type ForbiddenException. confirm's role set never varies by
// type, so it stays the sole narrow, unbroadened gate.
import 'reflect-metadata';
import { EXACT_ROLES_KEY } from '../../decorators/require-exact-roles.decorator';
import { QaqcController } from '../../../modules/qaqc/qaqc.controller';

function exactRolesOn(methodName: string): string[] | undefined {
  return Reflect.getMetadata(EXACT_ROLES_KEY, Object.getOwnPropertyDescriptor(QaqcController.prototype, methodName)!.value);
}

describe('QAQC authorization: explicit role lists, not weight thresholds', () => {
  it.each(['create', 'respond'])(
    'QaqcController.%s -- broadened to the union of QAQC + construction-team roles (per-type precision lives in QaqcService)',
    (method) => {
      const roles = exactRolesOn(method);
      expect(roles).toEqual([
        'qa_qc_manager', 'construction_manager', 'project_manager', 'technical_director', 'engineering_manager', 'company_admin', 'super_admin',
      ]);
      // Still excludes roles that can never create/respond to ANY QAQC
      // record type, regardless of weight.
      expect(roles).not.toContain('bim_manager');
      expect(roles).not.toContain('commercial_manager');
      expect(roles).not.toContain('consultant');
      expect(roles).not.toContain('client_representative');
    },
  );

  it('confirm (POST /qaqc/:id/confirm) -- QAQC-in-charge + admin override ONLY, for every record type, narrower than respond', () => {
    const roles = exactRolesOn('confirm');
    expect(roles).toEqual(['qa_qc_manager', 'company_admin', 'super_admin']);
    // The whole point of the two-step close: none of the respond-step roles
    // can also confirm, even though they sit between qa_qc_manager and the
    // admins in COMPANY_ROLE_WEIGHT.
    expect(roles).not.toContain('construction_manager');
    expect(roles).not.toContain('project_manager');
    expect(roles).not.toContain('technical_director');
    expect(roles).not.toContain('engineering_manager');
  });

  it.each(['getAttachmentUploadUrl', 'addAttachment', 'deleteAttachment', 'addCapture'])(
    'QaqcController.%s -- attachment/photo management shares the union of issue+respond roles',
    (method) => {
      expect(exactRolesOn(method)).toEqual([
        'qa_qc_manager', 'construction_manager', 'project_manager', 'technical_director', 'engineering_manager', 'company_admin', 'super_admin',
      ]);
    },
  );

  it.each(['findAll', 'findOne', 'getSummary', 'downloadPdf', 'getAttachments', 'getCaptures'])(
    'QaqcController.%s -- read routes carry no role restriction at all',
    (method) => {
      expect(exactRolesOn(method)).toBeUndefined();
    },
  );
});
