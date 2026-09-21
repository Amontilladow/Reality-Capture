import { IsString, MinLength } from 'class-validator';

// Body for POST /public/rfis/external/:token/comments. No organizationSlot
// field at all, deliberately -- the external caller can't claim to be a
// different stakeholder than the link was issued for; RfiExternalAccessService
// always sets it from the token row itself.
export class ExternalCommentDto {
  @IsString() @MinLength(1)
  body: string;
}
