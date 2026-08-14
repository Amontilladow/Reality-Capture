import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Project, ProjectPhase, ProjectStatus } from '@engineeringos/types';
import { PROJECT_PHASES, PROJECT_PHASE_LABELS } from '@engineeringos/types';
import { Modal } from './ui/Modal';
import { updateProject, uploadProjectBranding } from '../lib/projects.api';
import { apiErrorMessage } from '../lib/api';

interface EditProjectForm {
  name: string;
  code?: string;
  status: ProjectStatus;
  phase?: ProjectPhase | '';
  description?: string;
  location?: string;
  country?: string;
  city?: string;
  startDate?: string;
  expectedEndDate?: string;
  orgCode?: string;
  clientName?: string;
  leadDesigner?: string;
  consultantName?: string;
  technicalAdvisor?: string;
  pmcName?: string;
  mainContractor?: string;
  subcontractor?: string;
}

const STATUSES: { value: ProjectStatus; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'on_hold', label: 'On Hold' },
  { value: 'completed', label: 'Completed' },
  { value: 'archived', label: 'Archived' },
];

export function EditProjectModal({
  open,
  onClose,
  project,
}: {
  open: boolean;
  onClose: () => void;
  project?: Project;
}) {
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<EditProjectForm>();

  // Reset to the current project's values every time the modal is (re)opened,
  // rather than whatever was left over from a previous open.
  useEffect(() => {
    if (open && project) {
      reset({
        name: project.name,
        code: project.code ?? '',
        status: project.status,
        phase: project.phase ?? '',
        description: project.description ?? '',
        location: project.location ?? '',
        country: project.country ?? '',
        city: project.city ?? '',
        startDate: project.startDate ? project.startDate.slice(0, 10) : '',
        expectedEndDate: project.expectedEndDate ? project.expectedEndDate.slice(0, 10) : '',
        orgCode: project.orgCode ?? '',
        clientName: project.clientName ?? '',
        leadDesigner: project.leadDesigner ?? '',
        consultantName: project.consultantName ?? '',
        technicalAdvisor: project.technicalAdvisor ?? '',
        pmcName: project.pmcName ?? '',
        mainContractor: project.mainContractor ?? '',
        subcontractor: project.subcontractor ?? '',
      });
    }
  }, [open, project, reset]);

  const mutation = useMutation({
    mutationFn: (values: EditProjectForm) =>
      updateProject(project!.id, {
        name: values.name,
        code: values.code || undefined,
        status: values.status,
        phase: values.phase || undefined,
        description: values.description || undefined,
        location: values.location || undefined,
        country: values.country || undefined,
        city: values.city || undefined,
        startDate: values.startDate || undefined,
        expectedEndDate: values.expectedEndDate || undefined,
        orgCode: values.orgCode || undefined,
        clientName: values.clientName || undefined,
        leadDesigner: values.leadDesigner || undefined,
        consultantName: values.consultantName || undefined,
        technicalAdvisor: values.technicalAdvisor || undefined,
        pmcName: values.pmcName || undefined,
        mainContractor: values.mainContractor || undefined,
        subcontractor: values.subcontractor || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', project!.id] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      onClose();
    },
  });

  // Uploaded immediately on file pick, independent of the main form's Save
  // button, so the thumbnail updates right away -- same "avatar upload"
  // pattern used elsewhere, not tied into react-hook-form's state.
  const logoMutation = useMutation({
    mutationFn: (file: File) => uploadProjectBranding(project!.id, file, 'logo'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['project', project!.id] }),
  });
  const stampMutation = useMutation({
    mutationFn: (file: File) => uploadProjectBranding(project!.id, file, 'stamp'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['project', project!.id] }),
  });

  if (!project) return null;

  return (
    <Modal open={open} onClose={onClose} title="Edit project" wide>
      <form onSubmit={handleSubmit((values) => mutation.mutate(values))} className="space-y-4">
        <div>
          <label className="field-label" htmlFor="epName">Project name</label>
          <input id="epName" className="field-input" {...register('name', { required: 'Project name is required' })} />
          {errors.name && <p className="field-error">{errors.name.message}</p>}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="field-label" htmlFor="epCode">Project code</label>
            <input id="epCode" className="field-input font-mono" {...register('code')} />
          </div>
          <div>
            <label className="field-label" htmlFor="epStatus">Status</label>
            <select id="epStatus" className="field-input" {...register('status')}>
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="epPhase">Phase</label>
            <select id="epPhase" className="field-input" {...register('phase')}>
              <option value="">Unspecified</option>
              {PROJECT_PHASES.map((p) => (
                <option key={p} value={p}>{PROJECT_PHASE_LABELS[p]}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="field-label" htmlFor="epDescription">Description</label>
          <textarea id="epDescription" className="field-input min-h-20 resize-none" {...register('description')} />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="field-label" htmlFor="epLocation">Site / address</label>
            <input id="epLocation" className="field-input" {...register('location')} />
          </div>
          <div>
            <label className="field-label" htmlFor="epCity">City</label>
            <input id="epCity" className="field-input" {...register('city')} />
          </div>
          <div>
            <label className="field-label" htmlFor="epCountry">Country</label>
            <input id="epCountry" className="field-input" {...register('country')} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label" htmlFor="epStart">Start date</label>
            <input id="epStart" type="date" className="field-input" {...register('startDate')} />
          </div>
          <div>
            <label className="field-label" htmlFor="epEnd">Expected end date</label>
            <input id="epEnd" type="date" className="field-input" {...register('expectedEndDate')} />
          </div>
        </div>

        <div className="pt-2 border-t border-base-600 space-y-3">
          <div>
            <div className="field-label">Stakeholders</div>
            <p className="text-xs text-ink-500">
              Set once here — every RFI's exported PDF pulls these in automatically instead of asking again per document.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="field-label" htmlFor="epOrgCode">Org code</label>
              <input id="epOrgCode" className="field-input font-mono" placeholder="e.g. CSC" {...register('orgCode')} />
            </div>
            <div>
              <label className="field-label" htmlFor="epClient">Client</label>
              <input id="epClient" className="field-input" {...register('clientName')} />
            </div>
            <div>
              <label className="field-label" htmlFor="epLeadDesigner">Lead designer</label>
              <input id="epLeadDesigner" className="field-input" {...register('leadDesigner')} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="field-label" htmlFor="epConsultant">Consultant</label>
              <input id="epConsultant" className="field-input" {...register('consultantName')} />
            </div>
            <div>
              <label className="field-label" htmlFor="epTechAdvisor">Technical advisor</label>
              <input id="epTechAdvisor" className="field-input" {...register('technicalAdvisor')} />
            </div>
            <div>
              <label className="field-label" htmlFor="epPmc">PMC</label>
              <input id="epPmc" className="field-input" {...register('pmcName')} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label" htmlFor="epMainContractor">Main contractor</label>
              <input id="epMainContractor" className="field-input" {...register('mainContractor')} />
            </div>
            <div>
              <label className="field-label" htmlFor="epSubcontractor">Subcontractor</label>
              <input id="epSubcontractor" className="field-input" {...register('subcontractor')} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <div className="field-label mb-1">Logo</div>
              <div className="flex items-center gap-2">
                {project.logoUrl && (
                  <img src={project.logoUrl} alt="Project logo" className="w-10 h-10 object-contain rounded border border-base-600 bg-white" />
                )}
                <label className="btn-secondary !px-3 !py-1.5 text-xs cursor-pointer">
                  {logoMutation.isPending ? 'Uploading…' : project.logoUrl ? 'Change logo' : 'Upload logo'}
                  <input
                    type="file"
                    accept="image/jpeg,image/png"
                    className="hidden"
                    disabled={logoMutation.isPending}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) logoMutation.mutate(file);
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>
              {logoMutation.isError && <p className="field-error mt-1">{apiErrorMessage(logoMutation.error)}</p>}
            </div>
            <div>
              <div className="field-label mb-1">Stamp</div>
              <div className="flex items-center gap-2">
                {project.stampUrl && (
                  <img src={project.stampUrl} alt="Project stamp" className="w-10 h-10 object-contain rounded border border-base-600 bg-white" />
                )}
                <label className="btn-secondary !px-3 !py-1.5 text-xs cursor-pointer">
                  {stampMutation.isPending ? 'Uploading…' : project.stampUrl ? 'Change stamp' : 'Upload stamp'}
                  <input
                    type="file"
                    accept="image/jpeg,image/png"
                    className="hidden"
                    disabled={stampMutation.isPending}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) stampMutation.mutate(file);
                      e.target.value = '';
                    }}
                  />
                </label>
              </div>
              {stampMutation.isError && <p className="field-error mt-1">{apiErrorMessage(stampMutation.error)}</p>}
            </div>
          </div>
        </div>

        {mutation.isError && (
          <div className="text-sm text-danger bg-danger/10 border border-danger/30 rounded px-3 py-2">
            {apiErrorMessage(mutation.error)}
          </div>
        )}

        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          <button type="submit" className="btn-primary flex-1" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
