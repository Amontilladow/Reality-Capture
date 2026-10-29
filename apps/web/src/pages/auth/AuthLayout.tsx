import type { ReactNode } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { LogoMark } from '../../components/ui/LogoMark';
import { ThemeToggle } from '../../components/ui/ThemeToggle';

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  useDocumentTitle(title);

  return (
    <div className="min-h-screen flex">
      <div className="fixed top-4 right-4 z-10">
        <ThemeToggle />
      </div>

      {/* Brand half sits directly on the platform gradient (dashboard theme). */}
      <div className="hidden lg:flex w-1/2 relative overflow-hidden items-center justify-center">
        <div className="relative z-10 max-w-md px-10">
          <div className="flex items-center gap-2 mb-8">
            <LogoMark className="w-8 h-8" />
            <div className="leading-tight">
              <div className="font-semibold tracking-tight">Reality Capture</div>
              <div className="text-[11px] text-ink-500 font-medium">by EngineeringOS</div>
            </div>
          </div>
          {/* Decorative marketing copy, identical on every auth screen -- the
              page's actual topic (Login, Sign up, Reset password, ...) is the
              real h1, rendered once per page below via the `title` prop. */}
          <p className="text-5xl font-light tracking-tight leading-tight mb-5">
            Reality, understood.
          </p>
          <p className="text-ink-300 text-sm leading-relaxed">
            Register 360° captures against building, level, and location — link them to BIM
            elements, floor plans, and open issues — and hand every stakeholder a verifiable
            record of what was actually built.
          </p>
          {/* Real capability pillars, not a vanity metric (table/endpoint/role
              counts told a visitor nothing about what they could actually do
              here) -- same three-column rhythm, now naming the workflow
              instead of implementation internals. */}
          <div className="mt-10 grid grid-cols-3 gap-4 text-[11px] text-ink-500 font-medium">
            <div className="border-t border-base-600 pt-2 text-ink-300">Capture</div>
            <div className="border-t border-base-600 pt-2 text-ink-300">Coordinate</div>
            <div className="border-t border-base-600 pt-2 text-ink-300">Resolve</div>
          </div>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <LogoMark className="w-7 h-7" />
            <div className="leading-tight">
              <div className="font-semibold tracking-tight">Reality Capture</div>
              <div className="text-[11px] text-ink-500 font-medium">by EngineeringOS</div>
            </div>
          </div>
          <div className="tick-frame panel p-8">
            <h1 className="text-2xl font-normal tracking-tight mb-1">{title}</h1>
            <p className="text-sm text-ink-500 mb-6">{subtitle}</p>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
