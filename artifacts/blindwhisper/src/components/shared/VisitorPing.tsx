import { useEffect } from "react";
import { useSendVisitorPing } from "@workspace/api-client-react";
import { getVisitorId } from "@/lib/anonymousVisitor";

// How often each open tab pings while visible — well under
// VISITOR_ONLINE_WINDOW_MS (2 min) server-side, so a live-visitor roster
// stays accurate through a couple of missed pings without needing a much
// shorter interval. Not the same knob as how fast the admin dashboard
// itself refreshes (that's its own polling on the read side) — this is
// purely how fresh each visitor's own row stays.
const PING_INTERVAL_MS = 20_000;

// Mounted once, unconditionally, at the app's top level (see App.tsx) — not
// gated by sign-in, since the whole point is a live count that includes
// anonymous visitors too (see routes/visitorPing.ts). Renders nothing.
//
// The visitorId is always sent, even when signed in: the backend ignores it
// in that case (an authenticated ping keys on the account instead — see
// that route's own comment), so there's no need to conditionally omit it
// here.
export function VisitorPing() {
  const ping = useSendVisitorPing();

  useEffect(() => {
    function sendPing() {
      // Fire-and-forget — a failed ping just means this visitor drops out
      // of the live count a little early, never worth surfacing to anyone.
      ping.mutate({ data: { visitorId: getVisitorId() } });
    }

    sendPing();
    const interval = setInterval(() => {
      // Skip while the tab is hidden/backgrounded — a visitor who isn't
      // actually looking at the page shouldn't count as "currently on the
      // platform", and there's no reason to spend the request either.
      if (document.visibilityState === "visible") sendPing();
    }, PING_INTERVAL_MS);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
