import { apiGet, apiPost, apiPatch, apiDelete } from './api';

// The caller's own workspace (/me) and the project Command Center summary.
// The browser's time zone is sent along so a user who hasn't saved one in
// their preferences still gets "today" in their own zone.

export type Priority = 'critical' | 'high' | 'medium' | 'low';
export type WorkSource = 'task' | 'reminder' | 'issue' | 'rfi' | 'snag' | 'qaqc' | 'submittal' | 'inspection';
export type RecordType = 'issue' | 'rfi' | 'snag' | 'qaqc' | 'submittal' | 'inspection' | 'drawing' | 'task';

export function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

export interface WorkspacePreferences {
  timezone: string | null;
  clockFormat: '12h' | '24h' | 'auto';
  perspective: 'management' | 'engineer' | 'auto';
  defaultPerspective: 'management' | 'engineer';
}
export const getPreferences = () => apiGet<WorkspacePreferences>('/me/preferences');
export const updatePreferences = (body: Partial<Pick<WorkspacePreferences, 'timezone' | 'clockFormat' | 'perspective'>>) =>
  apiPatch<WorkspacePreferences>('/me/preferences', body);

export interface UserTask {
  id: string;
  kind: 'task' | 'reminder';
  title: string;
  description: string | null;
  notes: string | null;
  dueDate: string | null;
  dueTime: string | null;
  priority: Priority;
  status: 'todo' | 'in_progress' | 'done';
  completedAt: string | null;
  projectId: string | null;
  projectName: string | null;
  linkedType: RecordType | null;
  linkedId: string | null;
  createdAt: string;
  updatedAt: string;
}
export type UserTaskInput = Partial<Pick<UserTask, 'kind' | 'title' | 'description' | 'notes' | 'dueDate' | 'dueTime' | 'priority' | 'status' | 'projectId'>> & {
  linkedType?: RecordType | null;
  linkedId?: string | null;
};
export const listMyTasks = (q: { status?: string; kind?: string; projectId?: string } = {}) => apiGet<UserTask[]>('/me/tasks', { params: q });
export const createMyTask = (body: UserTaskInput & { title: string }) => apiPost<UserTask>('/me/tasks', body);
export const updateMyTask = (id: string, body: UserTaskInput) => apiPatch<UserTask>(`/me/tasks/${id}`, body);
export const deleteMyTask = (id: string) => apiDelete<{ id: string }>(`/me/tasks/${id}`);

export interface SavedItem {
  id: string;
  itemType: RecordType;
  itemId: string;
  label: string;
  note: string | null;
  projectId: string | null;
  projectName: string | null;
  recordType: string | null;
  createdAt: string;
}
export const listSaved = () => apiGet<SavedItem[]>('/me/saved');
export const saveItem = (itemType: RecordType, itemId: string, note?: string) => apiPost<SavedItem>('/me/saved', { itemType, itemId, note });
export const unsaveItem = (itemType: RecordType, itemId: string) => apiDelete(`/me/saved/${itemType}/${itemId}`);

export interface RankedItem {
  source: WorkSource;
  id: string;
  projectId: string | null;
  projectName: string | null;
  reference: string | null;
  title: string;
  status: string;
  priority: Priority | null;
  dueDate: string | null;
  dueTime: string | null;
  relation: 'assigned' | 'own' | 'awaiting_review' | 'awaiting_response';
  recordType?: string | null;
  score: number;
  dueState: 'overdue' | 'today' | 'tomorrow' | 'this_week' | 'later' | 'none';
  daysOverdue: number;
  reason: string;
  nextAction: string;
}
export interface PrioritiesResponse {
  timezone: string;
  today: string;
  generatedAt: string;
  total: number;
  counts: { overdue: number; dueToday: number };
  items: RankedItem[];
}
export const getPriorities = (projectId?: string, limit = 7) =>
  apiGet<PrioritiesResponse>('/me/priorities', { params: { projectId, limit, tz: browserTimeZone() } });

export interface WorkspaceResponse {
  timezone: string;
  today: string;
  assigned: RankedItem[];
  awaitingReview: RankedItem[];
  awaitingResponse: RankedItem[];
  dueToday: RankedItem[];
  overdue: RankedItem[];
  ownTasks: RankedItem[];
  recentlyAssigned: { source: 'issue'; id: string; projectId: string; reference: string | null; title: string; at: string }[];
}
export const getWorkspace = (projectId?: string) =>
  apiGet<WorkspaceResponse>('/me/workspace', { params: { projectId, tz: browserTimeZone() } });

export type AgendaCategory = 'my_tasks' | 'project_deadlines' | 'inspections' | 'reminders';
export interface AgendaItem {
  key: string;
  source: WorkSource;
  id: string;
  category: AgendaCategory;
  title: string;
  reference: string | null;
  date: string;
  time: string | null;
  status: string;
  priority: Priority | null;
  done: boolean;
  mine: boolean;
  projectId: string | null;
  projectName: string | null;
  recordType?: string | null;
}
export interface AgendaResponse { timezone: string; from: string; to: string; meetingsAvailable: boolean; items: AgendaItem[] }
export const getAgenda = (from: string, to: string, projectId?: string) =>
  apiGet<AgendaResponse>('/me/agenda', { params: { from, to, projectId, tz: browserTimeZone() } });

export interface SearchResult {
  type: 'project' | 'issue' | 'rfi' | 'snag' | 'qaqc' | 'drawing' | 'user' | 'task' | 'saved';
  id: string;
  projectId: string | null;
  projectName: string | null;
  reference: string | null;
  title: string;
  status: string | null;
  recordType: string | null;
}
export const searchEverything = (q: string) => apiGet<{ query: string; results: SearchResult[] }>('/me/search', { params: { q } });

export type AttentionClass = 'critical' | 'overdue' | 'due_soon' | 'pending' | 'info';
export interface AttentionItem {
  key: string;
  type: 'drawing' | 'rfi' | 'qaqc' | 'inspection' | 'submittal' | 'issue' | 'snag';
  id: string;
  reference: string | null;
  title: string;
  responsible: string | null;
  dueDate: string | null;
  since: string | null;
  priority: string | null;
  status: string;
  class: AttentionClass;
  label: string;
  recordType?: string | null;
}
export interface CommandCenterSummary {
  timezone: string;
  today: string;
  project: { id: string; name: string; code: string | null; status: string; location: string | null; lastUpdatedAt: string | null };
  kpis: {
    totalDrawings: number;
    drawingsUnderReview: number;
    pendingActions: number;
    overdueItems: number;
    documentCompliance: number | null;
    complianceBasis: { approved: number; known: number; minimum: number };
  };
  attention: { counts: Record<AttentionClass, number>; total: number; items: AttentionItem[] };
}
export const getCommandCenter = (projectId: string) =>
  apiGet<CommandCenterSummary>(`/projects/${projectId}/command-center`, { params: { tz: browserTimeZone() } });
