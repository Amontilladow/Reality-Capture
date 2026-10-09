import { Modal } from './ui/Modal';
import { EmailHistoryList } from './EmailHistoryList';

// Phase 3G: the general, unfiltered project communication log (no single
// related record) -- the per-record filtered view lives inline on each
// RFI/Issue/Submittal/Snag page instead of a modal, since it's already in
// context there.
export function EmailHistoryModal({ open, onClose, projectId }: { open: boolean; onClose: () => void; projectId: string }) {
  return (
    <Modal open={open} onClose={onClose} title="Email History" wide>
      <EmailHistoryList projectId={projectId} />
    </Modal>
  );
}
