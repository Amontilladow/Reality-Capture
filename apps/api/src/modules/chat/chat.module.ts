import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { ProjectChatController, ChatController } from './chat.controller';

@Module({
  // AuthModule already exports a JwtModule.registerAsync()-configured
  // JwtService (secret pulled from jwt.accessSecret) -- reuse that instance
  // for the gateway's own token verification rather than re-registering
  // JwtModule here, which would risk secret/config drift.
  imports: [AuthModule],
  controllers: [ProjectChatController, ChatController],
  providers: [ChatService, ChatGateway],
  exports: [ChatService],
})
export class ChatModule {}
