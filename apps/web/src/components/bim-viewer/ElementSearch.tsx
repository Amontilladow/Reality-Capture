import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listElements, type BimElementDetail } from '../../lib/bim.api';

export function ElementSearch({
  projectId,
  modelId,
  onSelect,
}: {
  projectId: string;
  modelId: string;
  onSelect: (element: BimElementDetail) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const searchQuery = useQuery({
    queryKey: ['bim-element-search', projectId, modelId, query],
    queryFn: () => listElements(projectId, { modelId, search: query, perPage: 20 }),
    enabled: query.trim().length >= 2,
  });

  const results = searchQuery.data?.data ?? [];

  return (
    <div className="relative w-64">
      <input
        className="field-input w-full"
        placeholder="Search elements…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && query.trim().length >= 2 && (
        <div className="absolute z-10 mt-1 max-h-72 w-full overflow-y-auto rounded border border-gray-200 bg-white shadow-lg">
          {searchQuery.isFetching && <p className="p-2 text-xs text-gray-400">Searching…</p>}
          {!searchQuery.isFetching && results.length === 0 && (
            <p className="p-2 text-xs text-gray-400">No matches.</p>
          )}
          {results.map((el) => (
            <button
              key={el.id}
              type="button"
              className="block w-full truncate px-3 py-2 text-left text-sm hover:bg-gray-50"
              onMouseDown={() => {
                onSelect(el);
                setOpen(false);
              }}
            >
              <span className="font-medium">{el.ifcName ?? el.ifcType.replace('IFC', '')}</span>
              <span className="ml-2 text-xs text-gray-400">{el.ifcType.replace('IFC', '')}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
