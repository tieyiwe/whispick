import { UserProfile } from "@clerk/react";
import { useTranslation } from "react-i18next";
import { AppLayout } from "@/components/layout/AppLayout";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

// Clerk owns all 2FA/TOTP enrollment UI itself — there's no reason to
// hand-build a QR-code-and-backup-codes flow when <UserProfile /> already
// does it, fully wired to the same Clerk account requireAdmin checks
// server-side. Mounted with routing="path" the same way SignIn/SignUp are in
// App.tsx, so it needs to own the whole /account/security/* subtree for its
// own internal navigation (see the matching "*?" wildcard route).
export function AccountSecurity() {
  const { t } = useTranslation("account");
  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto space-y-4">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">{t("accountSecurityPage.title")}</h1>
          <p className="text-muted-foreground mt-1">
            {t("accountSecurityPage.subtitle")}
          </p>
        </div>
        <div className="flex justify-center">
          <UserProfile routing="path" path={`${basePath}/account/security`} />
        </div>
      </div>
    </AppLayout>
  );
}
