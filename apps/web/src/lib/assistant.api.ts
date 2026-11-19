import type { RfiDiscipline, RfiPriority, IssueType, IssuePriority, IssueDiscipline, SnagPriority } from '@engineeringos/types';
import { API_BASE, apiGet, apiPost, refreshAccessToken } from './api';
import { useAuthStore } from '../store/auth.store';

export interface AssistantMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AssistantResourceContext {
  currentResourceType?: 'issue' | 'rfi' | 'snag_item';
  currentResourceId?: string;
}

export interface RfiDraftFields {
  subject: string;
  question: string;
  discipline: RfiDiscipline;
  priority: RfiPriority;
}

export interface IssueDraftFields {
  title: string;
  description: string;
  discipline: IssueDiscipline;
  priority: IssuePriority;
  issueType: IssueType;
  deadline: string;
}

export interface SnagDraftFields {
  title: string;
  description: string;
  trade: string;
  priority: SnagPriority;
  dueDate: string;
}

export interface AskAssistantResponse {
  answer: string;
  blocked?: boolean;
  draft?: { type: 'rfi'; fields: RfiDraftFields } | { type: 'issue'; fields: IssueDraftFields } | { type: 'snag'; fields: SnagDraftFields };
  toolsUsed: string[];
  remainingQuota: { dailyUsed: number; dailyLimit: number };
}

export function askAssistant(
  projectId: string,
  question: string,
  conversationHistory?: AssistantMessage[],
  context?: AssistantResourceContext,
) {
  return apiPost<AskAssistantResponse>(`/projects/${projectId}/assistant`, {
    question,
    conversationHistory: conversationHistory ?? undefined,
    context: context?.currentResourceType ? context : undefined,
  });
}

export interface SseEvent {
  event: string;
  data: string;
}

// Incremental Server-Sent Events parser: feed it decoded text as it
// arrives, get back every complete event (frames end in a blank line). Any
// trailing partial frame is kept until the next call.
export function createSseParser() {
  let buffer = '';
  return (text: string): SseEvent[] => {
    buffer += text.replace(/\r\n/g, '\n');
    const events: SseEvent[] = [];
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      let event = 'message';
      const data: string[] = [];
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      if (data.length > 0) events.push({ event, data: data.join('\n') });
    }
    return events;
  };
}

// Same question/answer as askAssistant(), but the answer text arrives
// through `onDelta` while the model is still generating it (POST
// /assistant/stream, Server-Sent Events). Uses fetch rather than axios,
// which can't expose a response body incrementally in the browser.
// Resolves with the same AskAssistantResponse once the stream finishes.
export async function askAssistantStream(
  projectId: string,
  question: string,
  conversationHistory: AssistantMessage[] | undefined,
  context: AssistantResourceContext | undefined,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<AskAssistantResponse> {
  const body = JSON.stringify({
    question,
    conversationHistory: conversationHistory ?? undefined,
    context: context?.currentResourceType ? context : undefined,
  });
  const post = (token: string | null) => fetch(`${API_BASE}/projects/${projectId}/assistant/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body,
    signal,
  });

  let res = await post(useAuthStore.getState().accessToken);
  if (res.status === 401) {
    const fresh = await refreshAccessToken();
    if (fresh) res = await post(fresh);
  }
  // An API deployed before the streaming endpoint existed: fall back to the
  // plain request so the Assistant keeps working during a rolling deploy.
  if (res.status === 404) {
    return askAssistant(projectId, question, conversationHistory, context);
  }
  if (!res.ok || !res.body) {
    let message = `Request failed (${res.status})`;
    try {
      const json = await res.json() as { error?: { message?: string } };
      if (json.error?.message) message = json.error.message;
    } catch { /* non-JSON error body */ }
    throw new Error(message);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parse = createSseParser();
  for (;;) {
    const { value, done } = await reader.read();
    const events = parse(done ? decoder.decode() + '\n\n' : decoder.decode(value, { stream: true }));
    for (const e of events) {
      if (e.event === 'delta') onDelta((JSON.parse(e.data) as { text: string }).text);
      else if (e.event === 'done') return JSON.parse(e.data) as AskAssistantResponse;
      else if (e.event === 'error') throw new Error((JSON.parse(e.data) as { message?: string }).message ?? 'The AI assistant is temporarily unavailable.');
    }
    if (done) throw new Error('The answer was interrupted. Please try again.');
  }
}

export function getAssistantQuota(projectId: string) {
  return apiGet<{ dailyUsed: number; dailyLimit: number }>(`/projects/${projectId}/assistant/quota`);
}
