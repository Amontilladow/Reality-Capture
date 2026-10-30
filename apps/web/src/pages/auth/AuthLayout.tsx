import type { ReactNode } from 'react';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { LogoMark } from '../../components/ui/LogoMark';
import { ThemeToggle } from '../../components/ui/ThemeToggle';
import { BrandPanel } from '../../components/brand/BrandPanel';

// Shared frame for every auth screen (sign in, sign up, invitation,
// password reset), in the dashboard theme: the form sits on the page
// gradient at left, and the right half is a large rounded panel carrying
// the official brand artwork (public/branding/reality-capture-hero.webp)
// with a few floating capability chips over it. Inputs and the submit
// button take the auth-form variants defined in index.css.
export function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  useDocumentTitle(title);

  return (
    <div className="min-h-screen p-4 sm:p-6 lg:grid lg:grid-cols-2 lg:gap-6">
      <div className="min-h-[calc(100vh-1.5rem)] sm:min-h-[calc(100vh-2.5rem)] flex flex-col px-4 py-4 sm:px-8 sm:py-6">
        <div className="flex items-center justify-between">
          <div className="inline-flex items-center gap-2 rounded-full border border-ink-500/50 pl-2 pr-6 py-2">
            <LogoMark className="w-8 h-8" />
            <span className="text-lg font-light tracking-tight text-ink-100">Reality Capture</span>
          </div>
          <ThemeToggle className="lg:hidden" />
        </div>

        <div className="flex-1 flex items-center justify-center py-10">
          <div className="auth-form w-full max-w-sm">
            <div className="text-center mb-8">
              <h1 className="text-4xl font-light tracking-tight text-ink-100">{title}</h1>
              <p className="text-sm text-ink-300 mt-2">{subtitle}</p>
            </div>
            {children}
          </div>
        </div>

        <p className="text-xs text-ink-500">Reality Capture by EngineeringOS</p>
      </div>

      <BrandPanel className="hidden lg:block" />
    </div>
  );
}
