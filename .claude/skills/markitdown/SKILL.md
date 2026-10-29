---
name: markitdown
description: Convert any user-uploaded or attached file (PDF, DOCX, PPTX, XLSX, CSV, HTML, images, audio, ZIP, EPUB, etc.) to Markdown with Microsoft MarkItDown BEFORE doing anything else with it. Use this skill every time the user uploads, attaches or points to a file — do not read or analyze the original file directly.
---

# MarkItDown: convert uploaded files to Markdown first

Whenever the user uploads or attaches a file, the FIRST step is converting it to `.md`
with [microsoft/markitdown](https://github.com/microsoft/markitdown). Do not open,
read, or analyze the original file. Work only from the generated Markdown.

## Steps

1. Make sure MarkItDown is installed:
   ```bash
   command -v markitdown || pip install "markitdown[all] @ git+https://github.com/microsoft/markitdown.git#subdirectory=packages/markitdown"
   ```
2. Convert the file, writing the result next to it with a `.md` extension:
   ```bash
   markitdown "<path/to/file.ext>" -o "<path/to/file>.md"
   ```
   - Several files: convert each one.
   - If the upload is already `.md`, skip conversion.
   - If conversion fails or produces empty output, tell the user and show the error;
     do not silently fall back to analyzing the original.
3. Read the generated `.md` file and carry on with the user's request using it.
4. Tell the user, in one line, which `.md` file(s) were created.
