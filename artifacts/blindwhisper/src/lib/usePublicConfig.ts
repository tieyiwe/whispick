import { useGetPublicConfig, getGetPublicConfigQueryKey } from "@workspace/api-client-react";

// Which phone delivery channels the server will accept right now (GET
// /api/config, backed by api-server's lib/messagingChannels.ts env flags).
// SMS/WhatsApp ship OFF at launch — US carriers' A2P 10DLC review rejected
// third-party consent — and come back with a server config change alone, no
// frontend release. The server rejects disabled channels regardless; this
// only keeps the UI from offering them.
//
// While loading (or on error) both read as disabled, so an option never
// flashes in and then disappears — the worst case is one appearing a beat
// late once the flags are turned on. Long staleTime: these flip on a deploy
// cadence, not mid-session.
export function usePublicConfig(): { smsEnabled: boolean; whatsappEnabled: boolean; isLoading: boolean } {
  const { data, isLoading } = useGetPublicConfig({
    query: { queryKey: getGetPublicConfigQueryKey(), staleTime: 30 * 60 * 1000, retry: 1 },
  });
  return {
    smsEnabled: data?.smsDeliveryEnabled === true,
    whatsappEnabled: data?.whatsappDeliveryEnabled === true,
    isLoading,
  };
}
