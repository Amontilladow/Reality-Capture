import { apiPost } from './api';

export interface AssistantSource {
  resource_type: string;
  resource_id: string;
  score: number;
}

export interface AssistantMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AskAssistantResponse {
  answer: string;
  sources: AssistantSource[];
}

export function askAssistant(projectId: string, question: string, conversationHistory?: AssistantMessage[]) {
  return apiPost<AskAssistantResponse>(`/projects/${projectId}/assistant`, {
    question,
    conversationHistory: conversationHistory ?? undefined,
  });
}
