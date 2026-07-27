import { Injectable } from '@nestjs/common';
import type { IfcImportReport } from '@engineeringos/types';

export interface ReportInputs {
  modelId: string;
  projectId: string;
  projectName?: string;
  modelName: string;
  status: 'SUCCESS' | 'FAILED' | 'PARTIAL';
  durationMs: number;
  peakMemoryBytes: number;
  elementsProcessed: number;
  elementsSkipped: number;
  warnings: string[];
  errors: string[];
  spatialCounts: { sites: number; buildings: number; storeys: number; spaces: number };
  objectCounts: Record<string, number>;
  propertiesExtracted: number;
  materialsExtracted: number;
  quantitiesExtracted: number;
  relationshipsExtracted: number;
  fragmentsGenerated: boolean;
  fragmentsSizeBytes?: number;
}

@Injectable()
export class IfcReportService {
  build(input: ReportInputs): { report: IfcImportReport; text: string } {
    const report: IfcImportReport = {
      modelId: input.modelId,
      projectId: input.projectId,
      modelName: input.modelName,
      status: input.status,
      importDurationMs: input.durationMs,
      peakMemoryBytes: input.peakMemoryBytes,
      elementsProcessed: input.elementsProcessed,
      elementsSkipped: input.elementsSkipped,
      warnings: input.warnings,
      errors: input.errors,
      hierarchy: input.spatialCounts,
      objectCounts: input.objectCounts,
      propertiesExtracted: input.propertiesExtracted,
      materialsExtracted: input.materialsExtracted,
      quantitiesExtracted: input.quantitiesExtracted,
      relationshipsExtracted: input.relationshipsExtracted,
      fragmentsGenerated: input.fragmentsGenerated,
      fragmentsSizeBytes: input.fragmentsSizeBytes,
    };

    const fmtDuration = (ms: number) => {
      const s = ms / 1000;
      return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m ${(s % 60).toFixed(0)}s`;
    };
    const fmtMemory = (bytes: number) => (bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`);

    const objectLines = Object.entries(input.objectCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => `${type.padEnd(20)} ${count}`)
      .join('\n');

    const text = `IFC Import Report
=================

Project:  ${input.projectName ?? input.projectId}
Model:    ${input.modelName}

Import duration:     ${fmtDuration(input.durationMs)}
Peak memory:          ${fmtMemory(input.peakMemoryBytes)}
Elements processed:   ${input.elementsProcessed}
Elements skipped:     ${input.elementsSkipped}
Warnings:             ${input.warnings.length}
Errors:               ${input.errors.length}

Hierarchy
---------
Sites:      ${input.spatialCounts.sites}
Buildings:  ${input.spatialCounts.buildings}
Storeys:    ${input.spatialCounts.storeys}
Spaces:     ${input.spatialCounts.spaces}

Objects
-------
${objectLines || '(none)'}

Properties extracted:     ${input.propertiesExtracted}
Materials extracted:      ${input.materialsExtracted}
Quantities extracted:     ${input.quantitiesExtracted}
Relationships extracted:  ${input.relationshipsExtracted}

Fragments generated: ${input.fragmentsGenerated ? `YES (${fmtMemory(input.fragmentsSizeBytes ?? 0)})` : 'NO'}

${input.warnings.length > 0 ? `Warnings:\n${input.warnings.map((w) => `  - ${w}`).join('\n')}\n\n` : ''}${input.errors.length > 0 ? `Errors:\n${input.errors.map((e) => `  - ${e}`).join('\n')}\n\n` : ''}Status:
${input.status}
`;

    return { report, text };
  }
}
