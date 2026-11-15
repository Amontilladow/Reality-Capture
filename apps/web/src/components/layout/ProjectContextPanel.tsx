import { useNavigate } from 'react-router-dom';
import { Listbox } from '../ui/Listbox';
import { useProjectContext } from './useProjectContext';

/** The current project's name as a quiet dropdown that jumps to another project. */
export function ProjectSwitcher({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const { project, projects } = useProjectContext(projectId);

  return (
    <Listbox
      className="max-w-full bg-transparent border-0 p-0 rounded-md text-sm text-ink-500 hover:text-ink-100 transition-colors"
      value={projectId}
      onChange={(e) => {
        if (e.target.value) navigate(`/projects/${e.target.value}`);
      }}
      aria-label="Switch project"
    >
      {/* Keeps the current project selected even before the switcher's own
          list has loaded, by falling back to the one we already know from
          the project-detail query. */}
      {!projects.some((p) => p.id === projectId) && (
        <option value={projectId}>{project?.name ?? 'Loading…'}</option>
      )}
      {projects.map((p) => (
        <option key={p.id} value={p.id}>{p.name}</option>
      ))}
    </Listbox>
  );
}
