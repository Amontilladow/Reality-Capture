import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listElements, type BimElementDetail } from '../../lib/bim.api';

// A flat, searchable list of every element in a model -- independent of the
// spatial tree. Some models (infrastructure/MEP especially) dump everything
// under a single storey, which makes the tree useless for finding anything;
// this always works regardless of how (or whether) the model is organized
// by level.
export function ElementList({
  projectId,
  modelId,
  selectedGuid,
  onSelect,
}: {
  projectId: string;
  modelId: string;
  selectedGuid: string | null;
  onSelect: (element: BimElementDetail) => void;
}) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const perPage = 50;

  const query = useQuery({
    queryKey: ['bim-element-list', projectId, modelId, search, page],
    queryFn: () => listElements(projectId, { modelId, search: search.trim() || undefined, page, perPage }),
  });

  const elements = query.data?.data ?? [];
  const total = query.data?.meta?.total ?? 0;
  const totalPages = query.data?.meta?.totalPages ?? 1;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-gray-200 p-2">
        <input
          className="field-input w-full text-sm"
          placeholder="Search all elements…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </div>
      <div className="flex-1 overflow-y-auto">
        {query.isLoading && <p className="p-3 text-sm text-gray-400">Loading…</p>}
        {!query.isLoading && elements.length === 0 && (
          <p className="p-3 text-sm text-gray-400">No elements match.</p>
        )}
        {elements.map((el) => (
          <button
            key={el.id}
            type="button"
            onClick={() => onSelect(el)}
            className={`block w-full truncate px-3 py-2 text-left text-sm hover:bg-gray-100 ${
              selectedGuid === el.ifcGuid ? 'bg-blue-50 text-blue-700' : 'text-gray-900'
            }`}
          >
            <span className="font-medium">{el.ifcName ?? el.ifcType.replace('IFC', '')}</span>
            <span className="ml-2 text-xs text-gray-400">{el.ifcType.replace('IFC', '')}</span>
          </button>
        ))}
      </div>
      {total > perPage && (
        <div className="flex items-center justify-between border-t border-gray-200 px-2 py-1.5 text-xs text-gray-500">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="disabled:opacity-30"
          >
            ← Prev
          </button>
          <span>
            Page {page} of {totalPages} ({total})
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="disabled:opacity-30"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
