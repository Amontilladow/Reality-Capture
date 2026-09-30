import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../components/layout/PageHeader';
import { RiskIntelligenceSection } from '../components/RiskIntelligenceSection';
import { getProject } from '../lib/projects.api';

export default function RiskPage() {
  const { projectId } = useParams<{ projectId: string }>();

  const projectQuery = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId!),
    enabled: Boolean(projectId),
  });

  if (!projectId) return null;

  return (
    <>
      <PageHeader eyebrow={projectQuery.data?.name ?? 'Project'} title="Risk Intelligence" />
      <div className="p-6">
        <RiskIntelligenceSection projectId={projectId} />
      </div>
    </>
  );
}
