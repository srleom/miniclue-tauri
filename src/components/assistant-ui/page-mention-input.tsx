'use client';

/**
 * PageMentionInput
 *
 * Wraps the assistant-ui ComposerPrimitive.Input and adds a floating
 * suggestion popup when the user types "@". Supports:
 *   - @currentPage  → resolved to the actual page number at send-time
 *   - @N             → reference a specific page number
 *
 * Fuzzy matching rules:
 *   - Empty query:   show @currentPage + all numbered pages
 *   - Numeric query: show all pages whose number starts with the typed digits
 *                    (e.g. "@1" → 1, 10, 11…19, 100…), exact match first
 *   - Text query:    fuzzy-match against "currentPage" using both substring
 *                    and character-subsequence matching
 *
 * The raw text (with @-tokens) is stored verbatim in the composer input.
 * Parsing into page numbers happens in ChatRuntimeProvider before the
 * message is sent to the backend.
 */

import { ComposerPrimitive, useComposerRuntime } from '@assistant-ui/react';
import { BookOpen } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePageNavigation } from '@/lib/page-navigation-context';
import { cn } from '@/lib/utils';

interface SuggestionItem {
  label: string;
  value: string; // text inserted into composer
  description: string;
}

interface PageMentionInputProps {
  className?: string;
  rows?: number;
  autoFocus?: boolean;
  placeholder?: string;
  'aria-label'?: string;
}

/**
 * Returns true if `query` fuzzy-matches `target` as a character subsequence.
 * E.g. "cp" matches "currentPage", "cpa" matches "currentPage".
 */
