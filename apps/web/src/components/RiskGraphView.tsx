import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as d3Force from 'd3-force';
import { select } from 'd3-selection';
import { drag, type D3DragEvent } from 'd3-drag';
import { zoom, zoomIdentity, type D3ZoomEvent } from 'd3-zoom';
import { Modal } from './ui/Modal';
import { apiErrorMessage } from '../lib/api';
import { getRiskGraph, getGraphNodeDetail, type RiskGraphNode, type RiskLevel } from '../lib/risk.api';

const HEX = {
  ink500: '#7E8F9C', base700: '#22323F', base800: '#182631', base900: '#0F1922',
  blueprint: '#4FB6E8', ok: '#4ADE80', warn: '#FBBF24', danger: '#F87171',
};

const RISK_LEVEL_COLORS: Record<RiskLevel, string> = {
  LOW: HEX.ok, MODERATE: HEX.warn, HIGH: '#FB923C', CRITICAL: HEX.danger,
};

// Neutral per-node-type colors for nodes with no associated risk (structural
// context nodes -- building/level/location/user -- and risk-worthy nodes
// that currently have no active signals).
const NODE_TYPE_COLORS: Record<string, string> = {
  building: '#94A3B8', level: '#94A3B8', location: '#94A3B8',
  user: '#C084FC', company: '#C084FC',
  bim_model: '#22D3EE', bim_element: '#22D3EE',
  drawing: '#60A5FA', document: '#60A5FA', submittal: '#60A5FA', transmittal: '#60A5FA',
  capture: '#34D399',
  rfi: HEX.blueprint, issue: HEX.blueprint, snag_item: HEX.blueprint, qa_inspection: HEX.blueprint,
};

const NODE_TYPE_LABELS: Record<string, string> = {
  building: 'Building', level: 'Level', location: 'Location', user: 'User', company: 'Company',
  bim_model: 'BIM Model', bim_element: 'BIM Element', drawing: 'Drawing', document: 'Document',
  submittal: 'Submittal', transmittal: 'Transmittal', capture: 'Capture',
  rfi: 'RFI', issue: 'Issue', snag_item: 'Snag Item', qa_inspection: 'QA Inspection',
};

function nodeColor(node: RiskGraphNode): string {
  if (node.risk) return RISK_LEVEL_COLORS[node.risk.level];
  return NODE_TYPE_COLORS[node.nodeType] ?? HEX.ink500;
}

function nodeRadius(node: RiskGraphNode): number {
  if (node.risk) return 8 + node.risk.score / 12; // higher score = visually larger
  return ['building', 'level'].includes(node.nodeType) ? 9 : 6;
}

interface SimNode extends RiskGraphNode {
  x: number; y: number; vx?: number; vy?: number; fx?: number | null; fy?: number | null;
}
interface SimLink {
  source: string | SimNode; target: string | SimNode;
  relationshipType: string; edgeSource: string; confidence: number;
}

