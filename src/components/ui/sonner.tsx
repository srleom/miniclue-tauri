'use client';

// react
import * as React from 'react';

// third-party
import { Toaster as Sonner, ToasterProps } from 'sonner';

// local
import { useTheme } from '@/components/providers/theme-provider';

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = 'system' } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      className="toaster group"
      richColors={true}
      closeButton={true}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
