import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { RfiDiscipline } from '@engineeringos/types';
import { RFI_DISCIPLINES, RFI_DISCIPLINE_LABELS, RFI_ORIGINS, RFI_ORIGIN_LABELS } from '@engineeringos/types';
import { Modal } from './ui/Modal';
import { RichTextEditor, isRichTextEmpty } from './ui/RichTextEditor';
import { createRfi, uploadRfiAttachment } from '../lib/rfis.api';
import { apiErrorMessage } from '../lib/api';
import { Listbox } from './ui/Listbox';

// For a DC backfilling an RFI that was actually raised and answered on
// another platform (Aconex, Procore, email) and just needs recording here
// for one unified register -- a lighter-weight form than RfiFormModal's
// (no cost/time/drawing-impact fields; this app didn't run that workflow,
// it's just logging the outcome), plus the one thing RfiFormModal has no
// use for: an optional response file, attached via the exact same
// presigned-upload flow RfiDetailPage's own attachment section uses.
export function UploadRfiModal({
  open, onClose, projectId,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
}) {
  const queryClient = useQueryClient();
  const [subject, setSubject] = useState('');
  const [question, setQuestion] = useState('');
  const [discipline, setDiscipline] = useState<RfiDiscipline | ''>('');
  const [disciplineOther, setDisciplineOther] = useState('');
  const [origin, setOrigin] = useState<typeof RFI_ORIGINS[number]>('aconex');
  const [originReference, setOriginReference] = useState('');
  const [status, setStatus] = useState<'open' | 'answered' | 'closed'>('answered');
  const [answer, setAnswer] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');

  function reset() {
    setSubject(''); setQuestion(''); setDiscipline(''); setDisciplineOther('');
    setOrigin('aconex'); setOriginReference(''); setStatus('answered'); setAnswer('');
    setFile(null); setError('');
  }

  const mutation = useMutation({
    mutationFn: async () => {
      if (!subject.trim()) throw new Error('Subject is required.');
      if (isRichTextEmpty(question)) throw new Error('A brief description of the question is required.');
      if (!discipline) throw new Error('Discipline is required.');
      if (discipline === 'other' && !disciplineOther.trim()) throw new Error('Please specify the discipline.');

      const rfi = await createRfi(projectId, {
        subject: subject.trim(),
        question,
        discipline,
        disciplineOther: discipline === 'other' ? disciplineOther.trim() : undefined,
        origin,
        originReference: originReference.trim() || undefined,
        initialStatus: status,
        answer: status !== 'open' && answer.trim() ? answer.trim() : undefined,
      });

      if (file) {
        await uploadRfiAttachment(projectId, rfi.id, file, { kind: 'response' });
      }
      return rfi;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rfis', projectId] });
      queryClient.invalidateQueries({ queryKey: ['rfi-summary', projectId] });
      reset();
      onClose();
    },
    onError: (err) => setError(apiErrorMessage(err)),
  });

  function handleClose() {
    reset();
    onClose();
  }

  return (
    <Modal open={open} onClose={handleClose} title="Upload RFI">
      <div className="space-y-4">
        <p className="text-xs text-ink-500">
          Log an RFI that was actually raised and answered through another system (Aconex, Procore, email) so it shows up in your register here too.
        </p>
        {error && <p className="field-error">{error}</p>}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="field-label" htmlFor="upload-origin">Received via *</label>
            <Listbox
              id="upload-origin"
              className="field-input"
              value={origin}
              onChange={(e) => setOrigin(e.target.value as typeof RFI_ORIGINS[number])}
            >
              {RFI_ORIGINS.filter((o) => o !== 'platform').map((o) => (
                <option key={o} value={o}>{RFI_ORIGIN_LABELS[o]}</option>
              ))}
            </Listbox>
          </div>
          <div>
            <label className="field-label" htmlFor="upload-reference">Their reference number</label>
            <input
              id="upload-reference"
              className="field-input"
              value={originReference}
              onChange={(e) => setOriginReference(e.target.value)}
              placeholder="e.g. ACX-RFI-0142"
            />
          </div>
        </div>

        <div>
          <label className="field-label" htmlFor="upload-subject">Subject *</label>
          <input id="upload-subject" className="field-input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="What is this RFI about?" />
        </div>

        <div>
          <div className="field-label">Question *</div>
          <RichTextEditor value={question} onChange={setQuestion} placeholder="What was asked…" />
        </div>

        <div>
          <label className="field-label" htmlFor="upload-discipline">Discipline *</label>
          <Listbox id="upload-discipline" className="field-input" value={discipline} onChange={(e) => setDiscipline(e.target.value as RfiDiscipline)}>
            <option value="">Select…</option>
            {RFI_DISCIPLINES.map((d) => (
              <option key={d} value={d}>{RFI_DISCIPLINE_LABELS[d]}</option>
            ))}
          </Listbox>
        </div>

        {discipline === 'other' && (
          <div>
            <label className="field-label" htmlFor="upload-discipline-other">Please specify *</label>
            <input id="upload-discipline-other" className="field-input" value={disciplineOther} onChange={(e) => setDisciplineOther(e.target.value)} />
          </div>
        )}

        <div className="pt-2 border-t border-base-600 space-y-4">
          <div>
            <label className="field-label" htmlFor="upload-status">Status</label>
            <Listbox id="upload-status" className="field-input" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
              <option value="open">Still awaiting a response</option>
              <option value="answered">Answered</option>
              <option value="closed">Closed</option>
            </Listbox>
          </div>

          {status !== 'open' && (
            <div>
              <label className="field-label" htmlFor="upload-answer">Answer / response</label>
              <textarea
                id="upload-answer"
                className="field-input min-h-[80px]"
                placeholder="What was the response…"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
              />
            </div>
          )}

          <div>
            <label className="field-label" htmlFor="upload-file">Response file</label>
            <input id="upload-file" type="file" className="field-input" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <button type="button" onClick={handleClose} className="btn-secondary flex-1" disabled={mutation.isPending}>Cancel</button>
          <button type="button" onClick={() => mutation.mutate()} className="btn-primary flex-1" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : 'Upload RFI'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
