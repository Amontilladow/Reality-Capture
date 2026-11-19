/** Chains event handlers, so a wrapper's handler and the caller's both run. */
export function chain<E>(...fns: (((e: E) => void) | undefined)[]) {
  return (e: E) => fns.forEach((f) => f?.(e));
}