export function RiskGraphView({ projectId, initialRootNodeId, onClose }: { projectId: string; initialRootNodeId?: string; onClose: () => void }) {
  const [focusNodeId, setFocusNodeId] = useState<string | undefined>(initialRootNodeId);
  const [nodeTypeFilter, setNodeTypeFilter] = useState<string>('');
  const [disciplineFilter, setDisciplineFilter] = useState<string>('');
  const [riskLevelFilter, setRiskLevelFilter] = useState<string>('');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const graphQuery = useQuery({
    queryKey: ['risk-graph', projectId, focusNodeId, nodeTypeFilter, disciplineFilter],
    queryFn: () => getRiskGraph(projectId, {
      rootNodeId: focusNodeId,
      nodeTypes: nodeTypeFilter ? [nodeTypeFilter] : undefined,
      discipline: disciplineFilter || undefined,
    }),
  });

  const nodes = useMemo(() => {
    const all = graphQuery.data?.nodes ?? [];
    if (!riskLevelFilter) return all;
    // Risk-level filter only removes risk-bearing nodes that don't match --
    // structural context nodes (building/level/location/...) with no risk
    // of their own are always kept, so the graph doesn't lose its shape.
    return all.filter((n) => !n.risk || n.risk.level === riskLevelFilter);
  }, [graphQuery.data, riskLevelFilter]);

  const edges = useMemo(() => {
    const nodeIds = new Set(nodes.map((n) => n.id));
    return (graphQuery.data?.edges ?? []).filter((e) => nodeIds.has(e.fromNodeId) && nodeIds.has(e.toNodeId));
  }, [graphQuery.data, nodes]);

  const disciplines = useMemo(() => {
    const set = new Set<string>();
    (graphQuery.data?.nodes ?? []).forEach((n) => { if (n.discipline) set.add(n.discipline); });
    return [...set].sort();
  }, [graphQuery.data]);

  const nodeTypes = useMemo(() => {
    const set = new Set<string>();
    (graphQuery.data?.nodes ?? []).forEach((n) => set.add(n.nodeType));
    return [...set].sort();
  }, [graphQuery.data]);

  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return;
    if (nodes.length === 0) return;

    const width = containerRef.current.clientWidth || 800;
    const height = containerRef.current.clientHeight || 600;

    const simNodes: SimNode[] = nodes.map((n) => ({ ...n, x: width / 2 + (Math.random() - 0.5) * 100, y: height / 2 + (Math.random() - 0.5) * 100 }));
    const nodeById = new Map(simNodes.map((n) => [n.id, n]));
    const simLinks: SimLink[] = edges
      .filter((e) => nodeById.has(e.fromNodeId) && nodeById.has(e.toNodeId))
      .map((e) => ({ source: e.fromNodeId, target: e.toNodeId, relationshipType: e.relationshipType, edgeSource: e.source, confidence: e.confidence }));

    const svg = select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('viewBox', `0 0 ${width} ${height}`);

    const root = svg.append('g');

    const zoomBehavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .on('zoom', (event: D3ZoomEvent<SVGSVGElement, unknown>) => {
        root.attr('transform', event.transform.toString());
      });
    svg.call(zoomBehavior);
    svg.call(zoomBehavior.transform, zoomIdentity);

    const linkSelection = root.append('g').attr('stroke-opacity', 0.6)
      .selectAll('line')
      .data(simLinks)
      .join('line')
      .attr('stroke', (d) => (d.edgeSource === 'EXPLICIT' ? HEX.ink500 : HEX.blueprint))
      .attr('stroke-dasharray', (d) => (d.edgeSource === 'EXPLICIT' ? 'none' : '4,3'))
      .attr('stroke-width', (d) => 0.75 + d.confidence * 1.5);

    const nodeGroup = root.append('g')
      .selectAll<SVGGElement, SimNode>('g')
      .data(simNodes, (d) => d.id)
      .join('g')
      .style('cursor', 'pointer')
      .on('click', (_event, d) => setSelectedNodeId(d.id));

    nodeGroup.append('circle')
      .attr('r', nodeRadius)
      .attr('fill', nodeColor)
      .attr('stroke', HEX.base900)
      .attr('stroke-width', 1.5);

    nodeGroup.append('text')
      .text((d) => d.label.length > 28 ? `${d.label.slice(0, 28)}…` : d.label)
      .attr('x', 10)
      .attr('y', 4)
      .attr('font-size', 10)
      .attr('fill', '#EAF0F4')
      .style('pointer-events', 'none');

    nodeGroup.append('title').text((d) => `${NODE_TYPE_LABELS[d.nodeType] ?? d.nodeType}: ${d.label}`);

    const simulation = d3Force.forceSimulation(simNodes)
      .force('link', d3Force.forceLink<SimNode, SimLink>(simLinks).id((d) => d.id).distance(70).strength(0.4))
      .force('charge', d3Force.forceManyBody().strength(-180))
      .force('center', d3Force.forceCenter(width / 2, height / 2))
      .force('collide', d3Force.forceCollide<SimNode>().radius((d) => nodeRadius(d) + 4));

    simulation.on('tick', () => {
      linkSelection
        .attr('x1', (d) => (d.source as SimNode).x)
        .attr('y1', (d) => (d.source as SimNode).y)
        .attr('x2', (d) => (d.target as SimNode).x)
        .attr('y2', (d) => (d.target as SimNode).y);
      nodeGroup.attr('transform', (d) => `translate(${d.x},${d.y})`);
    });

    const dragBehavior = drag<SVGGElement, SimNode>()
      .on('start', (event: D3DragEvent<SVGGElement, SimNode, SimNode>) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        event.subject.fx = event.subject.x;
        event.subject.fy = event.subject.y;
      })
      .on('drag', (event: D3DragEvent<SVGGElement, SimNode, SimNode>) => {
        event.subject.fx = event.x;
        event.subject.fy = event.y;
      })
      .on('end', (event: D3DragEvent<SVGGElement, SimNode, SimNode>) => {
        if (!event.active) simulation.alphaTarget(0);
        // Leave fx/fy set -- pins the node where the user dropped it, a
        // deliberate choice so an arranged layout stays put until dragged again.
      });
    nodeGroup.call(dragBehavior);

    return () => { simulation.stop(); };
  }, [nodes, edges]);

  return (
    <Modal open onClose={onClose} title="Project Risk Graph" wide>
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          {focusNodeId && (
            <button onClick={() => setFocusNodeId(undefined)} className="btn-secondary !px-2.5 !py-1 text-xs">
              ← Show full graph
            </button>
          )}
          <select value={nodeTypeFilter} onChange={(e) => setNodeTypeFilter(e.target.value)} className="field-input w-auto text-xs !py-1">
            <option value="">All node types</option>
            {nodeTypes.map((t) => <option key={t} value={t}>{NODE_TYPE_LABELS[t] ?? t}</option>)}
          </select>
          <select value={disciplineFilter} onChange={(e) => setDisciplineFilter(e.target.value)} className="field-input w-auto text-xs !py-1">
            <option value="">All disciplines</option>
            {disciplines.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <select value={riskLevelFilter} onChange={(e) => setRiskLevelFilter(e.target.value)} className="field-input w-auto text-xs !py-1">
            <option value="">All risk levels</option>
            {(['CRITICAL', 'HIGH', 'MODERATE', 'LOW'] as RiskLevel[]).map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <span className="text-xs text-ink-500 ml-auto">{nodes.length} nodes · {edges.length} relationships</span>
        </div>

        <div className="flex items-center gap-4 text-xs text-ink-500 flex-wrap">
          <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: HEX.danger }} /> Critical</span>
          <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: '#FB923C' }} /> High</span>
          <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: HEX.warn }} /> Moderate</span>
          <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: HEX.ok }} /> Low</span>
          <span className="flex items-center gap-1"><span className="inline-block w-4 border-t border-ink-500" /> Explicit relationship</span>
          <span className="flex items-center gap-1"><span className="inline-block w-4 border-t border-dashed border-blueprint" /> Inferred relationship</span>
        </div>

        {graphQuery.isLoading && <p className="text-sm text-ink-500">Loading graph…</p>}
        {graphQuery.isError && <p className="field-error">{apiErrorMessage(graphQuery.error)}</p>}
        {graphQuery.data && nodes.length === 0 && (
          <div className="panel tick-frame p-10 text-center text-sm text-ink-500">No graph data matches the current filters.</div>
        )}

        <div ref={containerRef} className="panel tick-frame overflow-hidden" style={{ height: '60vh' }}>
          <svg ref={svgRef} className="w-full h-full" />
        </div>

        {selectedNodeId && (
          <GraphNodeDetailPanel
            projectId={projectId}
            nodeId={selectedNodeId}
            onClose={() => setSelectedNodeId(null)}
            onFocus={(id) => { setFocusNodeId(id); setSelectedNodeId(null); }}
          />
        )}
      </div>
    </Modal>
  );
}

