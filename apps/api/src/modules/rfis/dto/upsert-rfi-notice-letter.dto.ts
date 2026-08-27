import { IsString, IsUUID } from 'class-validator';

// Body for PUT :id/letter -- create-or-update (schema-level UNIQUE (rfi_id)
// makes this a real upsert, not a manual exists-check-then-branch). Editing
// an already-shared letter's recipient/title/body is allowed; see
// RfisService.upsertNoticeLetter for why status/shared_at/shared_by are
// deliberately left untouched by that ON CONFLICT DO UPDATE.
export class UpsertRfiNoticeLetterDto {
  @IsUUID()
  recipientUserId: string;

  @IsString()
  recipientTitle: string;

  @IsString()
  body: string;
}
