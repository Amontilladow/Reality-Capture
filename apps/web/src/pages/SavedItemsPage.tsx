import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/layout/PageHeader';
import { listSaved, unsaveItem, type SavedItem } from '../lib/workspace.api';
import { recordHref, RECORD_LABEL } from '../lib/record-links';

// Bookmarks: records the user wants to come back to. Saving copies only a
// label; the record itself is one click away and unchanged.
export default function SavedItemsPage() {
  const { projectId } = useParams<{ projectId?: string }>();
  const qc = useQueryClient();
  const saved = useQuery({ queryKey: ['me', 'saved'], queryFn: listSaved });
  const remove = useMutation({
    mutationFn: (s: SavedItem) => unsaveItem(s.itemType, s.itemId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me', 'saved'] }),
  });
  const items = saved.data ?? [];
  const groups = new Map<string, SavedItem[]>();
  for (const s of items) groups.set(s.projectName ?? 'Personal', [...(groups.get(s.projectName ?? 'Personal') ?? []), s]);

  return (
    <>
      <PageHeader
        breadcrumbs={projectId ? [{ label: 'Projects', to: '/projects' }, { label: 'Overview', to: `/projects/${projectId}` }, { label: 'Saved items' }] : undefined}
        title="Saved items"
        subtitle="Drawings, records and tasks you saved to come back to. Only you can see this list."
      />
      <div className="p-4 sm:p-6 max-w-4xl space-y-6">
        {saved.isLoading && <p className="text-sm text-ink-500">Loading…</p>}
        {saved.isError && <p className="text-sm text-danger">Couldn't load your saved items.</p>}
        {saved.data && items.length === 0 && (
          <div className="panel p-12 text-center text-sm text-ink-500">Nothing saved yet. Use the Save button on any issue, RFI or QA/QC record.</div>
        )}
        {[...groups.entries()].map(([group, list]) => (
          <section key={group} className="panel overflow-hidden">
            <h2 className="px-6 pt-6 pb-2 text-eyebrow font-medium uppercase text-ink-500">{group}</h2>
            <ul>
              {list.map((s) => {
                const href = recordHref(s.itemType, s.projectId, s.itemId, s.recordType);
                return (
                  <li key={s.id} className="flex items-center gap-4 px-6 py-4 border-t border-ink-100/10">
                    <span className="w-24 shrink-0 text-xs font-medium text-ink-500">{RECORD_LABEL[s.itemType]}</span>
                    <div className="min-w-0 flex-1">
                      {href ? <Link to={href} className="block text-sm font-medium text-ink-100 hover:text-blueprint truncate">{s.label}</Link>
                        : <span className="block text-sm font-medium text-ink-100 truncate">{s.label}</span>}
                      <span className="block text-xs text-ink-500">Saved {new Date(s.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}{s.note ? ` · ${s.note}` : ''}</span>
                    </div>
                    <button type="button" onClick={() => remove.mutate(s)} className="text-xs font-medium text-ink-500 hover:text-danger">Remove</button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
