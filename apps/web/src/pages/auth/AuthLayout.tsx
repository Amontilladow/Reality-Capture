import type { ReactNode } from 'react';

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="min-h-screen flex">
      <div className="hidden lg:flex w-1/2 relative bg-base-900 overflow-hidden items-center justify-center">
        <div className="absolute inset-0 bg-grid-fine bg-grid-fine" />
        <div className="absolute inset-0 bg-gradient-to-t from-base-950 via-transparent to-base-950/40" />
        <div className="relative z-10 max-w-md px-10">
          <div className="flex items-center gap-2 mb-8">
            <svg viewBox="0 0 24 24" className="w-8 h-8" fill="none">
              <rect x="2" y="2" width="20" height="20" rx="2" stroke="#FF7A29" strokeWidth="1.5" />
              <path d="M2 8h20M8 2v20" stroke="#4FB6E8" strokeWidth="1" opacity="0.6" />
              <circle cx="8" cy="8" r="1.4" fill="#FF7A29" />
            </svg>
            <span className="font-semibold tracking-tight">EngineeringOS</span>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight leading-tight mb-4">
            Every site condition,<br />surveyed and searchable.
          </h1>
          <p className="text-ink-300 text-sm leading-relaxed">
            Register 360° captures against building, level, and location — link them to BIM
            elements, floor plans, and open issues — and hand every stakeholder a verifiable
            record of what was actually built.
          </p>
          <div className="mt-10 grid grid-cols-3 gap-4 font-mono text-xs text-ink-500">
            <div className="border-t border-base-600 pt-2">
              <div className="text-blueprint text-lg">29</div>TABLES
            </div>
            <div className="border-t border-base-600 pt-2">
              <div className="text-blueprint text-lg">58</div>ENDPOINTS
            </div>
            <div className="border-t border-base-600 pt-2">
              <div className="text-blueprint text-lg">11</div>ROLES
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <svg viewBox="0 0 24 24" className="w-7 h-7" fill="none">
              <rect x="2" y="2" width="20" height="20" rx="2" stroke="#FF7A29" strokeWidth="1.5" />
              <path d="M2 8h20M8 2v20" stroke="#4FB6E8" strokeWidth="1" opacity="0.6" />
              <circle cx="8" cy="8" r="1.4" fill="#FF7A29" />
            </svg>
            <span className="font-semibold tracking-tight">EngineeringOS</span>
          </div>
          <div className="tick-frame panel p-8">
            <h2 className="text-xl font-semibold mb-1">{title}</h2>
            <p className="text-sm text-ink-500 mb-6">{subtitle}</p>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
