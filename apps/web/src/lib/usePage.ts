import { useState } from 'react';

// Page number for a server-paginated list (components/ui/Pagination.tsx).
// Goes back to page 1 whenever any value in `resetOn` (the list's filters)
// changes, so a narrower filter never leaves the user on a page past the
// end of the new results. The reset happens during render rather than in
// an effect, so the stale page is never fetched first.
export function usePage(resetOn: readonly unknown[]): [number, (page: number) => void] {
  const [page, setPage] = useState(1);
  const key = JSON.stringify(resetOn);
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    setLastKey(key);
    if (page !== 1) setPage(1);
  }
  return [page, setPage];
}
