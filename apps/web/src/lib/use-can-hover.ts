import { useEffect, useState } from 'react';

const QUERY = '(hover: hover)';

/**
 * Whether the main pointer can hover (a mouse or trackpad), as opposed to
 * a touch screen. Follows changes, e.g. a tablet docked to a keyboard.
 */
export function useCanHover(): boolean {
  const get = () => (typeof window === 'undefined' || !window.matchMedia ? true : window.matchMedia(QUERY).matches);
  const [canHover, setCanHover] = useState(get);
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia(QUERY);
    const onChange = () => setCanHover(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return canHover;
}
