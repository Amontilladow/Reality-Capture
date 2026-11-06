import { describe, expect, it, beforeEach } from 'vitest';
import { loadSavedForm, saveForm } from './saved-form';

const INITIAL = { zone: '', floor: '', confirmed: false };

describe('saved form', () => {
  beforeEach(() => localStorage.clear());

  it('restores what was typed, but never a confirmation', () => {
    saveForm('k', { zone: 'KHALIFA CITY', floor: 'F1', confirmed: true });
    expect(loadSavedForm('k', INITIAL, { confirmed: false })).toEqual({ zone: 'KHALIFA CITY', floor: 'F1', confirmed: false });
  });

  it('starts empty when nothing was saved or the saved value is unreadable', () => {
    expect(loadSavedForm('missing', INITIAL)).toEqual(INITIAL);
    localStorage.setItem('bad', '{not json');
    expect(loadSavedForm('bad', INITIAL)).toEqual(INITIAL);
  });
});
