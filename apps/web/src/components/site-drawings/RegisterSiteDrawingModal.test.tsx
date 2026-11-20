import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RegisterSiteDrawingModal } from './RegisterSiteDrawingModal';

// Site Drawing Hub integrity hardening, Phase 8, Test 9: the exact bug
// found in the previous audit -- canSubmit required a storageKey that was
// only ever set on a SUCCESSFUL upload, but the one catch block around
// both upload and extraction couldn't tell the two failures apart, so an
// upload failure left "Register drawing" permanently disabled with a
// message implying manual entry was still possible. These tests drive the
// real component through all three outcomes and assert the button's real,
// user-facing state in each.
const api = vi.hoisted(() => ({
  uploadSiteDrawingFile: vi.fn(),
  extractSiteDrawingFields: vi.fn(),
  registerSiteDrawing: vi.fn(),
}));
vi.mock('../../lib/site-drawings.api', async (orig) => ({ ...(await orig<typeof import('../../lib/site-drawings.api')>()), ...api }));

function renderIt() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RegisterSiteDrawingModal open onClose={() => {}} projectId="project-1" />
    </QueryClientProvider>,
  );
}

function fileInput(container: HTMLElement): HTMLInputElement {
  return container.querySelector('input[type="file"]') as HTMLInputElement;
}

// A real OS "choose file" dialog filters its list by the input's `accept`
// attribute, so a mismatched file can never be selected that way at all --
// confirmed here too: @testing-library/user-event's upload() enforces the
// same filtering and simply refuses to attach a non-matching file (no
// 'change' event fires). A real HTML5 drag-and-drop has no such filter --
// the dropped file reaches react-dropzone's own `accept` validation, which
// is what actually produces a `fileRejections` entry. This helper drives
// that real path, the only one that can exercise the rejection UI at all.
function dropFile(root: HTMLElement, file: File) {
  const dataTransfer = { files: [file], items: [{ kind: 'file', type: file.type, getAsFile: () => file }], types: ['Files'] };
  fireEvent.drop(root, { dataTransfer });
}

const pdfFile = new File(['%PDF-1.4'], 'A-101.pdf', { type: 'application/pdf' });

describe('RegisterSiteDrawingModal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('upload failure: keeps the Register button disabled with an honest message and an explicit retry, never implying manual entry is possible', async () => {
    api.uploadSiteDrawingFile.mockRejectedValue(new Error('network error'));
    const { container } = renderIt();

    await userEvent.upload(fileInput(container), pdfFile);

    expect(await screen.findByText(/upload failed/i)).toBeInTheDocument();
    expect(screen.getByText(/this file was never actually uploaded/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Register drawing' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    // The old, misleading message must never appear for an upload failure.
    expect(screen.queryByText(/fill in the fields below manually/i)).not.toBeInTheDocument();
  });

  it('upload failure retried successfully: the Register button becomes enabled once the required fields are filled', async () => {
    api.uploadSiteDrawingFile.mockRejectedValueOnce(new Error('network error'));
    api.uploadSiteDrawingFile.mockResolvedValueOnce({ storageKey: 'key-1' });
    api.extractSiteDrawingFields.mockResolvedValue(null);
    const { container } = renderIt();

    await userEvent.upload(fileInput(container), pdfFile);
    await screen.findByRole('button', { name: 'Try again' });

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText(/couldn't read this drawing automatically/i);

    await userEvent.type(screen.getByLabelText('Drawing number'), 'A-101');
    await userEvent.type(screen.getByLabelText('Revision'), 'A');
    // Title is auto-filled from the filename on drop; already non-empty.
    expect(screen.getByRole('button', { name: 'Register drawing' })).toBeEnabled();
  });

  it('upload succeeds but extraction fails: the file is kept, manual entry is explicitly allowed, and the message says the upload itself worked', async () => {
    api.uploadSiteDrawingFile.mockResolvedValue({ storageKey: 'key-1' });
    api.extractSiteDrawingFields.mockRejectedValue(new Error('ai-service down'));
    const { container } = renderIt();

    await userEvent.upload(fileInput(container), pdfFile);

    expect(await screen.findByText(/auto-fill failed, but the file uploaded fine/i)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Drawing number'), 'A-101');
    await userEvent.type(screen.getByLabelText('Revision'), 'A');
    expect(screen.getByRole('button', { name: 'Register drawing' })).toBeEnabled();
  });

  it('successful extraction: fields are pre-filled and the form is immediately ready to register', async () => {
    api.uploadSiteDrawingFile.mockResolvedValue({ storageKey: 'key-1' });
    api.extractSiteDrawingFields.mockResolvedValue({
      drawingNumber: 'A-101', drawingTitle: 'Ground Floor Plan', revisionNumber: 'B', confidence: 0.9, source: 'embedded_text',
    });
    const { container } = renderIt();

    await userEvent.upload(fileInput(container), pdfFile);

    expect(await screen.findByText(/fields auto-filled from the drawing/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Drawing number')).toHaveValue('A-101');
    expect(screen.getByLabelText('Title')).toHaveValue('Ground Floor Plan');
    expect(screen.getByLabelText('Revision')).toHaveValue('B');
    expect(screen.getByRole('button', { name: 'Register drawing' })).toBeEnabled();
  });

  it('unsupported file type dragged in: shows a clear rejection message instead of silently doing nothing', async () => {
    renderIt();
    const notAPdf = new File(['PK...'], 'package.rar', { type: 'application/x-rar-compressed' });

    dropFile(screen.getByRole('presentation'), notAPdf);

    expect(await screen.findByText(/"package\.rar" isn't a supported file/i)).toBeInTheDocument();
    expect(api.uploadSiteDrawingFile).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Register drawing' })).toBeDisabled();
  });

  it('never enables Register while an upload or extraction is still in progress', async () => {
    let resolveUpload: (v: { storageKey: string }) => void = () => {};
    api.uploadSiteDrawingFile.mockImplementation(() => new Promise((resolve) => { resolveUpload = resolve; }));
    const { container } = renderIt();

    await userEvent.upload(fileInput(container), pdfFile);
    expect(screen.getByText('Uploading…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Register drawing' })).toBeDisabled();

    api.extractSiteDrawingFields.mockResolvedValue(null);
    resolveUpload({ storageKey: 'key-1' });
    await screen.findByText('Reading the drawing…');
    expect(screen.getByRole('button', { name: 'Register drawing' })).toBeDisabled();
  });
});
