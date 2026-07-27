import { Logger } from '@nestjs/common';
import type { IfcProcessingStage } from '@engineeringos/types';

export interface StageTiming {
  stage: IfcProcessingStage;
  durationMs: number;
}

export class JobMetrics {
  private readonly logger = new Logger('IfcJobMetrics');
  private readonly jobStartedAt = Date.now();
  private stageStartedAt = Date.now();
  private peakRssBytes = 0;
  public readonly stageTimings: StageTiming[] = [];
  public elementsProcessed = 0;
  public elementsSkipped = 0;
  public readonly warnings: string[] = [];

  constructor(private readonly modelId: string) {
    this.sampleMemory();
  }

  private sampleMemory() {
    const rss = process.memoryUsage().rss;
    if (rss > this.peakRssBytes) this.peakRssBytes = rss;
  }

  startStage(stage: IfcProcessingStage) {
    this.stageStartedAt = Date.now();
    this.sampleMemory();
    this.logger.log(JSON.stringify({ event: 'stage_start', modelId: this.modelId, stage, timestamp: new Date().toISOString() }));
  }

  endStage(stage: IfcProcessingStage) {
    const durationMs = Date.now() - this.stageStartedAt;
    this.sampleMemory();
    this.stageTimings.push({ stage, durationMs });
    this.logger.log(JSON.stringify({
      event: 'stage_end',
      modelId: this.modelId,
      stage,
      durationMs,
      rssBytes: process.memoryUsage().rss,
      timestamp: new Date().toISOString(),
    }));
  }

  recordSkippedElement(guid: string, ifcType: string, reason: string) {
    this.elementsSkipped++;
    this.warnings.push(`Skipped ${ifcType} ${guid}: ${reason}`);
    this.logger.warn(JSON.stringify({ event: 'element_skipped', modelId: this.modelId, guid, ifcType, reason }));
  }

  get totalDurationMs(): number {
    return Date.now() - this.jobStartedAt;
  }

  get peakMemoryBytes(): number {
    this.sampleMemory();
    return this.peakRssBytes;
  }

  logJobStart() {
    this.logger.log(JSON.stringify({ event: 'job_start', modelId: this.modelId, timestamp: new Date().toISOString() }));
  }

  logJobEnd(status: 'SUCCESS' | 'FAILED' | 'PARTIAL') {
    this.logger.log(JSON.stringify({
      event: 'job_end',
      modelId: this.modelId,
      status,
      durationMs: this.totalDurationMs,
      peakMemoryBytes: this.peakMemoryBytes,
      elementsProcessed: this.elementsProcessed,
      elementsSkipped: this.elementsSkipped,
      timestamp: new Date().toISOString(),
    }));
  }
}
