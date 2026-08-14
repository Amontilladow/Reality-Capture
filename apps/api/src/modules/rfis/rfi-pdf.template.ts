import { createElement as h } from 'react';

// @react-pdf/renderer is ESM-only ("type": "module" in its package.json);
// this API compiles to CommonJS (see apps/api/.swcrc), so it must be loaded
// via dynamic import() rather than a static import -- a static import would
// compile to require(), which cannot load an ESM package. Kept as the one
// place in this module that knows about @react-pdf/renderer at all, so
// rfis.service.ts / rfis.controller.ts stay free of PDF-library specifics.

export interface RfiPdfData {
  rfiNumber: string;
  status: string;
  priority: string;
  subject: string;
  question: string;
  answer?: string;
  disciplineLabel: string;
  disciplineOther?: string;
  costImpact: boolean;
  timeImpact: boolean;
  projectName: string;
  projectCode?: string;
  location?: string;
  date: string;
  clientName?: string;
  leadDesigner?: string;
  consultantName?: string;
  technicalAdvisor?: string;
  pmcName?: string;
  mainContractor?: string;
  subcontractor?: string;
  createdByName?: string;
  createdAt: string;
  answeredByName?: string;
  answeredAt?: string;
}

// prettier-ignore
const FIELD_ROWS: Array<[string, keyof RfiPdfData]> = [
  ['Client', 'clientName'],
  ['Lead Designer', 'leadDesigner'],
  ['Consultant', 'consultantName'],
  ['Technical Advisor', 'technicalAdvisor'],
  ['PMC', 'pmcName'],
  ['Main Contractor', 'mainContractor'],
  ['Subcontractor', 'subcontractor'],
];

