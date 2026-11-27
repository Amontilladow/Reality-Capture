import { IsBoolean } from 'class-validator';

// A personal preference (mute/un-mute this one drawing's notifications for
// yourself), not a document-control decision -- no RequireCategoryAction
// gate, same as NotificationsController's own preferences endpoints.
export class SetSiteDrawingNotifyMeDto {
  @IsBoolean()
  notify!: boolean;
}
