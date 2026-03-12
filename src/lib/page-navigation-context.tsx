import { createContext, useContext } from 'react';

export interface PageNavigationContextValue {
  currentPage: number;
  totalPages: number;
  navigateToPage: (page: number) => void;
}

export const PageNavigationContext = createContext<PageNavigationContextValue>({
  currentPage: 1,
  totalPages: 0,
  navigateToPage: () => {},
});

export function usePageNavigation(): PageNavigationContextValue {
  return useContext(PageNavigationContext);
}
