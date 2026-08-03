import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { DocType } from '@engineeringos/types';
import { Modal } from './ui/Modal';
import { uploadDocumentFile, createDocument } from '../lib/documents.api';
import { DOC_TYPES, DOC_TYPE_LABELS } from '../lib/document-constants';
import { apiErrorMessage } from '../lib/api';

export function DocumentUploadModal({
  open, onClose, projectId,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
}) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'file' | 'link'>('file');
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [docType, setDocType] = useState<DocType>('drawing');
  const [documentNumber, setDocumentNumber] = useState('');
  const [revision, setRevision] = useState('');
  const [externalUrl, setExternalUrl] = useState('');
  const [error, setError] = useState('');

  function reset() {
    setMode('file'); setFile(null); setTitle(''); setDocType('drawing');
    setDocumentNumber(''); setRevision(''); setExternalUrl(''); setError('');
  }

  const mutation = useMutation({
    mutationFn: async () => {
      if (!title.trim()) throw new Error('Title is required.');
      const meta = {
        title: title.trim(),
        docType,
        documentNumber: documentNumber || undefined,
        revision: revision || undefined,
      };
      if (mode === 'file') {
        if (!file) throw new Error('Choose a file to upload.');
        return uploadDocumentFile(projectId, file, meta);
      }
      if (!externalUrl.trim()) throw new Error('Enter a link.');
      return createDocument(projectId, { ...meta, source: 'manual_link', externalUrl: externalUrl.trim() });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents', projectId] });
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
    <Modal open={open} onClose={handleClose} title="Add document">
      <div className="space-y-4">
        {error && <p className="field-error">{error}</p>}

        <div className="flex gap-2 text-xs">
          <button
            type="button"
            onClick={() => setMode('file')}
            className={`flex-1 px-3 py-2 rounded border ${mode === 'file' ? 'border-signal text-signal bg-signal/10' : 'border-base-600 text-ink-500'}`}
          >
            Upload a file
          </button>
          <button
            type="button"
            onClick={() => setMode('link')}
            className={`flex-1 px-3 py-2 rounded border ${mode === 'link' ? 'border-signal text-signal bg-signal/10' : 'border-base-600 text-ink-500'}`}
          >
            Link an external doc
          </button>
        </div>

        {mode === 'file' ? (
          <div>
            <label className="field-label" htmlFor="file">File</label>
            <input
              id="file"
              type="file"
              className="field-input"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ''));
              }}
            />
          </div>
        ) : (
          <div>
            <label className="field-label" htmlFor="externalUrl">Link</label>
            <input
              id="externalUrl"
              className="field-input"
              placeholder="https://…"
              value={externalUrl}
              onChange={(e) => setExternalUrl(e.target.value)}
            />
          </div>
        )}

        <div>
          <label className="field-label" htmlFor="title">Title *</label>
          <input id="title" className="field-input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label" htmlFor="docType">Type</label>
            <select id="docType" className="field-input" value={docType} onChange={(e) => setDocType(e.target.value as DocType)}>
              {DOC_TYPES.map((t) => (
                <option key={t} value={t}>{DOC_TYPE_LABELS[t]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="revision">Revision</label>
            <input id="revision" className="field-input" value={revision} onChange={(e) => setRevision(e.target.value)} placeholder="Rev C" />
          </div>
        </div>

        <div>
          <label className="field-label" htmlFor="documentNumber">Document number</label>
          <input id="documentNumber" className="field-input" value={documentNumber} onChange={(e) => setDocumentNumber(e.target.value)} />
        </div>

        <div className="flex gap-2 pt-2">
          <button type="button" onClick={handleClose} className="btn-secondary flex-1" disabled={mutation.isPending}>Cancel</button>
          <button type="button" onClick={() => mutation.mutate()} className="btn-primary flex-1" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : 'Add document'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
