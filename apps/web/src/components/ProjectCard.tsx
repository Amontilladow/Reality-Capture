import { Link } from 'react-router-dom';
import type { Project } from '@engineeringos/types';
import { PROJECT_PHASE_LABELS } from '@engineeringos/types';
import { StatusBadge } from './ui/Badge';
import { PROJECT_STATUS_TONE } from '../lib/status-tone';
import { formatDeadline } from '../lib/issue-constants';

const STATUS_LABELS: Record<Project['status'], string> = {
  active: 'Active',
  on_hold: 'On Hold',
  completed: 'Completed',
  archived: 'Archived',
};

export function ProjectCard({ project }: { project: Project }) {
  return (
    <Link
      to={`/projects/${project.id}`}
      className="tick-frame panel p-5 flex flex-col gap-4 hover:border-blueprint/50 transition-colors group"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono text-[10px] text-ink-500 uppercase tracking-wide mb-1">
            {project.code ?? '—'}
          </div>
          <h3 className="font-semibold text-sm leading-snug group-hover:text-blueprint transition-colors truncate">
            {project.name}
          </h3>
        </div>
        <StatusBadge tone={PROJECT_STATUS_TONE[project.status]} label={STATUS_LABELS[project.status]} />
      </div>

      <div className="flex items-center gap-2 flex-wrap text-xs text-ink-500">
        {(project.city || project.country) && <span>{[project.city, project.country].filter(Boolean).join(', ')}</span>}
        {project.phase && (
          <>
            {(project.city || project.country) && <span aria-hidden="true">·</span>}
            <span>{PROJECT_PHASE_LABELS[project.phase]}</span>
          </>
        )}
      </div>

      <div className="flex items-center gap-4 text-xs font-mono text-ink-300 pt-3 border-t border-base-600">
        <span>{project.captureCount ?? 0} captures</span>
        <span>{project.openIssueCount ?? 0} open issues</span>
        <span>{project.memberCount ?? 0} members</span>
      </div>

      <div className="text-[10px] text-ink-500 -mt-2">Updated {formatDeadline(project.updatedAt)}</div>
    </Link>
  );
}
