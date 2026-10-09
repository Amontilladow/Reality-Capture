import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from '../ui/Modal';
import { useAuthStore } from '../../store/auth.store';
import { setOnboardingCompleted } from '../../lib/users.api';
import { COMPANY_ROLE_LABELS } from '../../lib/issue-constants';

// Phase 4F: a short, optional first-login tour. Shown whenever the
// signed-in user's own onboardingCompleted flag (stored in the existing
// users.preferences JSONB column -- see users.service.ts's update()) is
// not yet true, and dismissed on Skip/Finish/closing it, which marks it
// complete so it doesn't reappear on the next login. "Restart" (in the
// Help Centre) just flips the flag back to false, which re-shows this
// the same way a brand-new account would see it.
//
// Every step below describes only verified, real app behavior -- nothing
// here claims a button, screen, or permission that doesn't actually
// exist, and the one "try it" step only asks the user to do something
// every project member is always authorized to do (view a project's
// Issues list).
export function OnboardingFlow() {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const navigate = useNavigate();
  const [step, setStep] = useState(0);

  const active = Boolean(user) && !user?.pendingApproval && user?.onboardingCompleted !== true;
  if (!active || !user) return null;
  // Narrowed reference for the closures below -- TS control-flow narrowing
  // of `user` from the guard above doesn't carry into nested functions.
  const currentUser = user;

  const roleLabel = COMPANY_ROLE_LABELS[currentUser.companyRole] ?? currentUser.companyRole;
  const isSiteRestricted = currentUser.companyRole === 'construction_manager' || currentUser.companyRole === 'project_engineer';

  function finish(goToHelp: boolean) {
    setUser({ ...currentUser, onboardingCompleted: true });
    setOnboardingCompleted(currentUser.id, true).catch(() => {
      // Best-effort -- the dismissal already took effect locally for this
      // session; a failed write just means it may show again next login.
    });
    if (goToHelp) navigate('/projects/help');
  }

  const steps: { title: string; body: React.ReactNode }[] = [
    {
      title: `Welcome, ${user.firstName}`,
      body: (
        <p>
          This short tour covers the basics of EngineeringOS. You can skip it at any
          time, and revisit it later from the Help Centre.
        </p>
      ),
    },
    {
      title: 'Your Role and Organization',
      body: (
        <div className="space-y-2">
          <p>
            Your company role is <span className="font-medium text-ink-100">{roleLabel}</span>.
            It decides what you can do company-wide -- for example, whether you can invite
            teammates. On each project you're part of, you may also have a project role and
            an organization category (Client, PMC, LDC, Main Contractor, or Subcontractor)
            that shape what you see there.
          </p>
          {isSiteRestricted && (
            <p className="text-xs text-ink-500 bg-base-800 rounded px-3 py-2">
              As a {roleLabel}, you have full access on Floor Plans, Issues, and Snagging,
              and read-only access everywhere else.
            </p>
          )}
        </div>
      ),
    },
    {
      title: 'Your Projects Page',
      body: (
        <p>
          The Projects page lists every active project at your company, with a few
          summary numbers at the top. You don't need to be specifically assigned to a
          project to open and view it.
        </p>
      ),
    },
    {
      title: 'Finding a Project',
      body: (
        <p>
          Select a project card to open its workspace. Once inside, use the project
          switcher at the top of the sidebar to jump directly to a different project
          without going back to the list.
        </p>
      ),
    },
    {
      title: 'Key Modules',
      body: (
        <ul className="space-y-1.5 list-disc pl-4">
          <li><span className="font-medium text-ink-100">Floor Plans</span> -- drawings with pinpoints marking locations of issues.</li>
          <li><span className="font-medium text-ink-100">Issues &amp; Snagging</span> -- defects and punch-list items tracked to closure.</li>
          <li><span className="font-medium text-ink-100">RFIs</span> -- formal requests for information.</li>
          <li><span className="font-medium text-ink-100">Documents</span> -- drawings, specifications, and other project files.</li>
          <li><span className="font-medium text-ink-100">Reports</span> -- project KPIs, risk, and a date-scoped progress report.</li>
        </ul>
      ),
    },
    {
      title: 'Try It',
      body: (
        <p>
          Open any project, then select <span className="font-medium text-ink-100">Issues</span> in
          the sidebar to see what's outstanding there. Viewing is open to every project
          member, so this is safe to try right now.
        </p>
      ),
    },
    {
      title: 'Help Whenever You Need It',
      body: (
        <p>
          The Help Centre has step-by-step articles for every module, a search box, and
          a "For My Role" quick-start matching your own role. You can open it any time
          from the sidebar.
        </p>
      ),
    },
  ];

  const isFirst = step === 0;
  const isLast = step === steps.length - 1;

  return (
    <Modal open={active} onClose={() => finish(false)} title={steps[step].title}>
      <div className="space-y-5">
        <div className="text-[11px] font-mono uppercase tracking-widest text-ink-500">
          Step {step + 1} of {steps.length}
        </div>
        <div className="text-sm text-ink-300 leading-relaxed">{steps[step].body}</div>

        <div className="flex items-center justify-between pt-2">
          <button onClick={() => finish(false)} className="btn-ghost text-xs">
            Skip
          </button>
          <div className="flex items-center gap-2">
            {!isFirst && (
              <button onClick={() => setStep((s) => s - 1)} className="btn-secondary text-xs">
                Back
              </button>
            )}
            {!isLast ? (
              <button onClick={() => setStep((s) => s + 1)} className="btn-primary text-xs">
                Next
              </button>
            ) : (
              <button onClick={() => finish(true)} className="btn-primary text-xs">
                Finish &amp; Open Help Centre
              </button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
