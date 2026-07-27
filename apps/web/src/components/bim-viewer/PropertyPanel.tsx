import type { BimElementDetail } from '../../lib/bim.api';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-gray-200 py-3">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h4>
      {children}
    </div>
  );
}

function KeyValueRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2 py-0.5 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="text-right text-gray-900">{value}</span>
    </div>
  );
}

export function PropertyPanel({ element, loading }: { element: BimElementDetail | null; loading: boolean }) {
  if (loading) {
    return <p className="p-3 text-sm text-gray-400">Loading properties…</p>;
  }
  if (!element) {
    return <p className="p-3 text-sm text-gray-400">Select an element in the viewer or spatial tree to inspect it.</p>;
  }

  const propertyEntries = Object.entries(element.properties ?? {}).filter(([, v]) => v !== null && v !== undefined);

  return (
    <div className="overflow-y-auto p-3">
      <Section title="Element">
        <KeyValueRow label="Name" value={element.ifcName ?? '—'} />
        <KeyValueRow label="Type" value={element.ifcType.replace('IFC', '')} />
        <KeyValueRow label="GUID" value={<span className="font-mono text-xs">{element.ifcGuid}</span>} />
        {element.spatialNodeName && (
          <KeyValueRow label="Location" value={`${element.spatialNodeName} (${element.spatialNodeType?.replace('IFC', '')})`} />
        )}
      </Section>

      {propertyEntries.length > 0 && (
        <Section title="Properties">
          {propertyEntries.map(([key, value]) => (
            <KeyValueRow key={key} label={key} value={String(value)} />
          ))}
        </Section>
      )}

      {element.quantities.length > 0 && (
        <Section title="Quantities">
          {element.quantities.map((q, i) => (
            <KeyValueRow
              key={i}
              label={q.name}
              value={q.value !== null ? `${q.value.toLocaleString()}${q.unit ? ` ${q.unit}` : ''}` : '—'}
            />
          ))}
        </Section>
      )}

      {element.materials.length > 0 && (
        <Section title="Materials">
          {element.materials.map((m, i) => (
            <KeyValueRow key={i} label={m.category ?? 'Material'} value={m.name} />
          ))}
        </Section>
      )}

      {element.classifications.length > 0 && (
        <Section title="Classifications">
          {element.classifications.map((c, i) => (
            <KeyValueRow key={i} label={c.system} value={[c.code, c.name].filter(Boolean).join(' — ') || '—'} />
          ))}
        </Section>
      )}
    </div>
  );
}
