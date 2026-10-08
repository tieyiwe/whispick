// DEV-ONLY UI preview mock for `@clerk/react`.
//
// Aliased in place of the real package by vite.preview.config.ts — never
// bundled into production. Presents a fixed signed-in user ("Maya") unless the
// page URL carries `?signedOut=1` (read once, at module load), in which case
// everything behaves as a signed-out visitor.
//
// Only the surface the app actually imports is implemented. If the app starts
// importing something new from @clerk/react, add it here (grep:
//   grep -rn "@clerk/react" artifacts/blindwhisper/src
// ).
import type { ReactNode } from "react";

function readSignedOut(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("signedOut") === "1") {
      sessionStorage.setItem("uiPreview:signedOut", "1");
      return true;
    }
    if (params.get("signedOut") === "0") {
      sessionStorage.removeItem("uiPreview:signedOut");
      return false;
    }
    // Sticky across in-app navigations / reloads within the same tab, so a
    // redirect that drops the query string doesn't silently sign you back in.
    return sessionStorage.getItem("uiPreview:signedOut") === "1";
  } catch {
    return false;
  }
}

const SIGNED_OUT = readSignedOut();

const previewUser = {
  id: "user_preview",
  firstName: "Maya",
  lastName: "Rivera",
  fullName: "Maya Rivera",
  username: "maya",
  imageUrl: undefined as string | undefined,
  hasImage: false,
  twoFactorEnabled: false,
  totpEnabled: false,
  backupCodeEnabled: false,
  passkeys: [] as unknown[],
  primaryEmailAddress: { id: "idn_preview", emailAddress: "maya@example.com" },
  emailAddresses: [{ id: "idn_preview", emailAddress: "maya@example.com" }],
  primaryPhoneNumber: null,
  phoneNumbers: [] as unknown[],
  externalAccounts: [] as unknown[],
  publicMetadata: {},
  unsafeMetadata: {},
  createdAt: new Date("2025-01-15T12:00:00Z"),
  reload: async () => previewUser,
  update: async () => previewUser,
};

const user = SIGNED_OUT ? null : previewUser;
const getToken = async () => (SIGNED_OUT ? null : "preview-token");

type ClerkListener = (resources: { user: typeof user; session: unknown }) => void;

const clerk = {
  loaded: true,
  user,
  session: SIGNED_OUT ? null : { id: "sess_preview", getToken },
  addListener(listener: ClerkListener) {
    listener({ user, session: clerk.session });
    return () => {};
  },
  async signOut(opts?: { redirectUrl?: string }) {
    // eslint-disable-next-line no-console
    console.info("[ui-preview] signOut()", opts);
  },
  openSignIn() {},
  openSignUp() {},
  openUserProfile() {},
  redirectToSignIn() {},
  redirectToSignUp() {},
};

export function ClerkProvider({ children }: { children?: ReactNode; [key: string]: unknown }) {
  return <>{children}</>;
}

export function Show({
  when,
  children,
  fallback,
}: {
  when: "signed-in" | "signed-out" | unknown;
  children?: ReactNode;
  fallback?: ReactNode;
}) {
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
  return { isLoaded: true, isSignedIn: !SIGNED_OUT, user };
}

export function useAuth() {
  return {
    isLoaded: true,
    isSignedIn: !SIGNED_OUT,
    userId: SIGNED_OUT ? null : previewUser.id,
    sessionId: SIGNED_OUT ? null : "sess_preview",
    orgId: null,
    getToken,
    signOut: clerk.signOut,
  };
}

export function useClerk() {
  return clerk;
}

export function useSession() {
  return { isLoaded: true, isSignedIn: !SIGNED_OUT, session: clerk.session };
}

// --- Placeholder versions of Clerk's hosted UI components -----------------
// Styled roughly like the real dark-themed Clerk card (App.tsx's
// clerkAppearance: #2D2A45 card, #7C5CFC primary, 16px radius) so the page
// chrome around them can be reviewed. The card itself is NOT the real Clerk UI.

function FakeField({ label, placeholder }: { label: string; placeholder: string }) {
  return (
    <label style={{ display: "block", marginBottom: 14 }}>
      <span style={{ display: "block", fontSize: 13, color: "#c9c4e6", marginBottom: 6 }}>{label}</span>
      <span
        style={{
          display: "block",
          background: "#1e1b35",
          border: "1px solid rgba(156,149,192,0.25)",
          borderRadius: 10,
          padding: "10px 12px",
          fontSize: 14,
          color: "#9c95c0",
        }}
      >
        {placeholder}
      </span>
    </label>
  );
}

