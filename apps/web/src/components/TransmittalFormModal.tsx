import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { TransmittalPurpose } from '@engineeringos/types';
import { Modal } from './ui/Modal';
import { createTransmittal } from '../lib/transmittals.api';
import { TRANSMITTAL_PURPOSES, TRANSMITTAL_PURPOSE_LABELS } from '../lib/transmittal-constants';
import { apiErrorMessage } from '../lib/api';

export function TransmittalFormModal({
  open, onClose, projectId,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
}) {
  const queryClient = useQueryClient();
  const [subject, setSubject] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [recipientCompany, setRecipientCompany] = useState('');
  const [purpose, setPurpose] = useState<TransmittalPurpose>('for_review');
  const [items, setItems] = useState('');
  const [notes, setNotes] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [error, setError] = useState('');

  function reset() {
    setSubject(''); setRecipientName(''); setRecipientCompany(''); setPurpose('for_review');
    setItems(''); setNotes(''); setDueDate(''); setError('');
  }

  const mutation = useMutation({
    mutationFn: () => {
      if (!subject.trim()) throw new Error('Subject is required.');
      if (!recipientName.trim()) throw new Error('Recipient is required.');
      if (!items.trim()) throw new Error('List what this transmittal contains.');
      return createTransmittal(projectId, {
        subject: subject.trim(),
        recipientName: recipientName.trim(),
        recipientCompany: recipientCompany || undefined,
        purpose,
        items: items.trim(),
        notes: notes || undefined,
        dueDate: dueDate ? new Date(dueDate).toISOString() : undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transmittals', projectId] });
      queryClient.invalidateQueries({ queryKey: ['transmittal-summary', projectId] });
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
    <Modal open={open} onClose={handleClose} title="New transmittal">
      <div className="space-y-4">
        {error && <p className="field-error">{error}</p>}

        <div>
          <label className="field-label" htmlFor="subject">Subject *</label>
          <input id="subject" className="field-input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Structural drawings for permit review" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label" htmlFor="recipientName">Recipient *</label>
            <input id="recipientName" className="field-input" value={recipientName} onChange={(e) => setRecipientName(e.target.value)} placeholder="Jane Doe" />
          </div>
          <div>
            <label className="field-label" htmlFor="recipientCompany">Recipient company</label>
            <input id="recipientCompany" className="field-input" value={recipientCompany} onChange={(e) => setRecipientCompany(e.target.value)} placeholder="Acme Engineering" />
          </div>
        </div>

        <div>
          <label className="field-label" htmlFor="items">Items included *</label>
          <textarea id="items" className="field-input min-h-[72px]" value={items} onChange={(e) => setItems(e.target.value)} placeholder={'One per line, e.g.\nA-101 Rev C — Floor Plan\nS-201 Rev A — Foundation Plan'} />
        </div>

        <div>
          <label className="field-label" htmlFor="notes">Notes</label>
          <textarea id="notes" className="field-input min-h-[56px]" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label" htmlFor="purpose">Purpose</label>
            <select id="purpose" className="field-input" value={purpose} onChange={(e) => setPurpose(e.target.value as TransmittalPurpose)}>
              {TRANSMITTAL_PURPOSES.map((p) => (
                <option key={p} value={p}>{TRANSMITTAL_PURPOSE_LABELS[p]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="dueDate">Response due</label>
            <input id="dueDate" type="date" className="field-input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <button type="button" onClick={handleClose} className="btn-secondary flex-1" disabled={mutation.isPending}>Cancel</button>
          <button type="button" onClick={() => mutation.mutate()} className="btn-primary flex-1" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : 'Create transmittal'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
