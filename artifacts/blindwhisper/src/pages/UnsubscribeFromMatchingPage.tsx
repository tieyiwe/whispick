import { useUnsubscribeFromMatching, getUnsubscribeFromMatchingQueryKey } from "@workspace/api-client-react";
import { useTranslation } from "react-i18next";
import { LogoLockup } from "@/components/ui/logo";
import { Loader2, Check, X } from "lucide-react";

export function UnsubscribeFromMatchingPage() {
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  const { isLoading, isError } = useUnsubscribeFromMatching(
    { token },
    { query: { enabled: !!token, retry: false, queryKey: getUnsubscribeFromMatchingQueryKey({ token }) } }
  );
  const { t } = useTranslation("account");

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col items-center justify-center px-5 text-center relative overflow-hidden">
      <div className="absolute top-[-15%] left-[-15%] w-[70%] h-[45%] rounded-full blur-[110px] pointer-events-none bg-primary/15" />
      <LogoLockup className="mb-8 relative z-10" />

      <div className="max-w-sm space-y-3 relative z-10" data-testid="unsubscribe-status">
        {!token || isError ? (
          <>
            <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
              <X className="w-6 h-6 text-destructive" />
            </div>
            <p className="font-medium text-foreground">{t("unsubscribePage.linkNotValid")}</p>
            <p className="text-sm text-muted-foreground">{t("unsubscribePage.linkNotValidDescription")}</p>
          </>
        ) : isLoading ? (
          <Loader2 className="w-6 h-6 text-primary mx-auto animate-spin" />
        ) : (
          <>
            <div className="w-12 h-12 rounded-full bg-muted/60 flex items-center justify-center mx-auto">
              <Check className="w-6 h-6 text-muted-foreground" />
            </div>
            <p className="font-medium text-foreground">{t("unsubscribePage.unsubscribed")}</p>
            <p className="text-sm text-muted-foreground">
              {t("unsubscribePage.unsubscribedDescription")}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
