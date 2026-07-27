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
        className={`flex items-center gap-1 rounded px-2 py-1 text-sm cursor-pointer hover:bg-gray-100 ${
          selectedId === node.id ? 'bg-blue-50 text-blue-700' : ''
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => onSelect(node)}
      >
        {hasChildren ? (
          <button
            type="button"
            className="w-4 text-gray-400"
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
        <span className="text-xs text-gray-400">{node.elementCount}</span>
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
    return <p className="p-3 text-sm text-gray-400">No spatial hierarchy found in this model.</p>;
  }

  return (
    <div className="overflow-y-auto">
      {tree.map((root) => (
        <NodeRow key={root.id} node={root} depth={0} selectedId={selectedId} onSelect={onSelect} />
      ))}
    </div>
  );
}