function isFuzzyMatch(query: string, target: string): boolean {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

/**
 * Build the suggestion list for a given mentionQuery.
 *
 * Priority order:
 *  1. @currentPage (if query is empty, is a substring of "currentpage",
 *     or fuzzy-matches "currentpage")
 *  2. Exact numeric match (e.g. @3 when user typed "3")
 *  3. Prefix-matched numeric pages (e.g. @10…@19 when user typed "1")
 */
function buildSuggestions(
  mentionQuery: string,
  currentPage: number,
  totalPages: number
): SuggestionItem[] {
  const items: SuggestionItem[] = [];
  const q = mentionQuery.toLowerCase();

  // --- @currentPage ---
  const currentPageItem: SuggestionItem = {
    label: '@Current Page',
    value: '@currentPage',
    description: `Current page (${currentPage})`,
  };

  const showCurrentPage =
    q === '' || 'currentpage'.includes(q) || isFuzzyMatch(q, 'currentpage');

  if (showCurrentPage) {
    items.push(currentPageItem);
  }

  // --- Numeric suggestions ---
  const maxPage = totalPages > 0 ? totalPages : 0;

  if (q === '') {
    // Show all pages when query is empty
    for (let i = 1; i <= maxPage; i++) {
      items.push({
        label: `@Page ${i}`,
        value: `@${i}`,
        description: `Page ${i}`,
      });
    }
  } else if (/^\d+$/.test(q)) {
    // Numeric query: exact match first, then prefix matches
    const exact = Number.parseInt(q, 10);
    const hasExact = exact > 0 && exact <= maxPage;

    if (hasExact) {
      items.push({
        label: `@Page ${exact}`,
        value: `@${exact}`,
        description: `Page ${exact}`,
      });
    }

    // All pages whose string representation starts with the typed digits
    // (excluding the exact match already added)
    for (let i = 1; i <= maxPage; i++) {
      if (i === exact) continue; // already added above
      if (String(i).startsWith(q)) {
        items.push({
          label: `@Page ${i}`,
          value: `@${i}`,
          description: `Page ${i}`,
        });
      }
    }
  }
  // Pure text query: only @currentPage (already handled above), no numeric items

  return items;
}

export function PageMentionInput({
  className,
  rows,
  autoFocus,
  placeholder,
  'aria-label': ariaLabel,
}: PageMentionInputProps) {
  const { currentPage, totalPages } = usePageNavigation();
  const composerRuntime = useComposerRuntime();

  const [showSuggestions, setShowSuggestions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [atIndex, setAtIndex] = useState<number | null>(null);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  const suggestions = buildSuggestions(mentionQuery, currentPage, totalPages);

  // Clamp selectedIndex when suggestion list length changes
  useEffect(() => {
    setSelectedIndex((prev) =>
      Math.min(prev, Math.max(0, suggestions.length - 1))
    );
  }, [suggestions.length]);

  // Ref to the currently-highlighted dropdown button, used to scroll it into view
  const selectedItemRef = useRef<HTMLButtonElement | null>(null);

  const insertSuggestion = useCallback(
    (item: SuggestionItem) => {
      const textarea = inputRef.current;
      if (!textarea || atIndex === null) return;

      const currentText = composerRuntime.getState().text;
      const before = currentText.slice(0, atIndex);
      const after = currentText.slice(atIndex + 1 + mentionQuery.length);
      const resolvedValue =
        item.value === '@currentPage' ? `@${currentPage}` : item.value;
      const newText = `${before}${resolvedValue} ${after}`;

      composerRuntime.setText(newText);

      // Move cursor to after the inserted mention + space
      const newCursorPos = atIndex + resolvedValue.length + 1;
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(newCursorPos, newCursorPos);
      }, 0);

      setShowSuggestions(false);
      setMentionQuery('');
      setAtIndex(null);
    },
    [atIndex, mentionQuery, composerRuntime, currentPage]
  );

  // Handle keyboard navigation inside the suggestion popup (capture phase so
  // we can preventDefault before the composer sees Enter/Tab).
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (!showSuggestions || suggestions.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => {
          const next = (prev + 1) % suggestions.length;
          // Scroll after React flushes the state update
          setTimeout(
            () => selectedItemRef.current?.scrollIntoView({ block: 'nearest' }),
            0
          );
          return next;
        });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => {
          const next = prev === 0 ? suggestions.length - 1 : prev - 1;
          setTimeout(
            () => selectedItemRef.current?.scrollIntoView({ block: 'nearest' }),
            0
          );
          return next;
        });
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        const selected = suggestions[selectedIndex];
        if (selected) {
          e.preventDefault();
          e.stopPropagation();
          insertSuggestion(selected);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setShowSuggestions(false);
      }
    },
    [showSuggestions, suggestions, selectedIndex, insertSuggestion]
  );

  // Update mention query on every input event
  const handleInput = useCallback((e: React.FormEvent<HTMLTextAreaElement>) => {
    const textarea = e.currentTarget;
    const text = textarea.value;
    const cursorPos = textarea.selectionStart ?? text.length;

    // Find the last "@" before the cursor
    const textBeforeCursor = text.slice(0, cursorPos);
    const lastAtPos = textBeforeCursor.lastIndexOf('@');

    if (lastAtPos === -1) {
      setShowSuggestions(false);
      return;
    }

    // If there is whitespace between "@" and the cursor we're no longer in a token
    const tokenAfterAt = textBeforeCursor.slice(lastAtPos + 1);
    if (/\s/.test(tokenAfterAt)) {
      setShowSuggestions(false);
      return;
    }

    setAtIndex(lastAtPos);
    setMentionQuery(tokenAfterAt);
    setShowSuggestions(true);
    setSelectedIndex(0);
  }, []);

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative w-full">
      <ComposerPrimitive.Input
        ref={inputRef}
        placeholder={placeholder ?? 'Send a message... (type @ to cite pages)'}
        className={className}
        rows={rows}
        autoFocus={autoFocus}
        aria-label={ariaLabel}
        onInput={handleInput}
        onKeyDownCapture={handleKeyDown}
      />

      {/* Suggestions popup */}
      {showSuggestions && suggestions.length > 0 && (
        <div
          ref={suggestionsRef}
          className="absolute bottom-full left-0 mb-1 z-50 w-64 rounded-lg border border-border bg-popover shadow-md overflow-hidden"
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
            {suggestions.map((item, index) => (
              <button
                key={item.value}
                ref={index === selectedIndex ? selectedItemRef : null}
                type="button"
                role="option"
                aria-selected={index === selectedIndex}
                className={cn(
                  'w-full flex flex-col items-start px-3 py-2 text-left text-sm hover:bg-accent cursor-pointer transition-colors',
                  index === selectedIndex && 'bg-accent'
                )}
                onMouseDown={(e) => {
                  e.preventDefault(); // Prevent blur before click
                  insertSuggestion(item);
                }}
              >
                <span className="font-medium text-foreground">
                  {item.label}
                </span>
                <span className="text-xs text-muted-foreground">
                  {item.description}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
