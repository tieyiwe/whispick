import { useEffect, useState, useSyncExternalStore } from "react";
import { Redirect } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import {
  useGetUserProfile,
  useGetAdminMfaStatus,
  useSetupAdminMfa,
  useVerifyAdminMfa,
} from "@workspace/api-client-react";
import { Loader2, ShieldCheck, KeyRound, Copy, Check } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  getAdminMfaStateSnapshot,
  subscribeAdminMfaState,
  clearAdminMfaState,
  getAdminMfaToken,
  storeAdminMfaToken,
} from "@/lib/adminMfaGate";

// The admin panel's own authenticator second factor, end to end: this
// route guard renders the enrollment screen (QR + first code + one-time
// backup codes) for an admin who hasn't set it up, and the code-entry
// screen for one whose session isn't unlocked yet. English-only like the
// rest of the admin surface. See lib/adminMfaGate.ts for the state/token
// plumbing and api-server's routes/adminMfa.ts for the endpoints.

function GateShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center gap-4 bg-background px-6 text-center">
      <Logo className="h-10 w-auto text-primary" aria-hidden />
      {children}
    </div>
  );
}

function CodeForm({
  onSubmit,
  pending,
  buttonLabel,
}: {
  onSubmit: (code: string) => void;
  pending: boolean;
  buttonLabel: string;
}) {
  const [code, setCode] = useState("");
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (code.trim()) onSubmit(code.trim());
      }}
    >
      <Input
        value={code}
        onChange={(e) => setCode(e.target.value)}
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="123 456"
        className="w-36 text-center text-lg tracking-widest rounded-xl"
        autoFocus
        data-testid="input-admin-mfa-code"
      />
      <Button type="submit" className="rounded-full" disabled={pending || !code.trim()} data-testid="button-admin-mfa-verify">
        {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : buttonLabel}
      </Button>
    </form>
  );
}

