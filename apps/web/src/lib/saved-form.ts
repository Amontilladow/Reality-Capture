// A form remembered per key in this browser, so a refresh or a later visit does not wipe what was typed.
// Storage can be unavailable (private browsing, quota, blocked site data): then the form simply is not remembered.

export function loadSavedForm<T extends object>(key: string, initial: T, neverRestore: Partial<T> = {}): T {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<T> | null;
    return saved && typeof saved === 'object' ? { ...initial, ...saved, ...neverRestore } : initial;
  } catch {
    return initial;
  }
}

export function saveForm(key: string, value: object): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // not remembered; the form still works
  }
}
