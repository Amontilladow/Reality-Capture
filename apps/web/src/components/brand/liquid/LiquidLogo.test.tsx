import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LiquidLogo } from './LiquidLogo';

describe('LiquidLogo', () => {
  it('is a named image and falls back to the static mark without WebGL2', () => {
    // jsdom has no WebGL, which is exactly the no-GPU / old-browser case.
    const { container } = render(<LiquidLogo label="Reality Capture logo" />);
    expect(screen.getByRole('img', { name: 'Reality Capture logo' })).toBeInTheDocument();
    expect(container.querySelector('img[src="/logo-mark.png"]')).toBeInTheDocument();
    expect(container.querySelector('canvas')).not.toBeInTheDocument();
  });
});