// Shown exactly once, right after enrollment — the only time the backup
// codes exist in plaintext anywhere.
function BackupCodesScreen({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <GateShell>
      <ShieldCheck className="w-10 h-10 text-emerald-400" />
      <p className="font-serif text-lg text-foreground max-w-sm">Two-factor authentication is on</p>
      <p className="text-sm text-muted-foreground max-w-sm">
        Save these one-time backup codes somewhere safe — each works once if you ever lose access to your
        authenticator app. This is the only time they'll be shown.
      </p>
      <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 font-mono text-sm text-foreground bg-card border border-border/50 rounded-2xl px-6 py-4">
        {codes.map((c) => (
          <span key={c} data-testid="text-backup-code">{c}</span>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <Button
          variant="outline"
          className="rounded-full"
          onClick={() => {
            void navigator.clipboard?.writeText(codes.join("\n")).then(() => setCopied(true));
          }}
        >
          {copied ? <Check className="w-4 h-4 mr-1.5" /> : <Copy className="w-4 h-4 mr-1.5" />}
          {copied ? "Copied" : "Copy codes"}
        </Button>
        <Button className="rounded-full" onClick={onDone} data-testid="button-backup-codes-done">
          I've saved them — open admin
        </Button>
      </div>
    </GateShell>
  );
}

function EnrollScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const { toast } = useToast();
  const setup = useSetupAdminMfa();
  const verify = useVerifyAdminMfa();
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);

  useEffect(() => {
    setup.mutate(undefined, {
      onSuccess: (result) => {
        setSecret(result.secret);
        void QRCode.toDataURL(result.otpauthUrl, { width: 220, margin: 1 }).then(setQrDataUrl);
      },
      onError: (err: any) => toast({ title: err?.data?.error ?? "Couldn't start 2FA setup", variant: "destructive" }),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleVerify(code: string) {
    verify.mutate(
      { data: { code } },
      {
        onSuccess: (result) => {
          storeAdminMfaToken(result.token);
          if (result.backupCodes?.length) {
            setBackupCodes(result.backupCodes);
          } else {
            onUnlocked();
          }
        },
        onError: (err: any) => toast({ title: err?.data?.error ?? "That code didn't match", variant: "destructive" }),
      },
    );
  }

  if (backupCodes) return <BackupCodesScreen codes={backupCodes} onDone={onUnlocked} />;

  return (
    <GateShell>
      <ShieldCheck className="w-10 h-10 text-amber-400" />
      <p className="font-serif text-lg text-foreground max-w-sm">Set up two-factor authentication</p>
      <p className="text-sm text-muted-foreground max-w-md">
        Admin accounts require an authenticator app. Scan this QR code with Google Authenticator, Authy,
        1Password, or your phone's built-in authenticator, then enter the 6-digit code it shows.
      </p>
      {qrDataUrl ? (
        <img src={qrDataUrl} alt="Scan with your authenticator app" className="rounded-2xl border border-border/50 bg-white p-2" data-testid="img-admin-mfa-qr" />
      ) : (
        <div className="w-[220px] h-[220px] rounded-2xl border border-border/50 flex items-center justify-center">
          <Loader2 className="w-6 h-6 text-primary animate-spin" />
        </div>
      )}
      {secret && (
        <p className="text-xs text-muted-foreground max-w-sm break-all">
          Can't scan? Enter this key manually: <span className="font-mono text-foreground">{secret}</span>
        </p>
      )}
      <CodeForm onSubmit={handleVerify} pending={verify.isPending} buttonLabel="Activate" />
    </GateShell>
  );
}

function UnlockScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const { toast } = useToast();
  const verify = useVerifyAdminMfa();

  function handleVerify(code: string) {
    verify.mutate(
      { data: { code } },
      {
        onSuccess: (result) => {
          storeAdminMfaToken(result.token);
          if (typeof result.backupCodesRemaining === "number") {
            toast({
              title: "Backup code used",
              description: `${result.backupCodesRemaining} backup codes remaining.`,
            });
          }
          onUnlocked();
        },
        onError: (err: any) => toast({ title: err?.data?.error ?? "That code didn't match", variant: "destructive" }),
      },
    );
  }

  return (
    <GateShell>
      <KeyRound className="w-10 h-10 text-primary" />
      <p className="font-serif text-lg text-foreground max-w-sm">Unlock the admin panel</p>
      <p className="text-sm text-muted-foreground max-w-sm">
        Enter the 6-digit code from your authenticator app (or a backup code).
      </p>
      <CodeForm onSubmit={handleVerify} pending={verify.isPending} buttonLabel="Unlock" />
    </GateShell>
  );
}

export function AdminRoute({ component: Component }: { component: React.ComponentType }) {
  const queryClient = useQueryClient();
  const { data: profile, isLoading } = useGetUserProfile();
  const gateState = useSyncExternalStore(subscribeAdminMfaState, getAdminMfaStateSnapshot);
  const isAdmin = profile?.role === "admin";
  // Proactive check so a fresh session sees the right screen immediately
  // instead of waiting for the first admin request to 403.
  const { data: mfaStatus, isLoading: statusLoading } = useGetAdminMfaStatus({
    query: { enabled: isAdmin },
  } as any);

  function unlocked() {
    clearAdminMfaState();
    // Anything that 403'd while locked is stale — refetch the world.
    void queryClient.invalidateQueries();
  }

  if (isLoading || (isAdmin && statusLoading)) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
      </div>
    );
  }

  if (!isAdmin) {
    return <Redirect to="/dashboard" />;
  }

  const needsSetup = gateState === "setup" || (mfaStatus && !mfaStatus.enrolled);
  const needsCode = gateState === "code" || (mfaStatus?.enrolled && !getAdminMfaToken());

  if (needsSetup) return <EnrollScreen onUnlocked={unlocked} />;
  if (needsCode) return <UnlockScreen onUnlocked={unlocked} />;

  return <Component />;
}
