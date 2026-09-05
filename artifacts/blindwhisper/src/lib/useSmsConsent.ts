import { useEffect, useState } from "react";
import { useCheckSmsConsent } from "@workspace/api-client-react";

// Decides whether a send screen needs to show the one-time SMS opt-in
// checkbox. Consent is once-per-recipient (see api-server's lib/smsConsent.ts
// and POST /user/sms-consent/check): a phone the sender has confirmed before
// doesn't need the box again. Returns true only while at least one of the
// currently-entered phone numbers has NOT been consented to yet.
//
// `active` lets callers switch the whole thing off (e.g. the chosen channel
// is email/WhatsApp, where the box never applies) without conditionally
// calling the hook. Debounced so typing a number doesn't fire a request per
// keystroke. On any lookup error it fails safe — treats everything as
// not-yet-consented, so the box shows and the server-side gate still
// enforces real consent.
export function useNeedsSmsConsent(phones: string[], active: boolean): boolean {
  const check = useCheckSmsConsent();
  const [consented, setConsented] = useState<string[]>([]);
  // Stable dependency: the set of phones as a string, so the effect only
  // re-runs when the actual numbers change, not on every parent render.
  const key = phones.join("|");

  useEffect(() => {
    if (!active || phones.length === 0) {
      setConsented([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      check.mutate(
        { data: { phones } },
        {
          onSuccess: (r) => {
            if (!cancelled) setConsented(r.consented);
          },
          onError: () => {
            if (!cancelled) setConsented([]);
          },
        },
      );
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // check is a fresh mutation object each render — intentionally excluded,
    // same pattern as the rest of this app's data-fetching effects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, active]);

  return active && phones.some((p) => !consented.includes(p));
}
