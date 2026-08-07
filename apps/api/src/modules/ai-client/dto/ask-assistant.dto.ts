import { IsString, IsOptional, IsArray, MinLength, MaxLength } from 'class-validator';

export class ConversationMessageDto {
  @IsString() role: string;
  @IsString() content: string;
}

export class AskAssistantDto {
  @IsString() @MinLength(1) @MaxLength(2000)
  question: string;

  @IsOptional() @IsArray()
  conversationHistory?: ConversationMessageDto[];
}
