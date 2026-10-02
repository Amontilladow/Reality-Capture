import { IsIn, IsString, IsUUID, MaxLength } from 'class-validator';
import type { ChatChannelType } from '../chat.service';

// chat:join/chat:send previously declared their @MessageBody() params as
// inline TypeScript object-literal types. Those have no runtime
// representation, so NestJS's global ValidationPipe -- which decides
// whether to validate based on the reflected metatype -- silently skipped
// validation entirely (metatype === Object). Real DTO classes here give it
// something to validate against, mirroring the REST sibling MarkChatReadDto.
export class ChatJoinDto {
  @IsIn(['project', 'dm'])
  channelType: ChatChannelType;

  @IsUUID()
  channelId: string;
}

export class ChatSendDto {
  @IsIn(['project', 'dm'])
  channelType: ChatChannelType;

  @IsUUID()
  channelId: string;

  // No length cap previously existed anywhere in the chat:send path --
  // only Socket.IO's generic ~1MB engine.io buffer bounded it. Matches
  // other free-text body fields in this codebase (e.g. RFI comments).
  @IsString()
  @MaxLength(4000)
  body: string;
}
