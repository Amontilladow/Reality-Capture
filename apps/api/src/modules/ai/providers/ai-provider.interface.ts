// The one seam the whole AI rebuild is built around (spec section 3/20):
// nothing outside modules/ai/providers/* may import a vendor SDK directly.
// Swapping providers means writing a new class that implements this
// interface and pointing ProviderFactory at it -- the Gateway, domain
// guard, tools, usage tracking and frontend never change.
export interface AIMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface GenerateResponseInput {
  systemPrompt: string;
  messages: AIMessage[];
  maxTokens?: number;
}

export interface GenerateResponseResult {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface ClassifyRequestResult {
  inDomain: boolean;
  reason?: string;
}

export interface AIProviderModelInfo {
  provider: string;
  model: string;
}

export interface AIProvider {
  generateResponse(input: GenerateResponseInput): Promise<GenerateResponseResult>;

  // Declared per spec section 3's interface list. The Gateway/frontend don't
  // consume this yet (Known limitations, final report) -- real token-level
  // streaming needs an SSE/WebSocket round trip the current AssistantPage
  // doesn't have, which is real scope beyond this pass. Each adapter below
  // implements it as a single-chunk wrapper over generateResponse() so the
  // interface is honestly satisfiable today and swappable to real streaming
  // later without changing this contract.
  streamResponse(input: GenerateResponseInput): AsyncIterable<string>;

  // Not used by the heuristic domain guard today (see domain-guard.service.ts
  // -- the spec's example block/allow list is unambiguous enough for a
  // keyword-based first pass that costs zero provider quota), but part of
  // the interface so a future ambiguous-case fallback can call it without
  // widening AIProvider again.
  classifyRequest(question: string): Promise<ClassifyRequestResult>;

  getModelInfo(): AIProviderModelInfo;
}
