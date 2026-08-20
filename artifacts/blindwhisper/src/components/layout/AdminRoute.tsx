import { useSyncExternalStore } from "react";
import { Redirect, Link } from "wouter";
import { useGetUserProfile } from "@workspace/api-client-react";
import { Loader2, ShieldAlert } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import {
  getAdminMfaRequiredSnapshot,
  subscribeAdminMfaRequired,
  clearAdminMfaRequired,
} from "@/lib/adminMfaGate";

function AdminMfaRequiredScreen() {
  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center gap-4 bg-background px-6 text-center">
      <Logo className="h-10 w-auto text-primary" aria-hidden />
      <ShieldAlert className="w-10 h-10 text-amber-400" />
      <p className="font-serif text-lg text-foreground max-w-sm">
        Two-factor authentication is required for admin accounts
      </p>
      <p className="text-sm text-muted-foreground max-w-sm">
        Your account has admin access, but the admin panel is locked until you turn on 2FA. Set it up, then come
        back here.
      </p>
      <div className="flex items-center gap-3">
        <Link href="/account/security">
          <Button className="rounded-full" data-testid="button-set-up-mfa">
            Set up two-factor authentication
          </Button>
        </Link>
        <Button
          variant="outline"
          className="rounded-full"
          onClick={() => {
            clearAdminMfaRequired();
            window.location.reload();
          }}
          data-testid="button-retry-admin-mfa"
        >
          I've set it up — Retry
        </Button>
      </div>
    </div>
  );
}

export function AdminRoute({ component: Component }: { component: React.ComponentType }) {
  const { data: profile, isLoading } = useGetUserProfile();
  const mfaRequired = useSyncExternalStore(subscribeAdminMfaRequired, getAdminMfaRequiredSnapshot);

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
      </div>
    );
  }

  if (profile?.role !== "admin") {
    return <Redirect to="/dashboard" />;
  }

  if (mfaRequired) {
    return <AdminMfaRequiredScreen />;
  }

  return <Component />;
}
