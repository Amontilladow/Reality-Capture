// Opens the global search dialog (mounted once in AppShell) from anywhere.
export const OPEN_SEARCH_EVENT = 'rc:open-search';
export function openGlobalSearch() {
  window.dispatchEvent(new Event(OPEN_SEARCH_EVENT));
}
