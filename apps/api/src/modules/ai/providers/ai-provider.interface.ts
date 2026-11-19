// The one seam the whole AI rebuild is built around (spec section 3/20):
// nothing outside modules/ai/providers/* may import a vendor SDK directly.
// Swapping providers means writing a new class that implements this
// interface and pointing ProviderFactory at it; the Gateway, domain
// guard, tools, usage tracking and frontend never change.
export interface AIMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface GenerateResponseInput {
  systemPrompt: string;
  messages: AIMessage[];
  maxTokens?: number;
  // Aborts the provider call; used by the streaming endpoint when the
  // browser disconnects mid-answer, so an abandoned answer stops costing
  // tokens.
  signal?: AbortSignal;
}

// One piece of a streamed answer: text as it is generated, then (when the
// provider reports it) a final usage chunk so token accounting still works.
export type StreamChunk =
  | { type: 'text'; text: string }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number };

// Every vendor SDK call gets an explicit bound. The SDK defaults are up to
// 10 minutes, which would let one slow provider hold an API request (and
// its DB/Redis resources) far past any useful answer.
export const AI_REQUEST_TIMEOUT_MS = 60_000;
export const AI_MAX_RETRIES = 2;

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
// router (AiService's routeIntent()) picked tools by exact-keyword regex;
// it missed typos, partial words, and any phrasing it didn't anticipate,
// which is exactly what caused the repeated "I don't have enough
// information" complaints even when the right data existed. Each tool's
// name/description is handed to the model's native tool-calling support
// (every provider here has one) so the model's own NLU decides which tools
// apply, the same way "any AI model" would. No arguments are declared on
// these tools; every one of AiToolsService's tool methods resolves its
// actual arguments (rfiId, issueId...) from AssistantContext/the frontend's
// "currently viewing X" context, never from model-supplied input; so this
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
  // support): distinct from the provider successfully deciding that no
  // tool applies to this question (toolCalls: [], failed: false/undefined).
  // AiService falls back to its own keyword router (routeIntent()) only
  // when this is true, so a real "no data tool needed" answer is never
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

  // Token-level streaming of the same answer generateResponse() returns,
  // consumed by POST /projects/:projectId/assistant/stream (Server-Sent
  // Events) so the Assistant shows text as it is generated.
  streamResponse(input: GenerateResponseInput): AsyncIterable<StreamChunk>;

  // Not used by the heuristic domain guard today (see domain-guard.service.ts;
  // the spec's example block/allow list is unambiguous enough for a
  // keyword-based first pass that costs zero provider quota), but part of
  // the interface so a future ambiguous-case fallback can call it without
  // widening AIProvider again.
  classifyRequest(question: string): Promise<ClassifyRequestResult>;

  // See the ToolDefinition/SelectToolsResult header comment above. Never
  // throws; a failed call resolves to { toolCalls: [], failed: true }, the
  // same "never throws, caller decides what a failure means" shape as
  // validateConnection(), since AiService needs to tell "call failed" apart
  // from "model decided nothing applies" to fall back correctly.
  selectTools(question: string, tools: ToolDefinition[]): Promise<SelectToolsResult>;

  getModelInfo(): AIProviderModelInfo;

  // A cheap, minimal call that only confirms the credentials/endpoint work;
  // used by BYO AI's "Test Connection" (modules/ai-connections) and
  // nowhere in the main request path, so it's fine for this to cost a
  // trivial amount of the user's own provider quota (never
  // RealityCapture's). Never throws; always resolves to a result object,
  // since a failed validation is an expected, user-facing outcome, not an
  // exceptional one.
  validateConnection(): Promise<ValidateConnectionResult>;
}
