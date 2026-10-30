import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../components/layout/PageHeader';
import { DocumentUploadModal } from '../components/DocumentUploadModal';
import { DocumentShareModal } from '../components/DocumentShareModal';
import { listDocuments } from '../lib/documents.api';
import { getProject } from '../lib/projects.api';
import { DOC_TYPES, DOC_TYPE_LABELS, DOC_SOURCE_LABELS } from '../lib/document-constants';
import { Listbox } from '../components/ui/Listbox';

export default function DocumentsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [docType, setDocType] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);
  const [shareTarget, setShareTarget] = useState<{ id: string; title: string } | null>(null);

  const projectQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId!),
    enabled: Boolean(projectId),
  });

  const documentsQuery = useQuery({
    queryKey: ['documents', projectId, docType],
    queryFn: () => listDocuments(projectId!, { perPage: 100, docType: docType || undefined }),
    enabled: Boolean(projectId),
  });

  if (!projectId) return null;

  return (
    <>
      <PageHeader
        eyebrow={projectQuery.data?.name ?? 'Project'}
        title="Documents"
        actions={
          <button onClick={() => setUploadOpen(true)} className="btn-primary">
            + Add document
          </button>
        }
      />

      <div className="p-6 space-y-4">
        <div className="flex items-center gap-4">
          <Listbox aria-label="Document type" className="field-input w-auto" value={docType} onChange={(e) => setDocType(e.target.value)}>
            <option value="">All types</option>
            {DOC_TYPES.map((t) => (
              <option key={t} value={t}>{DOC_TYPE_LABELS[t]}</option>
            ))}
          </Listbox>
          {documentsQuery.data?.meta && (
            <span className="text-xs font-mono text-ink-500 ml-auto">
              {documentsQuery.data.meta.total} document{documentsQuery.data.meta.total === 1 ? '' : 's'}
            </span>
          )}
        </div>

        {documentsQuery.isLoading && <div className="text-sm text-ink-500">Loading…</div>}

        {documentsQuery.data?.data.length === 0 && (
          <div className="tick-frame panel p-12 text-center text-sm text-ink-500">
            No documents yet. Upload a file or link an external one to get started.
          </div>
        )}

        {(documentsQuery.data?.data.length ?? 0) > 0 && (
          <div className="panel tick-frame overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-500 border-b border-base-600">
                  <th className="px-4 py-2 font-medium">Title</th>
                  <th className="px-4 py-2 font-medium">Type</th>
                  <th className="px-4 py-2 font-medium">Number</th>
                  <th className="px-4 py-2 font-medium">Revision</th>
                  <th className="px-4 py-2 font-medium">Source</th>
                  <th className="px-4 py-2 font-medium">Uploaded by</th>
                  <th className="px-4 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {(documentsQuery.data?.data ?? []).map((d) => (
                  <tr key={d.id} className="border-b border-base-700/60 last:border-0 hover:bg-base-700">
                    <td className="px-4 py-2">
                      {d.source === 'manual_link' || d.externalUrl ? (
                        <a href={d.externalUrl} target="_blank" rel="noreferrer" className="text-blueprint hover:text-blueprint-hover">
                          {d.title}
                        </a>
                      ) : (
                        d.title
                      )}
                    </td>
                    <td className="px-4 py-2 text-ink-300">{DOC_TYPE_LABELS[d.docType]}</td>
                    <td className="px-4 py-2 text-ink-300">{d.documentNumber ?? '—'}</td>
                    <td className="px-4 py-2 text-ink-300">{d.revision ?? '—'}</td>
                    <td className="px-4 py-2">
                      <span className="badge bg-base-700 text-ink-500">{DOC_SOURCE_LABELS[d.source] ?? d.source}</span>
                    </td>
                    <td className="px-4 py-2 text-ink-500">{(d as unknown as { uploadedByName?: string }).uploadedByName ?? '—'}</td>
                    <td className="px-4 py-2 text-right">
                      {/* Only an internally-stored upload has a file of ours to hand out --
                          an external reference (Procore/Aconex/SharePoint/BIM360/a manual
                          link) has no object here to share; see DocumentsService.createShare(). */}
                      {d.source === 'internal' && (
                        <button onClick={() => setShareTarget({ id: d.id, title: d.title })} className="btn-ghost !px-2 !py-2 text-xs">
                          Share
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <DocumentUploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} projectId={projectId} />
      {shareTarget && (
        <DocumentShareModal
          projectId={projectId}
          documentId={shareTarget.id}
          documentTitle={shareTarget.title}
          onClose={() => setShareTarget(null)}
        />
      )}
    </>
  );
}
