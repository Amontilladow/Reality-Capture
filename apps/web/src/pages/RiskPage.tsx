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
      <PageHeader
        breadcrumbs={[{ label: 'Projects', to: '/projects' }, { label: projectQuery.data?.name ?? 'Loading…', to: `/projects/${projectId}` }, { label: 'Risk Intelligence' }]}
        title="Risk Intelligence"
        subtitle="Project risk exposure, mitigation progress and management actions."
      />
      <div className="p-6">
        <RiskIntelligenceSection projectId={projectId} />
      </div>
    </>
  );
}
