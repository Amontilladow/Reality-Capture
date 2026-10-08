import { IsString, IsIn, MinLength, MaxLength, IsUrl, ValidateIf } from 'class-validator';

export const BYO_AI_PROVIDERS = ['openai', 'anthropic', 'gemini', 'custom_openai_compatible', 'ollama'] as const;
export type ByoAiProvider = typeof BYO_AI_PROVIDERS[number];

export class ConnectAiProviderDto {
  @IsIn(BYO_AI_PROVIDERS)
  provider: ByoAiProvider;

  @IsString() @MinLength(1) @MaxLength(100)
  model: string;

  // Required for a self-hosted/enterprise endpoint; meaningless (and
  // ignored) for the three hosted providers, which each adapter already
  // knows the base URL for.
  @ValidateIf((dto: ConnectAiProviderDto) => dto.provider === 'custom_openai_compatible' || dto.provider === 'ollama')
  @IsUrl({ require_tld: false }) // require_tld: false allows http://localhost or an internal hostname
  baseUrl?: string;

  // Ollama commonly has no API key at all (local/self-hosted, no auth) --
  // every other provider requires one.
  @ValidateIf((dto: ConnectAiProviderDto) => dto.provider !== 'ollama')
  @IsString() @MinLength(1) @MaxLength(500)
  apiKey?: string;
}
