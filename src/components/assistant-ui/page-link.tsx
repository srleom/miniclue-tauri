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
        badgeVariants({ variant: 'secondaryOutline' }),
        'cursor-pointer align-middle mx-0.5 hover:opacity-80 transition-opacity',
        className
      )}
      title={`Go to page ${page}`}
      aria-label={`Navigate to page ${page}`}
    >
      <span>Page {page}</span>
    </button>
  );
}
