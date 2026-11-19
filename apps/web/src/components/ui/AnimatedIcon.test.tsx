import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/react';

// Capture what WithAnimatedIcon asks the player for.
const seen = vi.hoisted(() => ({ interaction: undefined as string | undefined }));
vi.mock('react-useanimations', () => ({
  default: (props: { interaction?: string; render?: (e: object, a: object) => JSX.Element }) => {
    seen.interaction = props.interaction;
    return props.render ? props.render({}, {}) : <span />;
  },
}));
import { WithAnimatedIcon, AnimatedButton } from './AnimatedIcon';
import { screen, fireEvent } from '@testing-library/react';

function mockHover(canHover: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(hover: hover)' ? canHover : false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
}
const hoverIcon = { animationData: {}, interaction: 'hover-replay' as const };
const clickIcon = { animationData: {}, interaction: 'click-toggle' as const };

describe('WithAnimatedIcon', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps hover interactions where the pointer can hover', () => {
    mockHover(true);
    render(<WithAnimatedIcon animation={hoverIcon}>{() => <button>Row</button>}</WithAnimatedIcon>);
    expect(seen.interaction).toBeUndefined(); // the icon's own hover-replay
  });

  it('plays hover icons on tap on touch screens', () => {
    mockHover(false);
    render(<WithAnimatedIcon animation={hoverIcon}>{() => <button>Row</button>}</WithAnimatedIcon>);
    expect(seen.interaction).toBe('click-replay');
    render(<WithAnimatedIcon animation={clickIcon} interaction="hover">{() => <button>Row</button>}</WithAnimatedIcon>);
    expect(seen.interaction).toBe('click-replay');
  });

  it('leaves non-hover interactions alone on touch screens', () => {
    mockHover(false);
    render(<WithAnimatedIcon animation={clickIcon}>{() => <button>Row</button>}</WithAnimatedIcon>);
    expect(seen.interaction).toBeUndefined();
  });
});

describe('AnimatedButton', () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps the button's own click action, and stays inert when disabled", () => {
    mockHover(true);
    const onClick = vi.fn();
    const { rerender } = render(<AnimatedButton animation={hoverIcon} onClick={onClick} className="btn-primary">New issue</AnimatedButton>);
    const button = screen.getByRole('button', { name: 'New issue' });
    expect(button).toHaveAttribute('type', 'button');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
    rerender(<AnimatedButton animation={hoverIcon} onClick={onClick} disabled>New issue</AnimatedButton>);
    fireEvent.click(screen.getByRole('button', { name: 'New issue' }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
