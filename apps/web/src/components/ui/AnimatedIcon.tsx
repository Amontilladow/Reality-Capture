import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react';
import UseAnimations, { type Animation, type EventProps, type Interaction } from 'react-useanimations';
import loading2 from 'react-useanimations/lib/loading2';
import { useCanHover } from '../../lib/use-can-hover';
import { chain } from '../../lib/chain-handlers';

// Animated line icons (useAnimations, MIT): small Lottie icons drawn as SVG
// in the text colour, so our ink/signal tokens apply as with any icon.
// They stay still when the user prefers reduced motion (the player checks
// prefers-reduced-motion itself), and looping ones pause off-screen.
//
// Movement is a reward for intent, never decoration: an icon plays when its
// row or button is hovered or focused, or when its state changes (saved,
// toggled); only loaders loop. Touch screens can't hover (and the player
// ignores taps for hover icons), so there an icon plays once on tap instead,
// as the button's feedback.

const HOVER_INTERACTIONS: Interaction[] = ['hover', 'hover-loop', 'hover-replay'];

/** The icon's interaction, swapped to play-on-tap where there is no hover. */
function useTouchAwareInteraction(animation: Animation, interaction?: Interaction): Interaction | undefined {
  const canHover = useCanHover();
  const effective = interaction ?? animation.interaction;
  if (!canHover && effective && HOVER_INTERACTIONS.includes(effective)) return 'click-replay';
  return interaction;
}

/**
 * Lets a whole row or button trigger its icon: `children` receives the
 * hover/focus handlers to spread on the interactive element, and the icon
 * to place inside it.
 */
export function WithAnimatedIcon({ animation, size = 16, interaction, children }: {
  animation: Animation;
  size?: number;
  interaction?: Interaction;
  children: (eventProps: EventProps, icon: ReactNode) => ReactElement;
}) {
  const effective = useTouchAwareInteraction(animation, interaction);
  return (
    <UseAnimations
      animation={animation}
      size={size}
      interaction={effective}
      render={(eventProps, animationProps) => children(eventProps, <span aria-hidden="true" {...animationProps} />)}
    />
  );
}


/**
 * A button with an animated icon before its label: the icon plays on hover
 * or keyboard focus (on tap on touch screens), and the button's own handlers
 * still run. Defaults to playing once on hover; pass `interaction="hover"`
 * for icons that should play forward and back (a bin's lid).
 */
export function AnimatedButton({
  animation, interaction = 'hover-replay', iconSize = 16, children, type = 'button',
  onClick, onMouseEnter, onMouseLeave, onFocus, onBlur, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { animation: Animation; interaction?: Interaction; iconSize?: number }) {
  return (
    <WithAnimatedIcon animation={animation} size={iconSize} interaction={interaction}>
      {(ev, icon) => (
        <button
          type={type}
          {...rest}
          onPointerEnter={ev.onPointerEnter}
          onClick={chain(onClick, ev.onClick)}
          onMouseEnter={chain(onMouseEnter, ev.onMouseEnter)}
          onMouseLeave={chain(onMouseLeave, ev.onMouseLeave)}
          onFocus={chain(onFocus, ev.onFocus)}
          onBlur={chain(onBlur, ev.onBlur)}
        >
          {icon}
          {children}
        </button>
      )}
    </WithAnimatedIcon>
  );
}

/** A standalone animated icon, e.g. a bookmark whose `active` state is controlled. */
export function AnimatedIcon(props: { animation: Animation; size?: number; active?: boolean; interaction?: Interaction; className?: string; autoplay?: boolean; loop?: boolean }) {
  return <UseAnimations aria-hidden="true" size={16} {...props} />;
}

/** Inline loader: a spinning ring and the text beside it. */
export function Loading({ label = 'Loading…', className = '' }: { label?: string; className?: string }) {
  return (
    <span role="status" className={`inline-flex items-center gap-2 text-sm text-ink-500 ${className}`}>
      <UseAnimations animation={loading2} size={18} aria-hidden="true" className="text-ink-300" />
      {label}
    </span>
  );
}
