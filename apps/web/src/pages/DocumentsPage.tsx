import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../components/layout/PageHeader';
import { DocumentUploadModal } from '../components/DocumentUploadModal';
import { listDocuments } from '../lib/documents.api';
import { getProject } from '../lib/projects.api';
import { DOC_TYPES, DOC_TYPE_LABELS, DOC_SOURCE_LABELS } from '../lib/document-constants';

export default function DocumentsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [docType, setDocType] = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);

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
        <div className="flex items-center gap-3">
          <select className="field-input w-auto" value={docType} onChange={(e) => setDocType(e.target.value)}>
            <option value="">All types</option>
            {DOC_TYPES.map((t) => (
              <option key={t} value={t}>{DOC_TYPE_LABELS[t]}</option>
            ))}
          </select>
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
          <div className="panel tick-frame overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-500 border-b border-base-600">
                  <th className="px-4 py-2.5 font-medium">Title</th>
                  <th className="px-4 py-2.5 font-medium">Type</th>
                  <th className="px-4 py-2.5 font-medium">Number</th>
                  <th className="px-4 py-2.5 font-medium">Revision</th>
                  <th className="px-4 py-2.5 font-medium">Source</th>
                  <th className="px-4 py-2.5 font-medium">Uploaded by</th>
                </tr>
              </thead>
              <tbody>
                {(documentsQuery.data?.data ?? []).map((d) => (
                  <tr key={d.id} className="border-b border-base-700/60 last:border-0 hover:bg-base-800/40">
                    <td className="px-4 py-2.5">
                      {d.source === 'manual_link' || d.externalUrl ? (
                        <a href={d.externalUrl} target="_blank" rel="noreferrer" className="text-blueprint hover:text-blueprint-hover">
                          {d.title}
                        </a>
                      ) : (
                        d.title
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-ink-300">{DOC_TYPE_LABELS[d.docType]}</td>
                    <td className="px-4 py-2.5 text-ink-300">{d.documentNumber ?? '—'}</td>
                    <td className="px-4 py-2.5 text-ink-300">{d.revision ?? '—'}</td>
                    <td className="px-4 py-2.5">
                      <span className="badge bg-base-700 text-ink-500">{DOC_SOURCE_LABELS[d.source] ?? d.source}</span>
                    </td>
                    <td className="px-4 py-2.5 text-ink-500">{(d as unknown as { uploadedByName?: string }).uploadedByName ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <DocumentUploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} projectId={projectId} />
    </>
  );
}
