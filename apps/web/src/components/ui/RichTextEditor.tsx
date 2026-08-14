import { useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';

// Shared rich-text editor for RFI query/answer authoring (Phase 3). One
// component, two modes (editable / readOnly) -- reused for both fields per
// the ticket, rather than a second component or a parallel
// dangerouslySetInnerHTML renderer. Kept deliberately small: paragraphs,
// bold/italic, bullet/ordered lists, two heading levels -- everything
// StarterKit ships beyond that (code blocks, blockquotes, horizontal rules,
// strike, tables) is left off rather than wired up unused.
export function RichTextEditor({
  value,
  onChange,
  placeholder,
  readOnly,
}: {
  value: string;
  onChange?: (html: string) => void;
  placeholder?: string;
  readOnly?: boolean;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      Placeholder.configure({ placeholder: placeholder ?? 'Write…' }),
    ],
    content: value || '',
    editable: !readOnly,
    onUpdate: ({ editor: e }) => onChange?.(e.getHTML()),
    editorProps: {
      attributes: {
        class: 'rte-content',
      },
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the editor's document in sync with an externally-changed `value`
  // (e.g. the RFI query loading in after the detail query resolves, or the
  // form resetting) without fighting the user's own in-progress typing --
  // only pushes a new document when the prop actually diverges from what's
  // already rendered.
  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    if (value !== current && !(value === '' && current === '<p></p>')) {
      // Tiptap v3's setContent takes an options object (not a bare boolean
      // like v2) -- emitUpdate: false avoids re-triggering onUpdate/onChange
      // for a change that originated from the `value` prop itself.
      editor.commands.setContent(value || '', { emitUpdate: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editor]);

  useEffect(() => {
    editor?.setEditable(!readOnly);
  }, [readOnly, editor]);

  if (!editor) return null;

  return (
    <div className={`field-input !p-0 overflow-hidden ${readOnly ? 'bg-base-800/60' : ''}`}>
      {!readOnly && (
        <div className="flex items-center gap-0.5 border-b border-base-600 px-1.5 py-1 bg-base-800/60">
          <ToolbarButton label="B" title="Bold" bold active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} />
          <ToolbarButton label="I" title="Italic" italic active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} />
          <Divider />
          <ToolbarButton label="H2" title="Heading" active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} />
          <ToolbarButton label="H3" title="Subheading" active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} />
          <Divider />
          <ToolbarButton label="•" title="Bullet list" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} />
          <ToolbarButton label="1." title="Numbered list" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} />
        </div>
      )}
      <EditorContent editor={editor} className="px-3 py-2.5 text-sm text-ink-100 min-h-[100px]" />
    </div>
  );
}

// Tiptap's "empty" document still serializes to '<p></p>', not ''  -- plain
// .trim() on the stored HTML doesn't catch that, so every empty-field
// validation in this app that gates on a RichTextEditor value should use
// this instead of a bare truthiness/trim check.
export function isRichTextEmpty(html: string): boolean {
  const stripped = html.replace(/<p>\s*<\/p>/g, '').trim();
  return stripped.length === 0;
}

function Divider() {
  return <span className="w-px h-4 bg-base-600 mx-1" />;
}

function ToolbarButton({
  label, title, active, bold, italic, onClick,
}: {
  label: string;
  title: string;
  active?: boolean;
  bold?: boolean;
  italic?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`w-7 h-7 rounded text-xs font-mono flex items-center justify-center transition-colors ${
        active ? 'bg-signal text-base-950' : 'text-ink-300 hover:bg-base-700 hover:text-ink-100'
      } ${bold ? 'font-bold' : ''} ${italic ? 'italic' : ''}`}
    >
      {label}
    </button>
  );
}
