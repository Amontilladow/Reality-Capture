// ── Brand ────────────────────────────────────────────────────────────────
// The SINGLE source of truth for this app's two client-side Excel exports'
// (rfi-xls.ts, reports-xls.ts) colors and font, so a downloaded spreadsheet
// reads as the same product as the live app instead of each export file
// carrying its own slowly-drifting copy of an old palette (confirmed by
// hand: both files had hardcoded a "dark blueprint/orange technical"
// palette and IBM Plex Sans, neither of which matched index.css any more
// after its "Jet Black / Smoke Grey / Cherry Red" rebrand). When the app's
// palette or font changes again, THIS is the one file to update for both.
//
// apps/api/src/common/pdf/brand.ts is this file's server-side counterpart,
// for every PDF template plus the two Excel exports that run in the API
// (issue-xls.ts, site-drawing-register-xls.ts); kept as a separate file
// rather than shared, since apps/web and apps/api are different bundles
// with no shared runtime module between them for this.
//
// Values are apps/web/src/index.css's LIGHT theme (:root block), not the
// dark theme that's now the app's default: a downloaded spreadsheet opens
// on a white sheet, never the app's own dark canvas, so the light theme's
// foreground/accent tones (chosen for contrast on a light surface) are
// what belongs here, same as any print letterhead vs. its parent app's
// on-screen theme.
//
// ExcelJS cell fonts/fills take an ARGB string ("FF" + RRGGBB, no "#").
export const INK = 'FF0B0B0C'; // ink-100 (light): primary text
export const MUTED = 'FF60636A'; // ink-500 (light): secondary/muted text
export const BORDER = 'FFCDCED2'; // base-600 (light): print-legible hairline
export const SECTION_FILL = 'FFECECEE'; // base-900 (light): a light tint for section/header fills
export const ACCENT = 'FFC8102E'; // signal (light & dark): Cherry Red
export const BLUEPRINT = 'FFB00E28'; // blueprint (light): a step deeper than signal, readable as small text on white

// The web's index.html loads Outfit from Google Fonts for the browser;
// ExcelJS just needs the family name as a string to write into the cell's
// font metadata (the generated .xlsx references it by name, same as any
// other spreadsheet -- it doesn't embed the font file).
export const FONT = 'Outfit';
