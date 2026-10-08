import { IsString, IsOptional, IsArray, IsIn, MinLength, MaxLength, ValidateNested, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';

export class ConversationMessageDto {
  @IsIn(['user', 'assistant']) role: 'user' | 'assistant';
  @IsString() @MaxLength(2000) content: string;
}

// Spec section 18 (context-aware assistant): the frontend passes what the
// user is currently looking at, if anything, so a follow-up like "why is
// this high risk?" doesn't need to be re-explained.
export class AssistantContextDto {
  @IsOptional() @IsIn(['issue', 'rfi', 'snag_item'])
  currentResourceType?: 'issue' | 'rfi' | 'snag_item';

  @IsOptional() @IsUUID()
  currentResourceId?: string;
}

export class AskAssistantDto {
  @IsString() @MinLength(1) @MaxLength(2000)
  question: string;

  // Bounded (max 6 items -- about 3 turns -- enforced again server-side via
  // ai.maxConversationTurns in ai.service.ts, this is just the hard DTO
  // ceiling) -- the old DTO let a client send an unbounded array.
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ConversationMessageDto)
  conversationHistory?: ConversationMessageDto[];

  @IsOptional() @ValidateNested() @Type(() => AssistantContextDto)
  context?: AssistantContextDto;
}
