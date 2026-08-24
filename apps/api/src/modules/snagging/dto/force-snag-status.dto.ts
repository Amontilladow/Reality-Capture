import { IsIn } from 'class-validator';

// snag_items' actual 4 status values (SNAG_STATUSES in the frontend's
// snagging-constants.ts, backed by status VARCHAR(20) with no CHECK
// constraint in 018_snag_items.sql) -- same "VARCHAR + @IsIn is the real
// enum" pattern as issues' ForceStatusDto. This path (admin-only, gated by
// @Roles at the controller) bypasses whatever transition rules a normal
// status update might someday enforce.
export class ForceSnagStatusDto {
  @IsIn(['open','fixed','verified','void'])
  status: string;
}
