import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Pin } from '../../lib/drawings.api';
import { listCaptures, uploadCapture } from '../../lib/captures.api';
import { CaptureGrid } from '../CaptureGrid';
import { apiErrorMessage } from '../../lib/api';

export function PinPanel({
  projectId,
  pin,
  onClose,
}: {
  projectId: string;
  pin: Pin | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const capturesQuery = useQuery({
    queryKey: ['captures', projectId, 'pin', pin?.locationId],
    queryFn: () => listCaptures(projectId, { locationId: pin!.locationId, perPage: 50 }),
    enabled: Boolean(pin),
  });

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow picking the same file again
    if (!file || !pin) return;

    setUploading(true);
    setError('');
    try {
      await uploadCapture(projectId, file, {
        captureType: file.type.startsWith('video/') ? 'video' : 'photo_standard',
        locationId: pin.locationId,
        title: file.name.replace(/\.[^./]+$/, ''),
      });
      queryClient.invalidateQueries({ queryKey: ['captures', projectId, 'pin', pin.locationId] });
      queryClient.invalidateQueries({ queryKey: ['pins', projectId] });
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  if (!pin) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-base-950/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl max-h-[85vh] tick-frame panel overflow-hidden flex flex-col">
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-base-600 shrink-0">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-ink-500">Pin</div>
            <h3 className="text-base font-semibold">{pin.name || 'Untitled pin'}</h3>
          </div>
          <button onClick={onClose} className="text-ink-500 hover:text-ink-100" aria-label="Close">
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          {/* Camera-first add-media: capture="environment" is a no-op on desktop
              (opens a normal file picker) and opens the camera directly on a
              phone -- included now even though mobile polish is a later phase,
              since it costs nothing extra here. */}
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              capture="environment"
              className="hidden"
              onChange={handleFile}
            />
            <button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="btn-primary w-full justify-center">
              {uploading ? 'Uploading…' : '+ Add photo or video'}
            </button>
            {error && <p className="field-error">{error}</p>}
          </div>

          <div>
            <div className="field-label">
              History ({capturesQuery.data?.data.length ?? 0})
            </div>
            {capturesQuery.isLoading && <p className="text-sm text-ink-500">Loading…</p>}
            {capturesQuery.data && capturesQuery.data.data.length > 0 ? (
              <CaptureGrid projectId={projectId} captures={capturesQuery.data.data} />
            ) : (
              !capturesQuery.isLoading && (
                <div className="panel p-8 text-center text-sm text-ink-500">
                  Nothing here yet — add the first photo or video above.
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
