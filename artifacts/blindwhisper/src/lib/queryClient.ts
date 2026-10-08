import { QueryCache, MutationCache, QueryClient } from "@tanstack/react-query";
import { adminMfaStateFromError, markAdminMfaState } from "./adminMfaGate";

function handlePossibleAdminMfaError(error: unknown): void {
  const state = adminMfaStateFromError(error);
  if (state) markAdminMfaState(state);
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: handlePossibleAdminMfaError }),
  mutationCache: new MutationCache({ onError: handlePossibleAdminMfaError }),
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60,
      retry: 1,
    },
  },
});
