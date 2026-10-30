import { useMemo, useState } from 'react';
import type { BimSpatialNode } from '../../lib/bim.api';

interface TreeNode extends BimSpatialNode {
  children: TreeNode[];
}

function buildTree(nodes: BimSpatialNode[]): TreeNode[] {
  const byId = new Map<string, TreeNode>(nodes.map((n) => [n.id, { ...n, children: [] }]));
  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

function NodeRow({ node, depth, selectedId, onSelect }: {
  node: TreeNode; depth: number; selectedId: string | null; onSelect: (node: TreeNode) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <div
        className={`flex items-center gap-2 rounded px-2 py-2 text-sm cursor-pointer hover:bg-base-700 ${
          selectedId === node.id ? 'bg-blueprint-muted text-blueprint' : ''
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => onSelect(node)}
      >
        {hasChildren ? (
          <button
            type="button"
            className="w-4 text-ink-500"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
          >
            {expanded ? '▾' : '▸'}
          </button>
        ) : (
          <span className="w-4" />
        )}
        <span className="flex-1 truncate">{node.name ?? node.ifcType.replace('IFC', '')}</span>
        <span className="text-xs text-ink-500">{node.elementCount}</span>
      </div>
      {expanded && node.children.map((child) => (
        <NodeRow key={child.id} node={child} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} />
      ))}
    </div>
  );
}

export function SpatialTree({
  nodes,
  selectedId,
  onSelect,
}: {
  nodes: BimSpatialNode[];
  selectedId: string | null;
  onSelect: (node: { id: string; ifcGuid: string; name: string | null }) => void;
}) {
  const tree = useMemo(() => buildTree(nodes), [nodes]);

  if (nodes.length === 0) {
    return <p className="p-4 text-sm text-ink-500">No spatial hierarchy found in this model.</p>;
  }

  return (
    <div className="overflow-y-auto">
      {tree.map((root) => (
        <NodeRow key={root.id} node={root} depth={0} selectedId={selectedId} onSelect={onSelect} />
      ))}
    </div>
  );
}
