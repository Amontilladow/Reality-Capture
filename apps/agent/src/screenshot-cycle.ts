export type ScreenshotCycleResult = 'recorded' | 'skipped-disabled' | 'failed';

export interface ScreenshotCycleDeps {
  requestUploadUrl: () => Promise<{ uploadUrl: string; storageKey: string }>;
  capture: () => Promise<Buffer>;
  putImage: (uploadUrl: string, image: Buffer) => Promise<void>;
  recordScreenshot: (params: { storageKey: string; capturedAt: string }) => Promise<void>;
  isForbiddenError: (err: unknown) => boolean;
  log?: (message: string) => void;
}

// One screenshot cycle: request permission, capture, upload, record.
// A 403 (company has screenshots disabled) is an expected, normal outcome
// for most companies most of the time -- logged quietly and skipped, never
// an aggressive error/alert. Any other failure (network blip, presign
// expiry) is logged and left for the next scheduled cycle; there is no
// retry queue for screenshots the way there is for activity segments,
// since a missed screenshot every ~90 minutes is not the kind of data loss
// the offline-first activity queue exists to prevent.
export async function runScreenshotCycle(deps: ScreenshotCycleDeps): Promise<ScreenshotCycleResult> {
  const log = deps.log ?? console.log;

  let uploadInfo: { uploadUrl: string; storageKey: string };
  try {
    uploadInfo = await deps.requestUploadUrl();
  } catch (err) {
    if (deps.isForbiddenError(err)) {
      log('Screenshots are disabled for this company -- skipping this cycle.');
      return 'skipped-disabled';
    }
    log(`Could not request a screenshot upload URL, will retry next cycle: ${(err as Error).message}`);
    return 'failed';
  }

  try {
    const capturedAt = new Date().toISOString();
    const image = await deps.capture();
    await deps.putImage(uploadInfo.uploadUrl, image);
    await deps.recordScreenshot({ storageKey: uploadInfo.storageKey, capturedAt });
    log('Screenshot captured and recorded.');
    return 'recorded';
  } catch (err) {
    log(`Screenshot capture/upload failed, will retry next cycle: ${(err as Error).message}`);
    return 'failed';
  }
}
