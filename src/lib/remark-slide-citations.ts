/**
 * remarkSlideCitations
 *
 * A remark plugin that transforms `[Slide N]` text patterns in markdown
 * into `<a href="slide://N">Slide N</a>` link nodes, which the markdown
 * renderer then intercepts and renders as `<SlideLink>` components.
 *
 * Pattern matched: [Slide N] or [slide N] where N is a positive integer.
 */
import type { Link, PhrasingContent, Root, Text } from 'mdast';
import type { Plugin } from 'unified';
import { visit } from 'unist-util-visit';

const SLIDE_PATTERN = /\[Slide\s+(\d+)\]/gi;

export const remarkSlideCitations: Plugin<[], Root> = () => {
  return (tree: Root) => {
    visit(tree, 'text', (node: Text, index, parent) => {
      if (!parent || index === undefined) return;

      const text = node.value;
      const newNodes: PhrasingContent[] = [];
      let lastIndex = 0;

      SLIDE_PATTERN.lastIndex = 0;
      let match: RegExpExecArray | null;

      // biome-ignore lint/suspicious/noAssignInExpressions: standard regex loop pattern
      while ((match = SLIDE_PATTERN.exec(text)) !== null) {
        const matchStart = match.index;
        const matchEnd = matchStart + match[0].length;
        const pageNumber = match[1];

        // Text before this match
        if (matchStart > lastIndex) {
          newNodes.push({
            type: 'text',
            value: text.slice(lastIndex, matchStart),
          } as Text);
        }

        // Create a link node with the slide:// protocol
        const linkNode: Link = {
          type: 'link',
          url: `slide://${pageNumber}`,
          title: null,
          children: [
            {
              type: 'text',
              value: `Slide ${pageNumber}`,
            } as Text,
          ],
        };
        newNodes.push(linkNode);

        lastIndex = matchEnd;
      }

      // If no matches were found, leave the node unchanged
      if (newNodes.length === 0) return;

      // Remaining text after last match
      if (lastIndex < text.length) {
        newNodes.push({
          type: 'text',
          value: text.slice(lastIndex),
        } as Text);
      }

      // Replace the current text node with the array of new nodes
      parent.children.splice(index, 1, ...newNodes);
    });
  };
};
