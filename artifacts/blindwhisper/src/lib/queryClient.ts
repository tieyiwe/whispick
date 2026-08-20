import { QueryCache, MutationCache, QueryClient } from "@tanstack/react-query";
import { isAdminMfaRequiredError, markAdminMfaRequired } from "./adminMfaGate";

function handlePossibleAdminMfaError(error: unknown): void {
  if (isAdminMfaRequiredError(error)) markAdminMfaRequired();
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
