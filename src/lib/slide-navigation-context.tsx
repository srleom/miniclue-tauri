import { createContext, useContext } from 'react';

export interface SlideNavigationContextValue {
  currentPage: number;
  totalPages: number;
  navigateToPage: (page: number) => void;
}

export const SlideNavigationContext =
  createContext<SlideNavigationContextValue>({
    currentPage: 1,
    totalPages: 0,
    navigateToPage: () => {},
  });

export function useSlideNavigation(): SlideNavigationContextValue {
  return useContext(SlideNavigationContext);
}
