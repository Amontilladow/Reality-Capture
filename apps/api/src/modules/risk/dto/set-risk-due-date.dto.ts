import { IsISO8601, IsOptional } from 'class-validator';

export class SetRiskDueDateDto {
  // null clears it; omitted/undefined is rejected by the controller's own
  // body-shape expectations the same way AssignRiskOwnerDto's ownerId is --
  // see risk.controller.ts's setDueDate.
  @IsOptional() @IsISO8601()
  dueDate?: string | null;
}
