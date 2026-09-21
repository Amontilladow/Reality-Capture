import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PROJECT_ORGANIZATION_SLOT_LABELS, RFI_DISCIPLINE_LABELS } from '@engineeringos/types';
import {
  getRfiExternalDetail, respondRfiExternal, reviewRfiExternal, commentRfiExternal,
} from '../lib/rfi-external-access.api';
import { apiErrorMessage } from '../lib/api';
import { formatDateTime, formatDeadline } from '../lib/issue-constants';

// Minimal, branded, full-bleed page for a stakeholder with no EngineeringOS
// account -- no sidebar, no navigation, nothing else on this app reachable
// from here. The token in the URL is the only credential; see
// rfi-external-access.controller.ts's public side for the endpoints this calls.
export default function RfiExternalPage() {
  const { token } = useParams<{ token: string }>();
  const queryClient = useQueryClient();
  const [answer, setAnswer] = useState('');
  const [rejectComment, setRejectComment] = useState('');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [commentBody, setCommentBody] = useState('');

  const detailQuery = useQuery({
    queryKey: ['rfi-external', token],
    queryFn: () => getRfiExternalDetail(token!),
    enabled: Boolean(token),
    retry: false,
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['rfi-external', token] });
  }

  const respondMutation = useMutation({
    mutationFn: () => respondRfiExternal(token!, answer),
    onSuccess: invalidate,
  });

  const reviewMutation = useMutation({
    mutationFn: (payload: { decision: 'approved' | 'rejected'; comment?: string }) => reviewRfiExternal(token!, payload),
    onSuccess: () => {
      setRejectOpen(false);
      setRejectComment('');
      invalidate();
    },
  });

  const commentMutation = useMutation({
    mutationFn: () => commentRfiExternal(token!, commentBody.trim()),
    onSuccess: () => {
      setCommentBody('');
      invalidate();
    },
  });

  return (
    <div className="min-h-screen bg-base-950 flex flex-col items-center px-4 py-10">
      <div className="w-full max-w-2xl">
        <div className="flex items-center gap-2 mb-8 justify-center">
          <svg viewBox="0 0 24 24" className="w-7 h-7" fill="none">
            <rect x="2" y="2" width="20" height="20" rx="2" stroke="#FF7A29" strokeWidth="1.5" />
            <path d="M2 8h20M8 2v20" stroke="#4FB6E8" strokeWidth="1" opacity="0.6" />
            <circle cx="8" cy="8" r="1.4" fill="#FF7A29" />
          </svg>
          <span className="font-semibold tracking-tight text-ink-100">EngineeringOS</span>
        </div>

        {detailQuery.isLoading && (
          <div className="panel tick-frame p-8 text-center text-sm text-ink-500">Loading…</div>
        )}

        {detailQuery.isError && <ExternalErrorPanel error={detailQuery.error} />}

        {detailQuery.data && (
          <div className="space-y-4">
            <div className="panel tick-frame p-6">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                {detailQuery.data.rfiNumber && <span className="badge bg-base-700 text-ink-500 font-mono">{detailQuery.data.rfiNumber}</span>}
                <span className="badge bg-base-600 text-ink-300">{PROJECT_ORGANIZATION_SLOT_LABELS[detailQuery.data.organizationSlot]}</span>
                {detailQuery.data.discipline && (
                  <span className="badge bg-base-700 text-ink-500">{RFI_DISCIPLINE_LABELS[detailQuery.data.discipline]}</span>
                )}
                {detailQuery.data.dueDate && (
                  <span className="ml-auto text-xs text-ink-500">Due {formatDeadline(detailQuery.data.dueDate)}</span>
                )}
              </div>
              <h1 className="text-lg font-semibold text-ink-100 mb-3">{detailQuery.data.subject}</h1>
              <div className="text-xs text-ink-500 mb-1">Question</div>
              <div className="text-sm text-ink-100 whitespace-pre-wrap mb-4">{detailQuery.data.question}</div>

              {detailQuery.data.attachments.length > 0 && (
                <div>
                  <div className="text-xs text-ink-500 mb-1.5">Attachments</div>
                  <ul className="space-y-1">
                    {detailQuery.data.attachments.map((a) => (
                      <li key={a.id} className="text-sm">
                        {a.attachmentReadUrl ? (
                          <a href={a.attachmentReadUrl} target="_blank" rel="noreferrer" className="text-blueprint hover:text-blueprint-hover underline">
                            {a.filename}
                          </a>
                        ) : (
                          <span className="text-ink-300">{a.filename}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {detailQuery.data.answer && (
                <div className="mt-4 pt-4 border-t border-base-600">
                  <div className="text-xs text-ink-500 mb-1">Response</div>
                  <div className="text-sm text-ink-100 whitespace-pre-wrap">{detailQuery.data.answer}</div>
                </div>
              )}

              {/* Same "closed by, as which party, when" summary shown on the
                  internal detail page -- historical RFIs with all four
                  fields null render nothing extra here. */}
              {detailQuery.data.status === 'closed' && detailQuery.data.closedAt && (
                <p className="text-xs text-ink-500 mt-3 pt-3 border-t border-base-600">
                  Closed by {detailQuery.data.closedByName ?? detailQuery.data.closedByExternalEmail ?? 'Unknown'}
                  {detailQuery.data.closedAsOrganizationSlot ? ` (${PROJECT_ORGANIZATION_SLOT_LABELS[detailQuery.data.closedAsOrganizationSlot]})` : ''}
                  {' on '}{formatDateTime(detailQuery.data.closedAt)}
                </p>
              )}
            </div>

            {detailQuery.data.action === 'respond' && (
              <div className="panel tick-frame p-6 space-y-3">
                <div className="field-label !mb-0">Your response</div>
                {respondMutation.isSuccess ? (
                  <p className="text-sm text-ok">Response submitted. Thank you.</p>
                ) : (
                  <>
                    <textarea
                      className="field-input min-h-[120px]"
                      placeholder="Write your formal response…"
                      value={answer}
                      onChange={(e) => setAnswer(e.target.value)}
                    />
                    {respondMutation.isError && <p className="field-error">{apiErrorMessage(respondMutation.error)}</p>}
                    <button
                      onClick={() => respondMutation.mutate()}
                      disabled={!answer.trim() || respondMutation.isPending}
                      className="btn-primary !px-4 !py-2 text-sm"
                    >
                      {respondMutation.isPending ? 'Submitting…' : 'Submit response'}
                    </button>
                  </>
                )}
              </div>
            )}

            {detailQuery.data.action === 'review' && (
              <div className="panel tick-frame p-6 space-y-3">
                <div className="field-label !mb-0">Review this response</div>
                {reviewMutation.isSuccess ? (
                  <p className="text-sm text-ok">Your decision has been recorded. Thank you.</p>
                ) : (
                  <>
                    {!rejectOpen ? (
                      <div className="flex gap-2">
                        <button
                          onClick={() => reviewMutation.mutate({ decision: 'approved' })}
                          disabled={reviewMutation.isPending}
                          className="btn-primary !px-4 !py-2 text-sm"
                        >
                          Approve
                        </button>
                        <button onClick={() => setRejectOpen(true)} className="btn-secondary !px-4 !py-2 text-sm">
                          Reject
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <textarea
                          className="field-input min-h-[80px]"
                          placeholder="Reason for rejection…"
                          value={rejectComment}
                          onChange={(e) => setRejectComment(e.target.value)}
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => reviewMutation.mutate({ decision: 'rejected', comment: rejectComment.trim() })}
                            disabled={!rejectComment.trim() || reviewMutation.isPending}
                            className="btn-primary !px-4 !py-2 text-sm"
                          >
                            {reviewMutation.isPending ? 'Submitting…' : 'Send back for clarification'}
                          </button>
                          <button onClick={() => setRejectOpen(false)} className="btn-ghost !px-3 !py-2 text-sm">Cancel</button>
                        </div>
                      </div>
                    )}
                    {reviewMutation.isError && <p className="field-error">{apiErrorMessage(reviewMutation.error)}</p>}
                  </>
                )}
              </div>
            )}

            <div className="panel tick-frame p-6 space-y-3">
              <div className="field-label !mb-0">Comments ({detailQuery.data.comments.length})</div>
              <div className="space-y-2">
                {detailQuery.data.comments.map((c) => (
                  <div key={c.id} className="bg-base-700/40 rounded px-3 py-2 text-sm">
                    <div className="flex items-center gap-2 text-xs text-ink-500 mb-1">
                      <span className="font-medium text-ink-300">{c.userName ?? 'Someone'}</span>
                      {c.organizationSlot && (
                        <span className="badge bg-base-600 text-ink-500">{PROJECT_ORGANIZATION_SLOT_LABELS[c.organizationSlot]}</span>
                      )}
                      <span className="ml-auto">{formatDateTime(c.createdAt)}</span>
                    </div>
                    <p className="text-ink-100 whitespace-pre-wrap">{c.body}</p>
                  </div>
                ))}
                {detailQuery.data.comments.length === 0 && <p className="text-sm text-ink-500">No comments yet.</p>}
              </div>
              <div className="flex gap-2">
                <input
                  className="field-input"
                  placeholder="Add a comment…"
                  value={commentBody}
                  onChange={(e) => setCommentBody(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && commentBody.trim()) commentMutation.mutate(); }}
                />
                <button
                  onClick={() => commentMutation.mutate()}
                  disabled={!commentBody.trim() || commentMutation.isPending}
                  className="btn-primary !px-4 shrink-0"
                >
                  Send
                </button>
              </div>
              {commentMutation.isError && <p className="field-error">{apiErrorMessage(commentMutation.error)}</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Distinguishes revoked/expired/invalid with the honest, specific messaging
// the task calls for, using the { code, message } shape every error on this
// codebase's endpoints already carries (see apiErrorMessage/ApiError).
function ExternalErrorPanel({ error }: { error: unknown }) {
  const message = apiErrorMessage(error);
  return (
    <div className="panel tick-frame p-8 text-center space-y-2">
      <p className="text-sm text-ink-100">{message}</p>
    </div>
  );
}
