import { IsString, IsOptional, IsIn, MinLength } from 'class-validator';
import { PROJECT_ORGANIZATION_SLOTS, type ProjectOrganizationSlot } from '@engineeringos/types';

// Body for POST :id/comments -- the free-text clarification thread,
// separate from the formal question/answer record (rfi_comments table).
export class AddRfiCommentDto {
  @IsString() @MinLength(1)
  body: string;

  @IsOptional() @IsIn(PROJECT_ORGANIZATION_SLOTS)
  organizationSlot?: ProjectOrganizationSlot;
}
