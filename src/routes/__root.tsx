import type { QueryClient } from '@tanstack/react-query';
import {
  createRootRouteWithContext,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import { ONBOARDING_DONE_KEY } from './onboarding';

interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: ({ location }) => {
    const done = localStorage.getItem(ONBOARDING_DONE_KEY);
    if (!done && location.pathname !== '/onboarding') {
      throw redirect({ to: '/onboarding' });
    }
  },
  component: RootComponent,
});

function RootComponent() {
  return <Outlet />;
}
