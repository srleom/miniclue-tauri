/**
 * TiptapPageMentionInput
 *
 * Rich text composer using Tiptap v3 with a custom "citation" node (based on
 * the Mention extension). Replaces the textarea+overlay PageMentionInput.
 *
 * Features:
 *   - Typing "@" opens a page suggestion popup (same UX as before)
 *   - @N tokens are stored as citation nodes in the editor
 *   - Citation nodes render as "Page N" badges (secondaryOutline style)
 *   - Enter submits the form; Shift+Enter inserts a newline
 *   - Bidirectional sync with assistant-ui ComposerRuntime (loop-free)
 *
 * Storage format: @N (e.g. "@5") — unchanged from the old textarea approach.
 * The docToPlainText util converts editor JSON → "@N" text before writing to
 * the ComposerRuntime, and plainTextToDoc does the reverse when syncing back.
 */

import { useComposerRuntime } from '@assistant-ui/react';
import type { NodeViewProps } from '@tiptap/core';
import { Extension } from '@tiptap/core';
import Mention from '@tiptap/extension-mention';
import Placeholder from '@tiptap/extension-placeholder';
import {
  EditorContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditor,
} from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { BookOpen } from 'lucide-react';
import {
  type FC,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { badgeVariants } from '@/components/ui/badge';
import { docToPlainText, plainTextToDoc } from '@/lib/chat/citation-richtext';
import { usePageNavigation } from '@/lib/page-navigation-context';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SuggestionItem {
  label: string;
  /** Text stored in the editor: "@5" or "@currentPage" resolved to "@N" */
  page: number;
}

interface TiptapPageMentionInputProps {
  className?: string;
  autoFocus?: boolean;
  placeholder?: string;
  disabled?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isFuzzyMatch(query: string, target: string): boolean {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

function buildSuggestions(
  query: string,
  currentPage: number,
  totalPages: number
): SuggestionItem[] {
  const items: SuggestionItem[] = [];
  const q = query.toLowerCase();
  const maxPage = totalPages > 0 ? totalPages : 0;

  // Current page entry — shown when query is empty, matches "currentpage", or
  // is a generic "page" prefix without a specific number yet.
  const showCurrentPage =
    q === '' || 'currentpage'.includes(q) || isFuzzyMatch(q, 'currentpage');
  if (showCurrentPage) {
    items.push({ label: `Current Page (${currentPage})`, page: currentPage });
  }

  if (q === '') {
    for (let i = 1; i <= maxPage; i++) {
      items.push({ label: `Page ${i}`, page: i });
    }
  } else if (/^\d+$/.test(q)) {
    // Pure digit query — filter pages whose number starts with the digits typed.
    const exact = Number.parseInt(q, 10);
    const hasExact = exact > 0 && exact <= maxPage;
    if (hasExact) {
      items.push({ label: `Page ${exact}`, page: exact });
    }
    for (let i = 1; i <= maxPage; i++) {
      if (i === exact) continue;
      if (String(i).startsWith(q)) {
        items.push({ label: `Page ${i}`, page: i });
      }
    }
  } else if ('page'.startsWith(q)) {
    // Partial "page" prefix ("p", "pa", "pag") — show all pages
    for (let i = 1; i <= maxPage; i++) {
      items.push({ label: `Page ${i}`, page: i });
    }
  } else if (q.startsWith('page')) {
    // "page" prefix with optional number suffix, e.g. "@page" or "@page2".
    const suffix = q.slice(4); // everything after "page"
    if (suffix === '') {
      // Just "@page" — show all pages.
      for (let i = 1; i <= maxPage; i++) {
        items.push({ label: `Page ${i}`, page: i });
      }
    } else if (/^\d+$/.test(suffix)) {
      // "@page2", "@page12", etc. — filter by the numeric suffix.
      const exact = Number.parseInt(suffix, 10);
      const hasExact = exact > 0 && exact <= maxPage;
      if (hasExact) {
        items.push({ label: `Page ${exact}`, page: exact });
      }
      for (let i = 1; i <= maxPage; i++) {
        if (i === exact) continue;
        if (String(i).startsWith(suffix)) {
          items.push({ label: `Page ${i}`, page: i });
        }
      }
    }
  }

  return items;
}

// ---------------------------------------------------------------------------
// Citation node view — renders as "Page N" badge inside the editor
// ---------------------------------------------------------------------------

const CitationNodeView: FC<NodeViewProps> = ({ node }) => {
  const page = node.attrs.id as string;
  return (
    <NodeViewWrapper as="span" contentEditable={false} className="inline">
      <span
        className={cn(
          badgeVariants({ variant: 'secondaryOutline' }),
          'align-middle mx-0.5'
        )}
      >
        Page {page}
      </span>
    </NodeViewWrapper>
  );
};

// ---------------------------------------------------------------------------
// CitationExtension — Mention renamed to "citation" with React node view.
// Defined at module level so extension identity is stable across renders.
// ---------------------------------------------------------------------------

const CitationExtension = Mention.extend({
  name: 'citation',
  addNodeView() {
    return ReactNodeViewRenderer(CitationNodeView);
  },
});

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function TiptapPageMentionInput({
  className,
  autoFocus,
  placeholder,
  disabled = false,
}: TiptapPageMentionInputProps) {
  const { currentPage, totalPages } = usePageNavigation();
  const composerRuntime = useComposerRuntime();

  // Suggestion popup state
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestionItems, setSuggestionItems] = useState<SuggestionItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Refs for values needed inside Tiptap closures / stable callbacks
  const currentPageRef = useRef(currentPage);
  const totalPagesRef = useRef(totalPages);
  const submitRef = useRef<(() => void) | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Holds tiptap suggestion's command fn — called to insert a citation node
  const commandRef = useRef<
    ((props: { id: string; label: string | null }) => void) | null
  >(null);
  // Holds the latest onKeyDown handler from the suggestion render callbacks
  const keyDownRef = useRef<((event: KeyboardEvent) => boolean) | null>(null);
  // Tracks whether the runtime→editor sync is in progress (loop guard)
  const syncingFromRuntimeRef = useRef(false);

  // Keep page refs current
  useEffect(() => {
    currentPageRef.current = currentPage;
    totalPagesRef.current = totalPages;
  }, [currentPage, totalPages]);

  // Tracks the active query string while the suggestion popup is open
  const queryRef = useRef('');
  // Tracks showSuggestions without making it a reactive dependency
  const showSuggestionsRef = useRef(showSuggestions);
  useEffect(() => {
    showSuggestionsRef.current = showSuggestions;
  }, [showSuggestions]);

  // When the PDF is scrolled while the dropdown is open, rebuild suggestion
  // items so "Current Page (N)" stays in sync with the visible page.
  useEffect(() => {
    if (!showSuggestionsRef.current) return;
    const items = buildSuggestions(queryRef.current, currentPage, totalPages);
    setSuggestionItems(items);
    setSelectedIndex((prev) => Math.min(prev, Math.max(0, items.length - 1)));
  }, [currentPage, totalPages]);

  // Placeholder ref so it can be used in useMemo without being a dep
  const placeholderRef = useRef(
    placeholder ?? 'Send a message... (type @ to cite pages)'
  );
  useEffect(() => {
    placeholderRef.current =
      placeholder ?? 'Send a message... (type @ to cite pages)';
  }, [placeholder]);

  // Build submit callback (stable — reads containerRef)
  useEffect(() => {
    submitRef.current = () => {
      const form = containerRef.current?.closest('form');
      form?.requestSubmit();
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Stable setters captured via refs for use inside Tiptap suggestion render()
  // ---------------------------------------------------------------------------

  const setSuggestionsRef = useRef(setSuggestionItems);
  const setShowRef = useRef(setShowSuggestions);
  const setIndexRef = useRef(setSelectedIndex);
  useEffect(() => {
    setSuggestionsRef.current = setSuggestionItems;
  }, []);
  useEffect(() => {
    setShowRef.current = setShowSuggestions;
  }, []);
  useEffect(() => {
    setIndexRef.current = setSelectedIndex;
  }, []);

  // ---------------------------------------------------------------------------
  // Extensions — created once (stable, empty deps array)
  // ---------------------------------------------------------------------------

  const extensions = useMemo(() => {
    const SubmitExtension = Extension.create({
      name: 'submitOnEnter',
      addKeyboardShortcuts() {
        return {
          Enter: () => {
            // If suggestion popup is active, let the suggestion plugin handle it
            if (keyDownRef.current) return false;
            submitRef.current?.();
            return true;
          },
          'Shift-Enter': () => {
            // Insert a new paragraph (split the current block) instead of a
            // hard break node, which keeps the paragraph-based line model
            // consistent with docToPlainText / plainTextToDoc.
            return this.editor.commands.splitBlock();
          },
        };
      },
    });

    const citationWithSuggestion = CitationExtension.configure({
      suggestion: {
        char: '@',
        allowSpaces: false,
        items: ({ query }: { query: string }) => {
          return buildSuggestions(
            query,
            currentPageRef.current,
            totalPagesRef.current
          );
        },
        // biome-ignore lint/suspicious/noExplicitAny: Mention command props type is more restrictive than needed
        command: ({ editor, range, props }: any) => {
          if (!props.id) return;
          (editor as import('@tiptap/core').Editor)
            .chain()
            .focus()
            .deleteRange(range as import('@tiptap/core').Range)
            .insertContent({
              type: 'citation',
              attrs: { id: props.id as string, label: props.label ?? null },
            })
            .insertContent(' ')
            .run();
        },
        render: () => {
          return {
            onStart: (
              props: import('@tiptap/suggestion').SuggestionProps<SuggestionItem>
            ) => {
              queryRef.current = props.query ?? '';
              commandRef.current = (attrs) => props.command(attrs);
              const items = props.items as SuggestionItem[];
              setSuggestionsRef.current(items);
              setShowRef.current(items.length > 0);
              setIndexRef.current(0);
              // Provide keydown handler while popup is open
              keyDownRef.current = (event: KeyboardEvent) => {
                if (event.key === 'Escape') {
                  setShowRef.current(false);
                  keyDownRef.current = null;
                  return true;
                }
                return false;
              };
            },
            onUpdate: (
              props: import('@tiptap/suggestion').SuggestionProps<SuggestionItem>
            ) => {
              queryRef.current = props.query ?? '';
              commandRef.current = (attrs) => props.command(attrs);
              const items = props.items as SuggestionItem[];
              setSuggestionsRef.current(items);
              setShowRef.current(items.length > 0);
              setIndexRef.current((prev) =>
                Math.min(prev, Math.max(0, items.length - 1))
              );
            },
            onExit: () => {
              queryRef.current = '';
              commandRef.current = null;
              keyDownRef.current = null;
              setShowRef.current(false);
              setSuggestionsRef.current([]);
            },
            onKeyDown: (
              props: import('@tiptap/suggestion').SuggestionKeyDownProps
            ) => {
              const { event } = props;
              if (event.key === 'Escape') {
                setShowRef.current(false);
                keyDownRef.current = null;
                return true;
              }
              if (event.key === 'ArrowDown') {
                setIndexRef.current((prev) => {
                  const len = suggestionItemsRef.current.length;
                  return len === 0 ? 0 : (prev + 1) % len;
                });
                return true;
              }
              if (event.key === 'ArrowUp') {
                setIndexRef.current((prev) => {
                  const len = suggestionItemsRef.current.length;
                  return len === 0 ? 0 : prev === 0 ? len - 1 : prev - 1;
                });
                return true;
              }
              if (
                (event.key === 'Enter' && !event.shiftKey) ||
                event.key === 'Tab'
              ) {
                const items = suggestionItemsRef.current;
                const idx = selectedIndexRef.current;
                const item = items[idx];
                if (item && commandRef.current) {
                  commandRef.current({ id: String(item.page), label: null });
                }
                return true;
              }
              return false;
            },
          };
        },
      },
    });

    return [
      StarterKit.configure({
        heading: false,
        horizontalRule: false,
        blockquote: false,
        codeBlock: false,
        hardBreak: false,
      }),
      Placeholder.configure({
        placeholder: () => placeholderRef.current,
      }),
      citationWithSuggestion,
      SubmitExtension,
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally empty — values accessed via refs

  // ---------------------------------------------------------------------------
  // Refs for suggestion state (needed inside Tiptap onKeyDown closure)
  // ---------------------------------------------------------------------------

  const suggestionItemsRef = useRef<SuggestionItem[]>(suggestionItems);
  const selectedIndexRef = useRef(selectedIndex);
  useEffect(() => {
    suggestionItemsRef.current = suggestionItems;
  }, [suggestionItems]);
  useEffect(() => {
    selectedIndexRef.current = selectedIndex;
  }, [selectedIndex]);

  // ---------------------------------------------------------------------------
  // Editor instance
  // ---------------------------------------------------------------------------

  const editor = useEditor({
    extensions,
    autofocus: autoFocus ? 'end' : false,
    onUpdate: ({ editor: e }) => {
      if (syncingFromRuntimeRef.current) return;
      const plain = docToPlainText(e.getJSON());
      composerRuntime.setText(plain);
    },
  });

  // Dispatch an empty transaction when placeholder changes so the Placeholder
  // extension's decoration function re-runs and picks up the new ref value.
  // biome-ignore lint/correctness/useExhaustiveDependencies: placeholder is intentionally listed as a trigger dep even though it's not read inside the effect body
  useEffect(() => {
    if (!editor) return;
    editor.view.dispatch(editor.view.state.tr);
  }, [editor, placeholder]);

  // ---------------------------------------------------------------------------
  // Runtime → editor sync (loop-free)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!editor) return;

    const sync = () => {
      const runtimeText = composerRuntime.getState().text;
      const editorText = docToPlainText(editor.getJSON());
      if (runtimeText === editorText) return;

      syncingFromRuntimeRef.current = true;
      editor.commands.setContent(plainTextToDoc(runtimeText), {
        emitUpdate: false,
      });
      syncingFromRuntimeRef.current = false;
    };

    // Sync on mount in case runtime already has text (e.g. edit mode)
    sync();

    return composerRuntime.subscribe(sync);
  }, [editor, composerRuntime]);

  // ---------------------------------------------------------------------------
  // Suggestion item insertion
  // ---------------------------------------------------------------------------

  const insertSuggestion = useCallback((item: SuggestionItem) => {
    if (commandRef.current) {
      commandRef.current({ id: String(item.page), label: null });
    }
    setShowSuggestions(false);
  }, []);

  // Scroll selected item into view when selection changes
  const selectedItemRef = useRef<HTMLButtonElement | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: selectedIndex change triggers scroll via selectedItemRef
  useEffect(() => {
    selectedItemRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div
      ref={containerRef}
      className={cn('relative w-full', disabled && 'pointer-events-none')}
    >
      <EditorContent
        editor={editor}
        className={cn(
          'tiptap-composer',
          className,
          disabled && '[&_.ProseMirror]:caret-transparent'
        )}
      />

      {/* Suggestion popup */}
      {showSuggestions && suggestionItems.length > 0 && (
        <div
          className="absolute bottom-full left-0 mb-1 z-50 w-56 rounded-lg border border-border bg-popover shadow-md overflow-hidden"
          role="listbox"
          aria-label="Page suggestions"
        >
          <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border/50 bg-muted/30">
            <BookOpen className="h-3 w-3 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground">
              Cite a page
            </span>
          </div>
          <div className="max-h-48 overflow-y-auto">
            {suggestionItems.map((item, index) => (
              <button
                key={`${item.page}-${item.label}`}
                ref={index === selectedIndex ? selectedItemRef : null}
                type="button"
                role="option"
                aria-selected={index === selectedIndex}
                className={cn(
                  'w-full flex items-center px-3 py-2 text-left text-sm hover:bg-accent cursor-pointer transition-colors',
                  index === selectedIndex && 'bg-accent'
                )}
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertSuggestion(item);
                }}
              >
                <span className="font-medium text-foreground">
                  {item.label}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
