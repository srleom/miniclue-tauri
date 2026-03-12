import { Badge } from '@/components/ui/badge';

export type ProviderBadgeVariant =
  | 'free-tier'
  | 'paid'
  | 'custom'
  | 'always-active';

const badgeConfig: Record<
  ProviderBadgeVariant,
  { label: string; className: string }
> = {
  'free-tier': {
    label: 'Free Tier',
    className:
      'border-emerald-200 bg-emerald-100 text-[10px] font-bold tracking-wider text-emerald-700 uppercase dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
  },
  paid: {
    label: 'Paid Credits',
    className:
      'border-purple-200 bg-purple-100 text-[10px] font-bold tracking-wider text-purple-700 uppercase dark:border-purple-800 dark:bg-purple-900/30 dark:text-purple-400',
  },
  custom: {
    label: 'Custom',
    className:
      'border-blue-200 bg-blue-100 text-[10px] font-bold tracking-wider text-blue-700 uppercase dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  },
  'always-active': {
    label: 'Always active',
    className:
      'border-green-200 bg-green-100 text-[10px] font-bold tracking-wider text-green-700 uppercase dark:border-green-800 dark:bg-green-900/30 dark:text-green-400',
  },
};

export function ProviderBadge({ variant }: { variant: ProviderBadgeVariant }) {
  const { label, className } = badgeConfig[variant];
  return (
    <Badge variant="secondary" className={className}>
      {label}
    </Badge>
  );
}
