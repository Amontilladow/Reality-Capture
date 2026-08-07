import { useState, useRef, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { PageHeader } from '../components/layout/PageHeader';
import { askAssistant, type AssistantMessage, type AssistantSource } from '../lib/assistant.api';
import { getProject } from '../lib/projects.api';
import { apiErrorMessage } from '../lib/api';

interface ChatMessage extends AssistantMessage {
  sources?: AssistantSource[];
}

export default function AssistantPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState('');
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const projectQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId!),
    enabled: Boolean(projectId),
  });

  const askMutation = useMutation({
    mutationFn: (q: string) => askAssistant(projectId!, q, messages.map(({ role, content }) => ({ role, content }))),
    onSuccess: (result, q) => {
      setMessages((prev) => [...prev, { role: 'user', content: q }, { role: 'assistant', content: result.answer, sources: result.sources }]);
      setQuestion('');
      setError('');
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

  if (!projectId) return null;

  return (
    <>
      <PageHeader eyebrow={projectQuery.data?.name ?? 'Project'} title="AI Assistant" />

      <div className="p-6 flex flex-col h-[calc(100vh-140px)]">
        <div className="flex-1 overflow-y-auto space-y-4 pb-4">
          {messages.length === 0 && (
            <div className="tick-frame panel p-12 text-center text-sm text-ink-500">
              Ask about issues, captures, RFIs, or anything else logged on this project. Answers are grounded in this project's own data and cite their sources.
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[75%] rounded-md px-4 py-2.5 text-sm ${m.role === 'user' ? 'bg-signal text-base-950' : 'panel'}`}>
                <p className="whitespace-pre-wrap">{m.content}</p>
                {m.sources && m.sources.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-base-600/40 flex flex-wrap gap-1.5">
                    {m.sources.map((s, j) => (
                      <span key={j} className="badge bg-base-700 text-ink-500 !text-[10px]">
                        {s.resource_type.toUpperCase()} · {s.score.toFixed(2)}
                      </span>
                    ))}
                  </div>
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
    </>
  );
}
