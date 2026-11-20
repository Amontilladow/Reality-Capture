import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ImportDrawingsModal } from './ImportDrawingsModal';

// react-dropzone silently drops a file that fails its `accept` filter --
// it never reaches onDrop's "accepted" list, only its "fileRejections"
// one, which nothing here used to read. A real support case (a .rar
// archive, once genuinely unsupported) looked identical to a frozen
// upload button, with no way to tell "unsupported file" apart from
// "something is broken." .rar is a real supported format now (see
// rar-extraction.util.ts), so these tests use .7z as the stand-in for
// "still genuinely unsupported."
const api = vi.hoisted(() => ({ uploadImportBatch: vi.fn() }));
vi.mock('../../lib/site-drawings.api', async (orig) => ({ ...(await orig<typeof import('../../lib/site-drawings.api')>()), ...api }));

function renderIt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ImportDrawingsModal open onClose={() => {}} projectId="project-1" onCreated={() => {}} />
    </QueryClientProvider>,
  );
}

// A real OS "choose file" dialog filters its list by the input's `accept`
// attribute, so a mismatched file (e.g. a .7z) can never be selected that
// way at all. A real HTML5 drag-and-drop has no such filter -- the dropped
// file reaches react-dropzone's own `accept` validation, which is what
// actually produces a `fileRejections` entry. This helper drives that real
// path, the only one that can exercise the rejection UI at all.
function dropFile(root: HTMLElement, file: File) {
  const dataTransfer = { files: [file], items: [{ kind: 'file', type: file.type, getAsFile: () => file }], types: ['Files'] };
  fireEvent.drop(root, { dataTransfer });
}

describe('ImportDrawingsModal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('unsupported file type dragged in (e.g. a .7z archive): shows a clear rejection message, never a silent no-op', async () => {
    renderIt();
    const sevenZFile = new File(['7z!'], 'OneDrive_1_09-11-2026.7z', { type: 'application/x-7z-compressed' });

    dropFile(screen.getByRole('presentation'), sevenZFile);

    expect(await screen.findByText(/"OneDrive_1_09-11-2026\.7z" isn't a supported file/i)).toBeInTheDocument();
    expect(screen.getByText(/only \.zip, \.rar, and \.pdf are accepted/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start import' })).toBeDisabled();
  });

  it('a supported file after a rejection: clears the rejection message and enables Start import', async () => {
    renderIt();
    const sevenZFile = new File(['7z!'], 'package.7z', { type: 'application/x-7z-compressed' });
    const zipFile = new File(['PK'], 'package.zip', { type: 'application/zip' });

    dropFile(screen.getByRole('presentation'), sevenZFile);
    expect(await screen.findByText(/isn't a supported file/i)).toBeInTheDocument();

    dropFile(screen.getByRole('presentation'), zipFile);

    expect(await screen.findByText('package.zip')).toBeInTheDocument();
    expect(screen.queryByText(/isn't a supported file/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start import' })).toBeEnabled();
    expect(api.uploadImportBatch).not.toHaveBeenCalled();
  });

  it('a .rar archive is a supported file: dragging one in enables Start import, no rejection shown', async () => {
    renderIt();
    const rarFile = new File(['Rar!'], 'OneDrive_1_09-11-2026.rar', { type: 'application/x-rar-compressed' });

    dropFile(screen.getByRole('presentation'), rarFile);

    expect(await screen.findByText('OneDrive_1_09-11-2026.rar')).toBeInTheDocument();
    expect(screen.queryByText(/isn't a supported file/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start import' })).toBeEnabled();
  });
});
