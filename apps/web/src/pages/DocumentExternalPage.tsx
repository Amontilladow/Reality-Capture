import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getDocumentByToken } from '../lib/documents.api';
import { apiErrorMessage } from '../lib/api';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { DOC_TYPE_LABELS } from '../lib/document-constants';
import { LogoMark } from '../components/ui/LogoMark';
import { ThemeToggle } from '../components/ui/ThemeToggle';

// No EngineeringOS account, no session -- the opaque token in the URL is the
// only credential. Deliberately outside ProtectedRoute/AppShell, same as
// ProgressReportExternalPage/RfiExternalPage -- nothing else in the app is
// reachable from here.
export default function DocumentExternalPage() {
  const { token } = useParams<{ token: string }>();

  const docQuery = useQuery({
    queryKey: ['document-external', token],
    queryFn: () => getDocumentByToken(token!),
    enabled: Boolean(token),
    retry: false,
  });

  const doc = docQuery.data;

  useDocumentTitle(doc ? doc.title : undefined);

  return (
    <div className="min-h-screen bg-base-950 flex flex-col items-center px-4 py-10">
      <div className="fixed top-4 right-4 z-10">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-lg">
        <div className="flex items-center gap-2 mb-8 justify-center">
          <LogoMark className="w-7 h-7" />
          <span className="font-semibold tracking-tight text-ink-100">EngineeringOS</span>
        </div>

        {docQuery.isLoading && (
          <div className="panel tick-frame p-8 text-center text-sm text-ink-500">Loading…</div>
        )}

        {docQuery.isError && (
          <div className="panel tick-frame p-8 text-center text-sm text-danger">{apiErrorMessage(docQuery.error)}</div>
        )}

        {doc && (
          <div className="panel tick-frame p-6 text-center">
            <div className="text-xs text-ink-500 font-medium">{DOC_TYPE_LABELS[doc.docType]}</div>
            <h1 className="text-xl font-semibold text-ink-100 mt-2">{doc.title}</h1>
            {(doc.documentNumber || doc.revision) && (
              <div className="text-xs text-ink-500 mt-2">
                {doc.documentNumber ?? ''}{doc.documentNumber && doc.revision ? ' · Rev ' : doc.revision ? 'Rev ' : ''}{doc.revision ?? ''}
              </div>
            )}
            <a href={doc.downloadUrl} className="btn-primary mt-6 inline-block">
              Download
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
