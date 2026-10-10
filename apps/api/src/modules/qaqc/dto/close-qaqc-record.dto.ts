import { IsString, MinLength } from 'class-validator';

// Single respond-and-close action (brief section 4: "the construction in
// charge or technical in charge or QAQC in charge can upload documents and
// reply to close") -- unlike RFI's multi-step submit/respond/
// submit-for-review/decide-review workflow, NCR/SOR has exactly one
// workflow transition: open -> closed, with a response and (optionally,
// via the attachments endpoints, kind: 'response') a closing document.
export class CloseQaqcRecordDto {
  @IsString() @MinLength(1)
  response: string;
}
