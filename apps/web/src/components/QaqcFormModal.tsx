import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  RFI_DISCIPLINES, RFI_DISCIPLINE_LABELS, RFI_DOCUMENT_TYPES, RFI_DOCUMENT_TYPE_LABELS,
  type RfiDiscipline, type RfiDocumentType,
} from '@engineeringos/types';
import { Modal } from './ui/Modal';
import { createQaqcRecord, uploadQaqcAttachment, linkQaqcCapture, type QaqcRecordType, type QaqcPriority } from '../lib/qaqc.api';
import { uploadCapture } from '../lib/captures.api';
import { QAQC_PRIORITIES, QAQC_PRIORITY_LABELS, QAQC_RECORD_TYPE_LABELS, QAQC_RECORD_TYPE_SHORT_LABELS } from '../lib/qaqc-constants';
import type { ProjectMember } from '../lib/projects.api';
import { apiErrorMessage } from '../lib/api';
import { Listbox } from './ui/Listbox';

// Field set deliberately mirrors RfiFormModal's "subject/question(->description)/
// priority/discipline+disciplineOther/assignedTo/dueDate" shape -- see
// create-qaqc-record.dto.ts's own comment for why RFI's cost/time/
// drawing-impact fields have no equivalent here.
//
// Two distinct attachment affordances, per the brief's §4 -- NOT the same
// control:
// - "+ Add photo" mirrors IssueFormModal.tsx's pattern exactly: picked
//   locally before the record exists, uploaded as a real Capture
//   (captureType: 'photo_standard') and linked once the record is created,
//   so it also shows up in the project's Captures grid.
// - "+ Add document" mirrors RFI's AttachmentSection/documentType pattern:
//   a generic typed-document upload (method statements, test certificates,
//   specs, etc.), stored as a qaqc_attachments row.
export function QaqcFormModal({
  open, onClose, projectId, recordType, members,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  recordType: QaqcRecordType;
  members: ProjectMember[];
}) {
  const queryClient = useQueryClient();
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<QaqcPriority>('medium');
  const [discipline, setDiscipline] = useState<RfiDiscipline | ''>('');
  const [disciplineOther, setDisciplineOther] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [error, setError] = useState('');

  // "+ Add photo" -- same local-pick-then-upload-as-Capture shape as
  // IssueFormModal.tsx's own `photos` state.
  const [photos, setPhotos] = useState<{ file: File; previewUrl: string }[]>([]);
  const photoInputRef = useRef<HTMLInputElement>(null);

  // "+ Add document" -- generic typed attachments, picked locally the same
  // way (the record doesn't exist yet either), uploaded via
  // uploadQaqcAttachment() with a documentType once it does.
  const [documents, setDocuments] = useState<{ file: File; documentType: RfiDocumentType }[]>([]);
  const [pendingDocumentType, setPendingDocumentType] = useState<RfiDocumentType>('other');
  const documentInputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setSubject(''); setDescription(''); setPriority('medium');
    setDiscipline(''); setDisciplineOther('');
    setAssignedTo(''); setDueDate(''); setError('');
    setPhotos((prev) => { prev.forEach((p) => URL.revokeObjectURL(p.previewUrl)); return []; });
    setDocuments([]);
    setPendingDocumentType('other');
  }

  const mutation = useMutation({
    mutationFn: async () => {
      if (!subject.trim()) throw new Error('Subject is required.');
      if (!description.trim()) throw new Error('Description is required.');
      if (!discipline) throw new Error('Discipline is required.');
      if (discipline === 'other' && !disciplineOther.trim()) throw new Error('Please specify the discipline.');

      const created = await createQaqcRecord(projectId, {
        recordType,
        subject: subject.trim(),
        description: description.trim(),
        priority,
        discipline,
        disciplineOther: discipline === 'other' ? disciplineOther.trim() : undefined,
        assignedTo: assignedTo || undefined,
        dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
      });

      // Sequential, not parallel, same rationale as IssueFormModal's own
      // upload loop -- one failed upload doesn't race the others.
      for (const { file } of photos) {
        const capture = await uploadCapture(projectId, file, {
          captureType: 'photo_standard',
          title: `Evidence: ${subject.trim()}`,
        });
        await linkQaqcCapture(projectId, created.id, capture.id, 'issue');
      }
      for (const { file, documentType } of documents) {
        await uploadQaqcAttachment(projectId, created.id, file, { kind: 'issue', documentType });
      }

      return created;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['qaqc-records', projectId] });
      queryClient.invalidateQueries({ queryKey: ['qaqc-summary', projectId] });
      if (photos.length > 0) queryClient.invalidateQueries({ queryKey: ['captures', projectId] });
      reset();
      onClose();
    },
    onError: (err) => setError(apiErrorMessage(err)),
  });

  function handleClose() {
    reset();
    onClose();
  }

  const shortLabel = QAQC_RECORD_TYPE_SHORT_LABELS[recordType];

  return (
    <Modal open={open} onClose={handleClose} title={`New ${shortLabel}`}>
      <div className="space-y-4">
        <p className="text-xs text-ink-500">{QAQC_RECORD_TYPE_LABELS[recordType]}</p>
        {error && <p className="field-error">{error}</p>}

        <div>
          <label className="field-label" htmlFor="qaqc-subject">Subject *</label>
          <input id="qaqc-subject" className="field-input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={`What is this ${shortLabel} about?`} />
        </div>

        <div>
          <label className="field-label" htmlFor="qaqc-description">Description *</label>
          <textarea
            id="qaqc-description"
            className="field-input min-h-[96px]"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={recordType === 'ncr' ? 'Describe the non-conformance…' : recordType === 'sor' ? 'Describe the observation…' : 'Describe the inspection request…'}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="field-label" htmlFor="qaqc-priority">Priority</label>
            <Listbox id="qaqc-priority" className="field-input" value={priority} onChange={(e) => setPriority(e.target.value as QaqcPriority)}>
              {QAQC_PRIORITIES.map((p) => (
                <option key={p} value={p}>{QAQC_PRIORITY_LABELS[p]}</option>
              ))}
            </Listbox>
          </div>
          <div>
            <label className="field-label" htmlFor="qaqc-dueDate">Due date</label>
            <input id="qaqc-dueDate" type="date" className="field-input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="field-label" htmlFor="qaqc-assignedTo">Assignee</label>
            <Listbox id="qaqc-assignedTo" className="field-input" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>{[m.firstName, m.lastName].filter(Boolean).join(' ') || m.email}</option>
              ))}
            </Listbox>
          </div>
          <div>
            <label className="field-label" htmlFor="qaqc-discipline">Discipline *</label>
            <Listbox id="qaqc-discipline" className="field-input" value={discipline} onChange={(e) => setDiscipline(e.target.value as RfiDiscipline)}>
              <option value="">Select…</option>
              {RFI_DISCIPLINES.map((d) => (
                <option key={d} value={d}>{RFI_DISCIPLINE_LABELS[d]}</option>
              ))}
            </Listbox>
          </div>
        </div>

        {discipline === 'other' && (
          <div>
            <label className="field-label" htmlFor="qaqc-disciplineOther">Please specify *</label>
            <input id="qaqc-disciplineOther" className="field-input" value={disciplineOther} onChange={(e) => setDisciplineOther(e.target.value)} />
          </div>
        )}

        {/* "+ Add photo" -- quick picker, uploaded as a real Capture on save. */}
        <div className="pt-2 border-t border-base-600">
          <div className="flex items-center justify-between">
            <label className="field-label !mb-0">Photos {photos.length > 0 ? `(${photos.length})` : ''}</label>
            <button
              type="button"
              className="text-xs text-accent-400 hover:text-accent-300"
              onClick={() => photoInputRef.current?.click()}
              disabled={mutation.isPending}
            >
              + Add photo
            </button>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              // No `capture` attribute -- forcing the camera directly would
              // leave no option to pick an existing photo from the library.
              multiple
              className="hidden"
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? []).map((file) => ({ file, previewUrl: URL.createObjectURL(file) }));
                if (picked.length > 0) setPhotos((prev) => [...prev, ...picked]);
                e.target.value = '';
              }}
            />
          </div>
          {photos.length === 0 && (
            <p className="text-xs text-ink-500 mt-2">Optional -- quick evidence photos. They'll also appear in the project's Captures tab.</p>
          )}
          {photos.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {photos.map(({ file, previewUrl }, i) => (
                <div key={`${file.name}-${i}`} className="relative w-16 h-16 rounded overflow-hidden border border-base-600 shrink-0">
                  <img src={previewUrl} alt={file.name} className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setPhotos((prev) => {
                      URL.revokeObjectURL(prev[i].previewUrl);
                      return prev.filter((_, idx) => idx !== i);
                    })}
                    disabled={mutation.isPending}
                    className="absolute top-0 right-0 bg-base-900/80 text-ink-100 text-xs leading-none w-5 h-5 flex items-center justify-center rounded-bl"
                    aria-label={`Remove ${file.name}`}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* "+ Add document" -- generic typed attachment, in case additional
            supporting documents are needed (method statements, test
            certificates, specs, etc.) -- a distinct control from the photo
            picker above, not the same uploader. */}
        <div>
          <div className="flex items-center justify-between">
            <label className="field-label !mb-0">Documents {documents.length > 0 ? `(${documents.length})` : ''}</label>
          </div>
          <div className="flex items-center gap-2 mt-2">
            <Listbox aria-label="Document type"
              className="field-input w-auto !py-2 text-xs"
              value={pendingDocumentType}
              onChange={(e) => setPendingDocumentType(e.target.value as RfiDocumentType)}
            >
              {RFI_DOCUMENT_TYPES.map((t) => (
                <option key={t} value={t}>{RFI_DOCUMENT_TYPE_LABELS[t]}</option>
              ))}
            </Listbox>
            <button
              type="button"
              className="btn-secondary !px-4 !py-2 text-xs"
              onClick={() => documentInputRef.current?.click()}
              disabled={mutation.isPending}
            >
              + Add document
            </button>
            <input
              ref={documentInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? []).map((file) => ({ file, documentType: pendingDocumentType }));
                if (picked.length > 0) setDocuments((prev) => [...prev, ...picked]);
                e.target.value = '';
              }}
            />
          </div>
          {documents.length === 0 && (
            <p className="text-xs text-ink-500 mt-2">Optional -- method statements, test certificates, specs, or other supporting documents.</p>
          )}
          {documents.length > 0 && (
            <div className="space-y-2 mt-2">
              {documents.map(({ file, documentType }, i) => (
                <div key={`${file.name}-${i}`} className="flex items-center justify-between text-xs bg-base-700/40 rounded px-2 py-2">
                  <span className="text-ink-300">{file.name} <span className="text-ink-500">({RFI_DOCUMENT_TYPE_LABELS[documentType]})</span></span>
                  <button
                    type="button"
                    onClick={() => setDocuments((prev) => prev.filter((_, idx) => idx !== i))}
                    disabled={mutation.isPending}
                    className="text-danger hover:text-danger/80"
                    aria-label={`Remove ${file.name}`}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-2 pt-2">
          <button type="button" onClick={handleClose} className="btn-secondary flex-1" disabled={mutation.isPending}>Cancel</button>
          <button type="button" onClick={() => mutation.mutate()} className="btn-primary flex-1" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : `Create ${shortLabel}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
