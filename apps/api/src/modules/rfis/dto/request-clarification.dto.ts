import { IsString, MinLength } from 'class-validator';

// Body for POST :id/request-clarification -- the reviewer's reason for
// sending the RFI back to the creator, recorded in audit_log.metadata
// (see RfisService.requestClarification).
export class RequestClarificationDto {
  @IsString() @MinLength(1)
  reason: string;
}
