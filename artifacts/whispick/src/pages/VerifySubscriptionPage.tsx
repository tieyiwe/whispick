import { useVerifySubscription, getVerifySubscriptionQueryKey } from "@workspace/api-client-react";
import { Logo } from "@/components/ui/logo";
import { Loader2, Check, X } from "lucide-react";

export function VerifySubscriptionPage() {
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  const { isLoading, isError } = useVerifySubscription(
    { token },
    { query: { enabled: !!token, retry: false, queryKey: getVerifySubscriptionQueryKey({ token }) } }
  );

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col items-center justify-center px-5 text-center relative overflow-hidden">
      <div className="absolute top-[-15%] left-[-15%] w-[70%] h-[45%] rounded-full blur-[110px] pointer-events-none bg-primary/15" />
      <div className="flex items-center gap-2 mb-8 relative z-10">
        <Logo className="w-6 h-6 text-primary" />
        <span className="font-serif text-xl font-bold text-foreground tracking-tight">whispick</span>
      </div>

      <div className="max-w-sm space-y-3 relative z-10" data-testid="verify-subscription-status">
        {!token || isError ? (
          <>
            <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
              <X className="w-6 h-6 text-destructive" />
            </div>
            <p className="font-medium text-foreground">Link not valid</p>
            <p className="text-sm text-muted-foreground">
              This confirmation link looks broken or expired. Head back to the subscribe page to sign up again.
            </p>
          </>
        ) : isLoading ? (
          <Loader2 className="w-6 h-6 text-primary mx-auto animate-spin" />
        ) : (
          <>
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
              <Check className="w-6 h-6 text-primary" />
            </div>
            <p className="font-medium text-foreground">You're confirmed</p>
            <p className="text-sm text-muted-foreground">
              You'll start getting anonymous whisps that match your topics. You can unsubscribe anytime from the link
              in any email we send.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
