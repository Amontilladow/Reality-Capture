// ── Brand ────────────────────────────────────────────────────────────────
// The SINGLE source of truth for every generated PDF or Excel export's
// colors and font, so a downloaded document reads as the same product as
// the live app without several separate copy-pasted palettes quietly
// drifting out of sync with it (confirmed by hand: every PDF template, plus
// this API's own Excel exports, had their own hardcoded copy of an old
// "dark blueprint/orange technical" palette and IBM Plex Sans, neither of
// which matched the live app any more after apps/web/src/index.css's
// "Jet Black / Smoke Grey / Cherry Red" rebrand). When the app's palette or
// font changes again, THIS is the one file to update for every API-side
// export; apps/web/src/lib/xls-brand.ts is this file's web-side
// counterpart, for the two exports (rfi-xls.ts, reports-xls.ts) that run
// client-side and can't import from this app.
//
// Values are the LIGHT theme's from apps/web/src/index.css's :root block,
// not the dark theme that's now the app's default: a generated document
// prints on white paper, never the app's own dark canvas, so the light
// theme's foreground/accent tones (chosen for contrast on a light surface)
// are what belongs here, same as any print letterhead vs. its parent
// app's on-screen theme.
export const INK = '#0B0B0C'; // ink-100 (light): primary body text
export const INK_MUTED = '#60636A'; // ink-500 (light): secondary text/labels
export const BORDER = '#CDCED2'; // base-600 (light): print-legible hairline
export const SECTION_FILL = '#ECECEE'; // base-900 (light): a light tint for badge/section fills
export const SIGNAL = '#C8102E'; // signal (light & dark): Cherry Red
export const BLUEPRINT = '#B00E28'; // blueprint (light): a step deeper than signal, readable as small text on white
export const AI_FILL = '#ECECEE'; // orange-muted (light): the app's own "AI-generated content" tint

// Status tones, matching the app's own ok/warn/danger/high vocabulary
// (index.css) rather than each template inventing its own ad hoc status
// colors.
export const OK = '#16783C';
export const WARN = '#8A5C0A';
export const DANGER = '#B91C1C';
export const HIGH = '#AA4014';

// A chart needs genuinely distinguishable hues for its series, which
// SIGNAL and BLUEPRINT no longer are under the new palette (both are
// Cherry Red family by design -- see index.css's own comment: "One accent
// across the platform: Cherry Red"). Built instead from the app's own
// status tones, which are already spread across distinct hues, plus one
// violet kept for a 5th/6th series that doesn't carry a status meaning.
export const CHART_PALETTE = [SIGNAL, OK, WARN, HIGH, '#6B3FA0', INK_MUTED];

// Real product font (Outfit, self-hosted via @fontsource; same family the
// live app loads from Google Fonts in index.html) rather than the PDF's
// own default Helvetica. "Outfit" itself is the family name registered
// below and used directly as every style's fontFamily value -- no
// separate exported name constant, since react-pdf takes it as a literal
// string either way.
//
// IBM Plex Mono was deliberately never registered in the old palette's
// fonts (its current "latin" WOFF build crashes fontkit's glyph-metrics
// parser on a bare space -- "Offset is outside the bounds of the
// DataView"); confirmed by hand that Outfit does NOT share this bug
// (rendered cleanly with spaces, numbers and punctuation in the same
// positions that broke Plex Mono), so there's nothing to route around
// here.
// ExcelJS cell fonts/fills take an ARGB string ("FF" + RRGGBB, no "#"),
// not the "#RRGGBB" react-pdf and CSS take; exported separately rather than
// making every XLS call site convert the hex constants above itself.
export const INK_ARGB = 'FF0B0B0C';
export const MUTED_ARGB = 'FF60636A';
export const BORDER_ARGB = 'FFCDCED2';
export const SECTION_FILL_ARGB = 'FFECECEE';
export const SIGNAL_ARGB = 'FFC8102E';
export const BLUEPRINT_ARGB = 'FFB00E28';

// The web's index.html loads Outfit from Google Fonts for the browser;
// ExcelJS just needs the family name as a string to write into the cell's
// font metadata (the generated .xlsx references it by name, same as any
// other spreadsheet -- it doesn't embed the font file the way a PDF does).
export const XLS_FONT = 'Outfit';

let fontsRegistered = false;
export function registerBrandFonts(Font: typeof import('@react-pdf/renderer').Font): void {
  if (fontsRegistered) return;
  fontsRegistered = true;
  Font.register({
    family: 'Outfit',
    fonts: [
      { src: require.resolve('@fontsource/outfit/files/outfit-latin-400-normal.woff'), fontWeight: 400 },
      { src: require.resolve('@fontsource/outfit/files/outfit-latin-600-normal.woff'), fontWeight: 600 },
      { src: require.resolve('@fontsource/outfit/files/outfit-latin-700-normal.woff'), fontWeight: 700 },
    ],
  });
  // react-pdf/yoga hyphenates justified text by default using a wordlist
  // this custom font doesn't need; disabling avoids odd mid-word breaks.
  Font.registerHyphenationCallback((word) => [word]);
}
