import { useEffect, useRef } from "react";
import { useUser } from "@clerk/react";
import { useClaimInvite } from "@workspace/api-client-react";
import { takePendingInvite } from "@/lib/pendingInvite";

// Fires once, right after a signed-in session is detected, to attribute a
// brand-new account back to the invite that brought them here — see
// lib/pendingInvite.ts. Mounted globally alongside the app's routes (not
// tied to a specific page) because Clerk's post-sign-up redirect target is
// fixed at /dashboard and can't be made invite-aware; this way attribution
// doesn't depend on which page happens to render first.
export function ClaimPendingInvite() {
  const { isSignedIn } = useUser();
  const claimedRef = useRef(false);
  const claimInvite = useClaimInvite();

  useEffect(() => {
    if (!isSignedIn || claimedRef.current) return;
    const token = takePendingInvite();
    if (!token) return;
    claimedRef.current = true;
    claimInvite.mutate({ data: { token } });
    // claimInvite is a fresh mutation object every render — depending only
    // on isSignedIn (plus the one-shot claimedRef guard) is deliberate so
    // this doesn't re-fire on every re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn]);

  return null;
}
