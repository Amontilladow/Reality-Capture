import { useState, useRef, useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { PageHeader } from '../components/layout/PageHeader';
import { askAssistant, getAssistantQuota, type AssistantMessage, type AskAssistantResponse } from '../lib/assistant.api';
import { getProject, getMembers, getHierarchy } from '../lib/projects.api';
import { apiErrorMessage } from '../lib/api';
import { RfiFormModal } from '../components/RfiFormModal';
import { IssueFormModal } from '../components/issues/IssueFormModal';
import { SnagItemFormModal } from '../components/SnagItemFormModal';

interface ChatMessage extends AssistantMessage {
  blocked?: boolean;
  draft?: AskAssistantResponse['draft'];
}

export default function AssistantPage() {
  const { projectId } = useParams<{ projectId: string }>();
  // Set when this page is reached from "Ask AI about this" on an
  // issue/RFI detail view (spec section 18) -- a follow-up like "why is
  // this high risk?" then resolves against that specific record instead of
  // the user having to name it.
  const [searchParams] = useSearchParams();
  const currentResourceType = searchParams.get('resourceType') as 'issue' | 'rfi' | 'snag_item' | null;
  const currentResourceId = searchParams.get('resourceId');

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState('');
  const [error, setError] = useState('');
  const [rfiDraftOpen, setRfiDraftOpen] = useState(false);
  const [issueDraftOpen, setIssueDraftOpen] = useState(false);
  const [snagDraftOpen, setSnagDraftOpen] = useState(false);
  const [activeDraft, setActiveDraft] = useState<AskAssistantResponse['draft']>(undefined);
  const bottomRef = useRef<HTMLDivElement>(null);

  const projectQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId!),
    enabled: Boolean(projectId),
  });

  const membersQuery = useQuery({
    queryKey: ['members', projectId],
    queryFn: () => getMembers(projectId!),
    enabled: Boolean(projectId),
  });

  const hierarchyQuery = useQuery({
    queryKey: ['hierarchy', projectId],
    queryFn: () => getHierarchy(projectId!),
    enabled: Boolean(projectId),
  });

  const quotaQuery = useQuery({
    queryKey: ['assistant-quota', projectId],
    queryFn: () => getAssistantQuota(projectId!),
    enabled: Boolean(projectId),
  });

  const askMutation = useMutation({
    mutationFn: (q: string) => askAssistant(
      projectId!, q,
      messages.map(({ role, content }) => ({ role, content })),
      currentResourceType && currentResourceId ? { currentResourceType, currentResourceId } : undefined,
    ),
    onSuccess: (result, q) => {
      setMessages((prev) => [
        ...prev,
        { role: 'user', content: q },
        { role: 'assistant', content: result.answer, blocked: result.blocked, draft: result.draft },
      ]);
      setQuestion('');
      setError('');
      quotaQuery.refetch();
    },
    onError: (err) => setError(apiErrorMessage(err)),
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, askMutation.isPending]);

  function handleSend() {
    const q = question.trim();
    if (!q || askMutation.isPending) return;
    askMutation.mutate(q);
  }

  function openDraft(draft: AskAssistantResponse['draft']) {
    setActiveDraft(draft);
    if (draft?.type === 'rfi') setRfiDraftOpen(true);
    if (draft?.type === 'issue') setIssueDraftOpen(true);
    if (draft?.type === 'snag') setSnagDraftOpen(true);
  }

  if (!projectId) return null;

  const quota = quotaQuery.data;

  return (
    <>
      <PageHeader
        eyebrow={projectQuery.data?.name ?? 'Project'}
        title="AI Assistant"
        actions={quota && (
          <span className="text-xs text-ink-500 font-mono">
            {quota.dailyUsed} / {quota.dailyLimit} requests today
          </span>
        )}
      />

      <div className="p-6 flex flex-col h-[calc(100vh-140px)]">
        <div className="flex-1 overflow-y-auto space-y-4 pb-4">
          {messages.length === 0 && (
            <div className="tick-frame panel p-12 text-center text-sm text-ink-500">
              Ask about RFIs, issues, snagging, risk, progress, or documents on this project.
              {currentResourceType && currentResourceId && (
                <span className="block mt-1 text-xs">Currently looking at this {currentResourceType.replace('_', ' ')} -- follow-up questions can refer to it directly.</span>
              )}
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[75%] rounded-md px-4 py-2.5 text-sm ${
                m.role === 'user' ? 'bg-signal text-base-950' : m.blocked ? 'panel border-ink-500/40 text-ink-500' : 'panel'
              }`}>
                <p className="whitespace-pre-wrap">{m.content}</p>
                {m.draft && (
                  <button onClick={() => openDraft(m.draft)} className="btn-secondary !text-xs mt-2">
                    Review draft {m.draft.type === 'rfi' ? 'RFI' : m.draft.type === 'issue' ? 'issue' : 'snag item'}
                  </button>
                )}
              </div>
            </div>
          ))}

          {askMutation.isPending && (
            <div className="flex justify-start">
              <div className="panel px-4 py-2.5 text-sm text-ink-500">Thinking…</div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {error && <p className="field-error mb-2">{error}</p>}

        <div className="flex gap-2 pt-3 border-t border-base-600">
          <input
            className="field-input flex-1"
            placeholder="Ask a question about this project…"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            disabled={askMutation.isPending}
          />
          <button onClick={handleSend} className="btn-primary" disabled={askMutation.isPending || !question.trim()}>
            Send
          </button>
        </div>
      </div>

      {activeDraft?.type === 'rfi' && (
        <RfiFormModal
          open={rfiDraftOpen}
          onClose={() => setRfiDraftOpen(false)}
          projectId={projectId}
          members={membersQuery.data ?? []}
          initialValues={activeDraft.fields}
        />
      )}
      {activeDraft?.type === 'issue' && (
        <IssueFormModal
          open={issueDraftOpen}
          onClose={() => setIssueDraftOpen(false)}
          projectId={projectId}
          members={membersQuery.data ?? []}
          hierarchy={hierarchyQuery.data ?? []}
          draftValues={activeDraft.fields}
        />
      )}
      {activeDraft?.type === 'snag' && (
        <SnagItemFormModal
          open={snagDraftOpen}
          onClose={() => setSnagDraftOpen(false)}
          projectId={projectId}
          members={membersQuery.data ?? []}
          hierarchy={hierarchyQuery.data ?? []}
          draftValues={activeDraft.fields}
        />
      )}
    </>
  );
}
