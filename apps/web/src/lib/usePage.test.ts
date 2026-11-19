import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePage } from './usePage';

describe('usePage', () => {
  it('starts on page 1 and changes page on request', () => {
    const { result } = renderHook(({ filters }) => usePage(filters), { initialProps: { filters: ['open'] } });
    expect(result.current[0]).toBe(1);
    act(() => result.current[1](3));
    expect(result.current[0]).toBe(3);
  });

  it('goes back to page 1 when a filter changes', () => {
    const { result, rerender } = renderHook(({ filters }) => usePage(filters), { initialProps: { filters: ['open'] } });
    act(() => result.current[1](4));
    rerender({ filters: ['closed'] });
    expect(result.current[0]).toBe(1);
  });

  it('keeps the page when the filters are equal but a new array', () => {
    const { result, rerender } = renderHook(({ filters }) => usePage(filters), { initialProps: { filters: ['open'] } });
    act(() => result.current[1](2));
    rerender({ filters: ['open'] });
    expect(result.current[0]).toBe(2);
  });
});
