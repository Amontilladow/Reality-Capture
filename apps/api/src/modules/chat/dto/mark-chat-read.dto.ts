import { IsIn, IsUUID } from 'class-validator';

export class MarkChatReadDto {
  @IsIn(['project', 'dm'])
  channelType: 'project' | 'dm';

  @IsUUID()
  channelId: string;
}
