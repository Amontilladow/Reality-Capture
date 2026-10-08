import type { RfiDiscipline, RfiPriority, IssueType, IssuePriority, IssueDiscipline, SnagPriority } from '@engineeringos/types';
import { apiGet, apiPost } from './api';

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

export function getAssistantQuota(projectId: string) {
  return apiGet<{ dailyUsed: number; dailyLimit: number }>(`/projects/${projectId}/assistant/quota`);
}
