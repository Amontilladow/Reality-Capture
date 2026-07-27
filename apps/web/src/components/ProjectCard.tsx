import { Link } from 'react-router-dom';
import type { Project } from '@engineeringos/types';

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-ok/15 text-ok',
  on_hold: 'bg-warn/15 text-warn',
  completed: 'bg-blueprint/15 text-blueprint',
  archived: 'bg-ink-500/15 text-ink-500',
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
        <span className={`badge shrink-0 ${STATUS_STYLES[project.status] ?? 'bg-base-700 text-ink-300'}`}>
          {project.status.replace('_', ' ')}
        </span>
      </div>

      {(project.city || project.country) && (
        <div className="text-xs text-ink-500">{[project.city, project.country].filter(Boolean).join(', ')}</div>
      )}

      <div className="flex items-center gap-4 text-xs font-mono text-ink-300 pt-3 border-t border-base-600">
        <span>{project.captureCount ?? 0} captures</span>
        <span>{project.openIssueCount ?? 0} open issues</span>
        <span>{project.memberCount ?? 0} members</span>
      </div>
    </Link>
  );
}
