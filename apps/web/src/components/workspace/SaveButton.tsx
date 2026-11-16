import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listSaved, saveItem, unsaveItem, type RecordType } from '../../lib/workspace.api';
import { showToast } from '../../store/toast.store';

// Bookmark any record for later. Saved items are the caller's own list;
// saving doesn't change the record or tell anyone.
export function SaveButton({ itemType, itemId, className = 'btn-secondary' }: { itemType: RecordType; itemId: string; className?: string }) {
  const qc = useQueryClient();
  const saved = useQuery({ queryKey: ['me', 'saved'], queryFn: listSaved, staleTime: 60_000 });
  const isSaved = (saved.data ?? []).some((s) => s.itemType === itemType && s.itemId === itemId);
  const toggle = useMutation({
    mutationFn: () => (isSaved ? unsaveItem(itemType, itemId) : saveItem(itemType, itemId)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me', 'saved'] });
      showToast(isSaved ? 'Removed from saved items' : 'Saved for later', 'success');
    },
    onError: () => showToast("Couldn't update saved items", 'danger'),
  });
  return (
    <button type="button" onClick={() => toggle.mutate()} disabled={toggle.isPending || saved.isLoading} aria-pressed={isSaved} className={className}
      title={isSaved ? 'Remove from saved items' : 'Save for later'}>
      <svg aria-hidden="true" viewBox="0 0 24 24" className={`w-4 h-4 ${isSaved ? 'text-signal' : ''}`} fill={isSaved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
        <path d="M6 3h12v18l-6-4-6 4V3z" strokeLinejoin="round" />
      </svg>
      {isSaved ? 'Saved' : 'Save'}
    </button>
  );
}
