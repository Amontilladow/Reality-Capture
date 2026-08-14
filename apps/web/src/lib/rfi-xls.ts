import * as XLSX from 'xlsx';
import type { Rfi, Project } from '@engineeringos/types';
import { RFI_DISCIPLINE_LABELS } from '@engineeringos/types';
import { RFI_STATUS_LABELS, RFI_PRIORITY_LABELS, formatDate } from './rfi-constants';

// Same client-side approach IssuesPage.tsx already uses (XLSX.utils +
// XLSX.writeFile) -- carries the same data as the PDF in a clean, editable
// single-sheet layout. Does NOT embed the logo/stamp images (SheetJS's
// community build has no image-write support) and isn't a pixel copy of
// any specific reference template -- see the plan doc for why.
export function downloadRfiXls(rfi: Rfi, project?: Project) {
  const discipline = rfi.discipline ? RFI_DISCIPLINE_LABELS[rfi.discipline] : '—';
  const disciplineDisplay = rfi.discipline === 'other' && rfi.disciplineOther
    ? `${discipline} — ${rfi.disciplineOther}`
    : discipline;

  const rows: (string | number)[][] = [
    ['REQUEST FOR INFORMATION', rfi.rfiNumber ?? rfi.id],
    [],
    ['PROJECT'],
    ['Project Name', project?.name ?? '—'],
    ['Project No.', project?.code ?? '—'],
    ['Location', project?.location ?? '—'],
    ['Date', formatDate(rfi.createdAt)],
    [],
    ['STAKEHOLDERS'],
    ['Client', project?.clientName ?? '—'],
    ['Lead Designer', project?.leadDesigner ?? '—'],
    ['Consultant', project?.consultantName ?? '—'],
    ['Technical Advisor', project?.technicalAdvisor ?? '—'],
    ['PMC', project?.pmcName ?? '—'],
    ['Main Contractor', project?.mainContractor ?? '—'],
    ['Subcontractor', project?.subcontractor ?? '—'],
    [],
    ['RFI DETAILS'],
    ['Status', RFI_STATUS_LABELS[rfi.status]],
    ['Priority', RFI_PRIORITY_LABELS[rfi.priority]],
    ['Discipline', disciplineDisplay],
    ['Cost Impact', rfi.costImpact ? 'Yes' : 'No'],
    ['Time Impact', rfi.timeImpact ? 'Yes' : 'No'],
    ['Due Date', formatDate(rfi.dueDate)],
    [],
    ['RFI TITLE'],
    [rfi.subject],
    [],
    ['QUERY'],
    [rfi.question],
    [],
    ['RESPONSE'],
    [rfi.answer ?? '(not yet answered)'],
  ];

  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = [{ wch: 22 }, { wch: 60 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'RFI');
  XLSX.writeFile(workbook, `${rfi.rfiNumber ?? rfi.id}.xlsx`);
}
