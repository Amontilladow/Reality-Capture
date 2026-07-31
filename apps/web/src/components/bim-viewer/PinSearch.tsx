import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { searchProjectPins, type ProjectPinResult } from '../../lib/drawings.api';

export function PinSearch({
  projectId,
  onSelect,
}: {
  projectId: string;
  onSelect: (pin: ProjectPinResult) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const searchQuery = useQuery({
    queryKey: ['project-pin-search', projectId, query],
    queryFn: () => searchProjectPins(projectId, query),
    enabled: open,
  });

  const results = searchQuery.data ?? [];

  return (
    <div className="relative w-full">
      <input
        autoFocus
        className="field-input w-full"
        placeholder="Search pins…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (
        <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded border border-gray-200 bg-white text-gray-900 shadow-lg">
          {searchQuery.isFetching && <p className="p-2 text-xs text-gray-400">Searching…</p>}
          {!searchQuery.isFetching && results.length === 0 && (
            <p className="p-2 text-xs text-gray-400">No pins found.</p>
          )}
          {results.map((pin) => (
            <button
              key={pin.locationId}
              type="button"
              className="block w-full truncate px-3 py-2 text-left text-sm hover:bg-gray-50"
              onMouseDown={() => {
                onSelect(pin);
                setOpen(false);
              }}
            >
              <span className="font-medium">{pin.name}</span>
              <span className="ml-2 text-xs text-gray-400">{pin.drawingTitle}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
