import { createContext, useContext, useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";

export interface MobileSendAction {
  onClick: () => void;
  disabled: boolean;
}

// Lets a page override what the mobile bottom nav's raised round button
// does — see AppLayout.tsx, which defaults it to a plain Link to /send.
// That default is wrong on a page whose own composer IS the "send" action
// (Send Text Whisp): the button used to stay a live link to the video-whisp
// composer the whole time, so tapping it while filling out a Text Whisp
// abandoned that draft and opened a different compose flow instead of
// finishing the one already in progress.
//
// Split into two contexts (value vs. setter) rather than one, so a page
// registering/clearing an action via the setter doesn't itself re-render
// just because AppLayout's copy of the value changed.
const ValueContext = createContext<MobileSendAction | null>(null);
const SetterContext = createContext<Dispatch<SetStateAction<MobileSendAction | null>>>(() => {});

// Provided once, above the router (see App.tsx) — NOT inside AppLayout.
// Every page in this app renders <AppLayout> itself (wrapping its own
// content as `children`) rather than AppLayout wrapping the routes, so a
// page component sits ABOVE AppLayout in the tree. A provider placed inside
// AppLayout would only be visible to `children`'s own descendants, never to
// the page component's top-level hook calls (like useMobileSendAction
// below) which run before AppLayout even mounts. Hoisting the provider to
// the app root sidesteps that ordering entirely.
export function MobileSendActionProvider({ children }: { children: ReactNode }) {
  const [action, setAction] = useState<MobileSendAction | null>(null);
  return (
    <SetterContext.Provider value={setAction}>
      <ValueContext.Provider value={action}>{children}</ValueContext.Provider>
    </SetterContext.Provider>
  );
}

/** AppLayout's own read of whatever the current page has registered, if anything. */
export function useMobileSendActionValue(): MobileSendAction | null {
  return useContext(ValueContext);
}

/**
 * Registers an override for the mobile bottom nav's round Send button for as
 * long as the calling component stays mounted. Pass `null` to fall back to
 * the default /send link (e.g. once a page's own send has completed and
 * there's nothing left to submit).
 */
export function useMobileSendAction(action: MobileSendAction | null): void {
  const setAction = useContext(SetterContext);
  const onClick = action?.onClick ?? null;
  const disabled = action?.disabled ?? false;

  useEffect(() => {
    if (!onClick) {
      setAction(null);
      return;
    }
    setAction({ onClick, disabled });
    return () => setAction(null);
  }, [setAction, onClick, disabled]);
}
