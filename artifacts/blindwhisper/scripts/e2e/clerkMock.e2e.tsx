// DEV-ONLY end-to-end mock for `@clerk/react` (aliased by vite.e2e.config.ts,
// never bundled). Identity comes from the `e2e_user` cookie — the same cookie
// the e2e Vite proxy turns into the API's `x-test-user` header — so the
// browser and the real API always agree on who is signed in. No cookie =
// signed out. Clerk's hosted widgets reuse the ui-preview placeholders.
import type { ReactNode } from "react";
import { SignIn as PreviewSignIn } from "../ui-preview/clerkMock";
export { SignUp, UserProfile, UserButton, SignInButton, SignUpButton, SignOutButton, ClerkProvider } from "../ui-preview/clerkMock";

// The placeholder card, plus where a real sign-in would land afterwards — so
// a scenario can assert a deep link survives the sign-in hop
// (lib/signInRedirect.ts) without a real Clerk.
export function SignIn(props: { forceRedirectUrl?: string } & Record<string, unknown>) {
  return (
    <div data-testid="e2e-sign-in" data-force-redirect-url={props.forceRedirectUrl ?? ""}>
      <PreviewSignIn {...props} />
    </div>
  );
}

function readClerkId(): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/(?:^|;\s*)e2e_user=([^;]+)/);
  return m ? decodeURIComponent(m[1]!) : null;
}

const CLERK_ID = readClerkId();
const SIGNED_OUT = !CLERK_ID;
const name = (CLERK_ID ?? "").replace(/^e2e_/, "");
const email = `${name}@e2e.test`;

const e2eUser = SIGNED_OUT
  ? null
  : {
      id: CLERK_ID!,
      firstName: name.charAt(0).toUpperCase() + name.slice(1),
      lastName: "Tester",
      fullName: `${name.charAt(0).toUpperCase() + name.slice(1)} Tester`,
      username: name,
      imageUrl: undefined as string | undefined,
      hasImage: false,
      twoFactorEnabled: true,
      totpEnabled: false,
      backupCodeEnabled: false,
      passkeys: [] as unknown[],
      primaryEmailAddress: { id: "em_1", emailAddress: email },
      emailAddresses: [{ id: "em_1", emailAddress: email }],
      primaryPhoneNumber: null,
      phoneNumbers: [] as unknown[],
      externalAccounts: [] as unknown[],
      publicMetadata: {},
      unsafeMetadata: {},
      createdAt: new Date(),
      reload: async () => e2eUser,
      update: async () => e2eUser,
    };

const getToken = async () => (SIGNED_OUT ? null : "e2e-token");
const session = SIGNED_OUT ? null : { id: "sess_e2e", getToken };

type ClerkListener = (resources: { user: typeof e2eUser; session: unknown }) => void;

const clerk = {
  loaded: true,
  user: e2eUser,
  session,
  addListener(listener: ClerkListener) {
    listener({ user: e2eUser, session });
    return () => {};
  },
  async signOut(opts?: { redirectUrl?: string }) {
    document.cookie = "e2e_user=; path=/; max-age=0";
    window.location.href = opts?.redirectUrl ?? "/";
  },
  openSignIn() {},
  openSignUp() {},
  openUserProfile() {},
  redirectToSignIn() {},
  redirectToSignUp() {},
};

export function Show({ when, children, fallback }: { when: "signed-in" | "signed-out" | unknown; children?: ReactNode; fallback?: ReactNode }) {
  const ok = when === "signed-in" ? !SIGNED_OUT : when === "signed-out" ? SIGNED_OUT : true;
  return <>{ok ? children : (fallback ?? null)}</>;
}

export function SignedIn({ children }: { children?: ReactNode }) {
  return <>{SIGNED_OUT ? null : children}</>;
}

export function SignedOut({ children }: { children?: ReactNode }) {
  return <>{SIGNED_OUT ? children : null}</>;
}

export function useUser() {
  return { isLoaded: true, isSignedIn: !SIGNED_OUT, user: e2eUser };
}

export function useAuth() {
  return {
    isLoaded: true,
    isSignedIn: !SIGNED_OUT,
    userId: CLERK_ID,
    sessionId: session?.id ?? null,
    orgId: null,
    getToken,
    signOut: clerk.signOut,
  };
}

export function useClerk() {
  return clerk;
}

export function useSession() {
  return { isLoaded: true, isSignedIn: !SIGNED_OUT, session };
}
