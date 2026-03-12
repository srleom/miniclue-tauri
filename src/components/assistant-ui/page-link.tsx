/**
 * PageLink component — renders [Page N] citations as clickable badges
 * that navigate the PDF viewer to the referenced page.
 */
import { badgeVariants } from '@/components/ui/badge';
import { usePageNavigation } from '@/lib/page-navigation-context';
import { cn } from '@/lib/utils';

interface PageLinkProps {
  page: number;
  className?: string;
}

export function PageLink({ page, className }: PageLinkProps) {
  const { navigateToPage } = usePageNavigation();

  return (
    <button
      type="button"
      onClick={() => navigateToPage(page)}
      className={cn(
        badgeVariants({ variant: 'secondary' }),
        'cursor-pointer hover:bg-secondary/80 transition-colors align-baseline mx-0.5',
        className
      )}
      title={`Go to page ${page}`}
      aria-label={`Navigate to page ${page}`}
    >
      <span>Page {page}</span>
    </button>
  );
}
