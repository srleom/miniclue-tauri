/**
 * SlideLink component — renders [Slide N] citations as clickable badges
 * that navigate the PDF viewer to the referenced page.
 */
import { BookOpen } from 'lucide-react';
import { useSlideNavigation } from '@/lib/slide-navigation-context';
import { cn } from '@/lib/utils';

interface SlideLinkProps {
  page: number;
  className?: string;
}

export function SlideLink({ page, className }: SlideLinkProps) {
  const { navigateToPage } = useSlideNavigation();

  return (
    <button
      type="button"
      onClick={() => navigateToPage(page)}
      className={cn(
        'inline-flex items-center gap-1 align-baseline mx-0.5',
        'rounded-md border border-primary/30 bg-primary/8 px-1.5 py-0.5',
        'text-primary text-xs font-medium leading-none',
        'hover:bg-primary/15 hover:border-primary/50 transition-colors cursor-pointer',
        'no-underline',
        className
      )}
      title={`Go to slide ${page}`}
      aria-label={`Navigate to slide ${page}`}
    >
      <BookOpen className="h-3 w-3 shrink-0" />
      <span>Slide {page}</span>
    </button>
  );
}
