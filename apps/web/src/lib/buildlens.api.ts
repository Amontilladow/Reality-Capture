// BuildLens-specific helpers. Deliberately thin -- everything here is a
// thin composition of listCaptures()/getViewerData()/getCapture() from
// captures.api.ts, no new backend endpoints. See BuildLensPage.tsx and
// BuildLensTimelinePage.tsx for how these are used.
import type { Capture } from '@engineeringos/types';
import { listCaptures } from './captures.api';

/**
 * Fetches every capture in a project matching an optional type filter,
 * across however many pages the API returns them in.
 *
 * There is intentionally no backend "locations summary" endpoint for
 * BuildLens's landing page -- listCaptures() already returns everything a
 * per-location grouping needs (locationId/locationName/buildingName/
 * levelName/capturedAt on each row), so we group client-side instead of
 * adding a new API surface. listCaptures() caps `perPage` at 100 server-side
 * (see captures.service.ts's findAll()), so a project with more than 100
 * matching captures needs more than one request -- this loops pages until
 * `meta.totalPages` is exhausted. This is a deliberate, if slightly
 * inefficient, choice: a real project's capture count is expected to stay
 * in the hundreds at most, so a handful of sequential requests here is an
 * acceptable trade against introducing a new backend aggregation route.
 *
 * `captureType` omitted (undefined) fetches every capture type -- BuildLens
 * now shows a location's full media timeline (360s, standard photos, and
 * videos together), not just 360s.
 */
export async function listAllProjectCaptures(projectId: string, captureType?: string): Promise<Capture[]> {
  const perPage = 100;
  const first = await listCaptures(projectId, { captureType, perPage, page: 1 });
  const all = [...first.data];
  const totalPages = first.meta?.totalPages ?? 1;

  for (let page = 2; page <= totalPages; page++) {
    const next = await listCaptures(projectId, { captureType, perPage, page });
    all.push(...next.data);
  }

  return all;
}
