import { useCallback, useEffect, useState } from 'react';
import { countByStatus, listQueuedCaptures, type QueuedCapture, type QueueStatus } from '../lib/db';
import { onSyncComplete, processQueue } from '../lib/sync';

export function useSyncQueue() {
  const [counts, setCounts] = useState(() => countByStatus());
  const [items, setItems] = useState<QueuedCapture[]>(() => listQueuedCaptures());
  const [isSyncing, setIsSyncing] = useState(false);

  const refresh = useCallback(() => {
    setCounts(countByStatus());
    setItems(listQueuedCaptures());
  }, []);

  useEffect(() => {
    refresh();
    const unsubscribe = onSyncComplete(() => refresh());
    return () => {
      unsubscribe();
    };
  }, [refresh]);

  const syncNow = useCallback(async () => {
    setIsSyncing(true);
    try {
      await processQueue();
    } finally {
      setIsSyncing(false);
      refresh();
    }
  }, [refresh]);

  return { counts, items, isSyncing, syncNow, refresh };
}

export function useQueueByStatus(status: QueueStatus) {
  const { items, ...rest } = useSyncQueue();
  return { items: items.filter((i) => i.status === status), ...rest };
}
