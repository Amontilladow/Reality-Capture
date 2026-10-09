import { useState } from 'react';
import { PageHeader } from '../components/layout/PageHeader';
import { Card } from '../components/ui/Card';
import { Alert } from '../components/ui/Alert';

interface HelpSection {
  key: string;
  label: string;
  // Real content for the one section worth writing now (see brief: "build
  // the UI/framework... do NOT write hundreds of pages of training content
  // yet"). Every other section is a clearly-labeled stub -- the skeleton
  // this phase asks for, not the content itself.
  body?: string;
  comingSoon: string;
}

const SECTIONS: HelpSection[] = [
  {
    key: 'getting-started',
    label: 'Getting Started',
    body:
      "EngineeringOS organizes everything around Projects. Each project has a building/level/location hierarchy you register reality captures, issues, RFIs, and floor plans against. Start from \"All projects\" in the sidebar, open a project, and use the project-level navigation (Captures, Floor Plans, Issues, RFIs, Snagging, Submittals, Reports, and more) to work within it. Your company admin controls which projects and permissions you have -- if something you expect to see is missing, that's the first thing to check with them.",
    comingSoon: 'A short walkthrough of your very first session: signing in, finding your project, and where everything lives.',
  },
  { key: 'your-role', label: 'Your Role', comingSoon: 'What your specific company role and project role mean for what you can see and do.' },
  { key: 'dashboard', label: 'Dashboard', comingSoon: 'Reading the Projects page\'s KPI tiles and project cards at a glance.' },
  { key: 'projects', label: 'Projects', comingSoon: 'Creating a project, setting up its building/level/location hierarchy, and inviting your team.' },
  { key: 'floor-plans', label: 'Floor Plans', comingSoon: 'Uploading floor plan PDFs, dropping and moving pins, and linking pins to issues.' },
  { key: 'issues', label: 'Issues', comingSoon: 'Creating, assigning, and closing issues; priorities, statuses, and deadlines.' },
  { key: 'snagging', label: 'Snagging', comingSoon: 'The fix/verify workflow and how it differs from a regular issue.' },
  { key: 'rfi', label: 'RFI', comingSoon: 'Submitting an RFI, the review workflow, and tracking drawing impact.' },
  { key: 'documents', label: 'Documents', comingSoon: 'Uploading and organizing project documents and report attachments.' },
  { key: 'reports', label: 'Reports', comingSoon: 'Reading the KPI summaries and charts, and exporting to Excel/PDF.' },
  { key: 'notifications', label: 'Notifications', comingSoon: 'What triggers a notification and how to manage them from the bell icon.' },
  {
    key: 'email',
    label: 'Email',
    comingSoon: 'Email integration (connecting your own Outlook/Gmail inbox) is planned but not available yet. This section will cover it once it ships.',
  },
  { key: 'ai-assistant', label: 'AI Assistant', comingSoon: 'What the assistant can answer, how usage limits work, and reviewing an AI-drafted RFI or issue.' },
  { key: 'faq', label: 'FAQ', comingSoon: 'Answers to the questions that come up most often.' },
  { key: 'troubleshooting', label: 'Troubleshooting', comingSoon: 'What to check and who to contact when something isn\'t working as expected.' },
];

export default function HelpPage() {
  const [activeKey, setActiveKey] = useState(SECTIONS[0].key);
  const active = SECTIONS.find((s) => s.key === activeKey)!;

  return (
    <>
      <PageHeader eyebrow="Workspace" title="Help & Training" />

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 p-6">
        <nav className="lg:col-span-1 space-y-0.5" aria-label="Help topics">
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              onClick={() => setActiveKey(s.key)}
              aria-current={s.key === activeKey ? 'true' : undefined}
              className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                s.key === activeKey ? 'bg-signal/10 text-signal' : 'text-ink-300 hover:bg-base-800'
              }`}
            >
              {s.label}
            </button>
          ))}
        </nav>

        <div className="lg:col-span-3">
          <Card title={active.label}>
            {active.body ? (
              <p className="text-sm text-ink-300 leading-relaxed">{active.body}</p>
            ) : (
              <Alert tone="info" title="Content coming soon">
                {active.comingSoon}
              </Alert>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