export async function renderRfiPdf(data: RfiPdfData): Promise<Buffer> {
  const { Document, Page, View, Text, StyleSheet, renderToBuffer } = await import('@react-pdf/renderer');

  const styles = StyleSheet.create({
    page: { padding: 32, fontSize: 9, fontFamily: 'Helvetica', color: '#1a1a1a' },
    headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
    title: { fontSize: 16, fontFamily: 'Helvetica-Bold' },
    rfiNumber: { fontSize: 12, fontFamily: 'Helvetica-Bold', color: '#2563eb', marginTop: 2 },
    badge: { fontSize: 8, fontFamily: 'Helvetica-Bold', padding: '3 8', borderRadius: 2, backgroundColor: '#f1f5f9', textTransform: 'uppercase' },
    section: { border: '1 solid #cbd5e1', borderRadius: 3, padding: 10, marginBottom: 10 },
    sectionTitle: { fontSize: 8, fontFamily: 'Helvetica-Bold', textTransform: 'uppercase', color: '#64748b', marginBottom: 6, letterSpacing: 0.5 },
    row: { flexDirection: 'row', marginBottom: 4 },
    col: { flex: 1, paddingRight: 8 },
    label: { fontSize: 8, color: '#64748b', marginBottom: 1 },
    value: { fontSize: 9.5 },
    checkboxRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    checkboxItem: { flexDirection: 'row', alignItems: 'center', gap: 4, marginRight: 12, marginBottom: 4 },
    checkbox: { width: 9, height: 9, border: '1 solid #1a1a1a' },
    checkboxChecked: { width: 9, height: 9, border: '1 solid #1a1a1a', backgroundColor: '#1a1a1a' },
    impactRow: { flexDirection: 'row', gap: 24 },
    bodyText: { fontSize: 9.5, lineHeight: 1.5 },
    footerRow: { flexDirection: 'row', marginTop: 16, paddingTop: 10, borderTop: '1 solid #cbd5e1' },
    footerCol: { flex: 1 },
    footerLabel: { fontSize: 8, color: '#64748b', marginBottom: 12 },
    signatureLine: { borderTop: '1 solid #94a3b8', paddingTop: 3, fontSize: 8.5, width: 160 },
  });

  const checkbox = (label: string, checked: boolean) =>
    h(View, { style: styles.checkboxItem, key: label },
      h(View, { style: checked ? styles.checkboxChecked : styles.checkbox }),
      h(Text, null, label),
    );

  const field = (label: string, value?: string) =>
    h(View, { style: styles.col, key: label },
      h(Text, { style: styles.label }, label),
      h(Text, { style: styles.value }, value || '—'),
    );

  return renderToBuffer(
    h(Document, { title: data.rfiNumber },
      h(Page, { size: 'A4', style: styles.page },
        h(View, { style: styles.headerRow },
          h(View, null,
            h(Text, { style: styles.title }, 'REQUEST FOR INFORMATION'),
            h(Text, { style: styles.rfiNumber }, data.rfiNumber),
          ),
          h(Text, { style: styles.badge }, `${data.status} · ${data.priority}`),
        ),

        h(View, { style: styles.section },
          h(Text, { style: styles.sectionTitle }, 'Project'),
          h(View, { style: styles.row },
            field('Project Name', data.projectName),
            field('Project No.', data.projectCode),
          ),
          h(View, { style: styles.row },
            field('Location', data.location),
            field('Date', data.date),
          ),
        ),

        h(View, { style: styles.section },
          h(Text, { style: styles.sectionTitle }, 'Stakeholders'),
          h(View, { style: styles.row }, ...FIELD_ROWS.slice(0, 3).map(([label, key]) => field(label, data[key] as string | undefined))),
          h(View, { style: styles.row }, ...FIELD_ROWS.slice(3, 6).map(([label, key]) => field(label, data[key] as string | undefined))),
          h(View, { style: styles.row }, field(FIELD_ROWS[6][0], data[FIELD_ROWS[6][1]] as string | undefined)),
        ),

        h(View, { style: styles.section },
          h(Text, { style: styles.sectionTitle }, 'RFI Title'),
          h(Text, { style: styles.bodyText }, data.subject),
        ),

        h(View, { style: styles.section },
          h(Text, { style: styles.sectionTitle }, 'Discipline'),
          h(View, { style: styles.checkboxRow },
            ...['Civil', 'Structural', 'Architectural', 'Interior Design', 'Mechanical', 'Electrical', 'Plumbing', 'HVAC', 'Other']
              .map((label) => checkbox(label, data.disciplineLabel === label)),
          ),
          data.disciplineLabel === 'Other' && data.disciplineOther
            ? h(Text, { style: [styles.bodyText, { marginTop: 4 }] }, `Specified: ${data.disciplineOther}`)
            : null,
        ),

        h(View, { style: styles.section },
          h(Text, { style: styles.sectionTitle }, 'Impact of Reply'),
          h(View, { style: styles.impactRow },
            checkbox('Cost Impact', data.costImpact),
            checkbox('Time Impact', data.timeImpact),
          ),
        ),

        h(View, { style: styles.section },
          h(Text, { style: styles.sectionTitle }, 'Query'),
          h(Text, { style: styles.bodyText }, data.question),
        ),

        data.answer
          ? h(View, { style: styles.section },
              h(Text, { style: styles.sectionTitle }, 'Response'),
              h(Text, { style: styles.bodyText }, data.answer),
            )
          : null,

        h(View, { style: styles.footerRow },
          h(View, { style: styles.footerCol },
            h(Text, { style: styles.footerLabel }, `Raised by: ${data.createdByName ?? '—'}  ·  ${data.createdAt}`),
            h(Text, { style: styles.signatureLine }, 'Signature'),
          ),
          h(View, { style: styles.footerCol },
            h(Text, { style: styles.footerLabel },
              data.answeredByName ? `Answered by: ${data.answeredByName}  ·  ${data.answeredAt ?? ''}` : 'Answered by: —',
            ),
            h(Text, { style: styles.signatureLine }, 'Signature'),
          ),
        ),
      ),
    ),
  );
}