function FakeAuthCard({ mode }: { mode: "sign-in" | "sign-up" }) {
  const title = mode === "sign-in" ? "Sign in to Blind Whisper" : "Create your account";
  const subtitle = mode === "sign-in" ? "Welcome back! Please sign in to continue" : "Welcome! Please fill in the details to get started.";
  return (
    <div style={{ width: "100%", display: "flex", justifyContent: "center", position: "relative", zIndex: 1 }}>
      <div
        data-testid="clerk-preview-card"
        style={{
          background: "#2D2A45",
          borderRadius: 16,
          width: 440,
          maxWidth: "100%",
          padding: "32px 32px 24px",
          boxShadow: "0 0 24px rgba(124,92,252,0.15)",
          fontFamily: "'Inter', sans-serif",
          color: "#fff",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{title}</div>
          <div style={{ fontSize: 13, color: "#9c95c0", marginTop: 6 }}>{subtitle}</div>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
          {["Google", "Apple"].map((p) => (
            <span
              key={p}
              style={{
                flex: 1,
                textAlign: "center",
                border: "1px solid rgba(156,149,192,0.25)",
                borderRadius: 10,
                padding: "9px 0",
                fontSize: 13,
                color: "#e4e0ff",
              }}
            >
              {p}
            </span>
          ))}
        </div>
        <div style={{ textAlign: "center", fontSize: 12, color: "#9c95c0", margin: "6px 0 16px" }}>or</div>
        {mode === "sign-up" ? <FakeField label="First name" placeholder="Maya" /> : null}
        <FakeField label="Email address" placeholder="Enter your email address" />
        <FakeField label="Password" placeholder="••••••••" />
        <div
          style={{
            background: "#7C5CFC",
            borderRadius: 10,
            padding: "11px 0",
            textAlign: "center",
            fontWeight: 600,
            fontSize: 14,
            marginTop: 8,
          }}
        >
          Continue
        </div>
        <div style={{ textAlign: "center", fontSize: 13, color: "#9c95c0", marginTop: 20 }}>
          {mode === "sign-in" ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
        </div>
        <div style={{ textAlign: "center", fontSize: 10, color: "#6f6894", marginTop: 14, letterSpacing: 0.5 }}>
          [ui-preview placeholder — not the real Clerk widget]
        </div>
      </div>
    </div>
  );
}

export function SignIn(_props: Record<string, unknown>) {
  return <FakeAuthCard mode="sign-in" />;
}

export function SignUp(_props: Record<string, unknown>) {
  return <FakeAuthCard mode="sign-up" />;
}

export function UserProfile(_props: Record<string, unknown>) {
  return (
    <div
      data-testid="clerk-preview-user-profile"
      style={{
        background: "#2D2A45",
        borderRadius: 16,
        width: 720,
        maxWidth: "100%",
        minHeight: 320,
        padding: 32,
        color: "#c9c4e6",
        fontFamily: "'Inter', sans-serif",
        fontSize: 14,
      }}
    >
      <div style={{ fontWeight: 700, color: "#fff", fontSize: 18, marginBottom: 8 }}>Security</div>
      <div>Two-step verification · Passkeys · Active devices</div>
      <div style={{ fontSize: 10, color: "#6f6894", marginTop: 24 }}>[ui-preview placeholder — not the real Clerk UserProfile]</div>
    </div>
  );
}

export function UserButton(_props: Record<string, unknown>) {
  return (
    <span
      style={{
        display: "inline-flex",
        width: 32,
        height: 32,
        borderRadius: 999,
        background: "#7C5CFC",
        color: "#fff",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 700,
      }}
    >
      M
    </span>
  );
}

export function SignInButton({ children }: { children?: ReactNode }) {
  return <>{children ?? <button type="button">Sign in</button>}</>;
}

export function SignUpButton({ children }: { children?: ReactNode }) {
  return <>{children ?? <button type="button">Sign up</button>}</>;
}

export function SignOutButton({ children }: { children?: ReactNode }) {
  return <>{children ?? <button type="button">Sign out</button>}</>;
}
