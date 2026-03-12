/**
 * Utilities for converting between plain @N text and Tiptap JSON document
 * format for the citation-aware rich text composer.
 *
 * Storage format: @N (e.g. "@5") — matches parsePageMentions() in chat-runtime-provider.tsx
 * Tiptap node type: "citation" (Mention extension renamed)
 * Citation node attrs: { id: <page_number_string>, label: null }
 */

interface TextNode {
  type: 'text';
  text: string;
}

interface CitationNode {
  type: 'citation';
  attrs: { id: string; label: null };
}

interface ParagraphNode {
  type: 'paragraph';
  content?: (TextNode | CitationNode)[];
}

interface DocNode {
  type: 'doc';
  content: ParagraphNode[];
}

/**
 * Convert plain text (with @N tokens) to a Tiptap JSON document.
 *
 * Newlines become paragraph breaks.
 * @N tokens become citation nodes.
 */
export function plainTextToDoc(text: string): DocNode {
  const lines = text.split('\n');

  const paragraphs: ParagraphNode[] = lines.map((line) => {
    if (line === '') {
      return { type: 'paragraph' };
    }

    const parts = line.split(/(@\d+)/g);
    const content: (TextNode | CitationNode)[] = [];

    for (const part of parts) {
      if (part === '') continue;

      const match = part.match(/^@(\d+)$/);
      if (match) {
        content.push({
          type: 'citation',
          attrs: { id: match[1], label: null },
        });
      } else {
        content.push({ type: 'text', text: part });
      }
    }

    return {
      type: 'paragraph',
      content: content.length > 0 ? content : undefined,
    };
  });

  return {
    type: 'doc',
    content: paragraphs.length > 0 ? paragraphs : [{ type: 'paragraph' }],
  };
}

/**
 * Convert a Tiptap JSON document back to plain text with @N tokens.
 *
 * Citation nodes → @N
 * Paragraphs joined by newlines.
 */
export function docToPlainText(doc: unknown): string {
  const d = doc as DocNode;
  if (!d?.content) return '';

  const lines = d.content.map((paragraph) => {
    if (!paragraph.content) return '';
    return paragraph.content
      .map((node) => {
        if (node.type === 'text') return node.text;
        if (node.type === 'citation') return `@${node.attrs.id}`;
        return '';
      })
      .join('');
  });

  return lines.join('\n');
}
