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

// Real function-calling (owner request: "the assistant must understand the
// full word, part of it, a wrong spelling, like any AI model"). The old
// router (AiService's routeIntent()) picked tools by exact-keyword regex --
// it missed typos, partial words, and any phrasing it didn't anticipate,
// which is exactly what caused the repeated "I don't have enough
// information" complaints even when the right data existed. Each tool's
// name/description is handed to the model's native tool-calling support
// (every provider here has one) so the model's own NLU decides which tools
// apply, the same way "any AI model" would. No arguments are declared on
// these tools -- every one of AiToolsService's tool methods resolves its
// actual arguments (rfiId, issueId...) from AssistantContext/the frontend's
// "currently viewing X" context, never from model-supplied input -- so this
// is a selection decision only, not a full agentic tool-use loop.
export interface ToolDefinition {
  name: string;
  description: string;
}

export interface SelectedToolCall {
  name: string;
}

export interface SelectToolsResult {
  toolCalls: SelectedToolCall[];
  // Set only when the call to the provider itself could not be completed
  // (network error, auth failure, a model/endpoint with no tool-calling
  // support) -- distinct from the provider successfully deciding that no
  // tool applies to this question (toolCalls: [], failed: false/undefined).
  // AiService falls back to its own keyword router (routeIntent()) only
  // when this is true, so a genuine "no data tool needed" answer is never
  // clobbered by the fallback.
  failed?: boolean;
}

export interface AIProviderModelInfo {
  provider: string;
  model: string;
}

export interface ValidateConnectionResult {
  ok: boolean;
  error?: string;
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

  // See the ToolDefinition/SelectToolsResult header comment above. Never
  // throws -- a failed call resolves to { toolCalls: [], failed: true }, the
  // same "never throws, caller decides what a failure means" shape as
  // validateConnection(), since AiService needs to tell "call failed" apart
  // from "model decided nothing applies" to fall back correctly.
  selectTools(question: string, tools: ToolDefinition[]): Promise<SelectToolsResult>;

  getModelInfo(): AIProviderModelInfo;

  // A cheap, minimal call that only confirms the credentials/endpoint work
  // -- used by BYO AI's "Test Connection" (modules/ai-connections) and
  // nowhere in the main request path, so it's fine for this to cost a
  // trivial amount of the user's own provider quota (never
  // RealityCapture's). Never throws -- always resolves to a result object,
  // since a failed validation is an expected, user-facing outcome, not an
  // exceptional one.
  validateConnection(): Promise<ValidateConnectionResult>;
}