function GraphNodeDetailPanel({ projectId, nodeId, onClose, onFocus }: { projectId: string; nodeId: string; onClose: () => void; onFocus: (nodeId: string) => void }) {
  const detailQuery = useQuery({ queryKey: ['risk-graph-node', projectId, nodeId], queryFn: () => getGraphNodeDetail(projectId, nodeId) });
  const detail = detailQuery.data;

  return (
    <Modal open onClose={onClose} title={detail?.node.label ?? 'Node detail'}>
      {detailQuery.isLoading && <p className="text-sm text-ink-500">Loading…</p>}
      {detail && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div><span className="text-ink-500">Type:</span> <span className="text-ink-100">{NODE_TYPE_LABELS[detail.node.nodeType] ?? detail.node.nodeType}</span></div>
            {detail.node.status && <div><span className="text-ink-500">Status:</span> <span className="text-ink-100">{detail.node.status}</span></div>}
            {detail.node.discipline && <div><span className="text-ink-500">Discipline:</span> <span className="text-ink-100">{detail.node.discipline}</span></div>}
            {detail.node.dueDate && <div><span className="text-ink-500">Due:</span> <span className="text-ink-100">{new Date(detail.node.dueDate).toLocaleDateString()}</span></div>}
          </div>

          {detail.risk && (
            <div className="panel p-3">
              <div className="text-xs text-ink-500 uppercase tracking-wide mb-1">Associated Risk</div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-semibold tabular-nums" style={{ color: RISK_LEVEL_COLORS[detail.risk.level] }}>{detail.risk.score}</span>
                <span className="text-sm text-ink-300">{detail.risk.title}</span>
              </div>
            </div>
          )}

          {detail.related.length > 0 && (
            <div>
              <div className="text-xs text-ink-500 uppercase tracking-wide mb-2">Connected ({detail.related.length})</div>
              <ul className="space-y-1 max-h-64 overflow-y-auto">
                {detail.related.map((r, i) => (
                  <li key={i} className="text-sm flex items-center justify-between">
                    <span className="text-ink-100">{r.node.label} <span className="text-ink-500 text-xs">({NODE_TYPE_LABELS[r.node.nodeType] ?? r.node.nodeType})</span></span>
                    <span className="text-xs text-ink-500">{r.direction === 'outgoing' ? '→' : '←'} {r.relationshipType}{r.source !== 'EXPLICIT' ? ' (inferred)' : ''}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button onClick={() => onFocus(nodeId)} className="btn-secondary !px-3 !py-1.5 text-xs">
            Focus graph on this node
          </button>
        </div>
      )}
    </Modal>
  );
}
