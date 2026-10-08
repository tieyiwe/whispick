import { useGetUserProfile, useListCreditTransactions, useCreateCheckoutSession } from "@workspace/api-client-react";
import { useTranslation } from "react-i18next";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Check, Ghost, Zap, Flame, CreditCard, ArrowUpRight, ArrowDownLeft, Loader2, Gift, Sparkles, RotateCcw, type LucideIcon } from "lucide-react";
import { formatTimeAgo } from "@/lib/relativeTime";
import { GHOST_BOOST_ENABLED } from "@/lib/featureFlags";
import { usePublicConfig } from "@/lib/usePublicConfig";

// name/feature values are i18next keys, resolved via t() at render time
// (see AppLayout's NAV_ITEMS for the same labelKey pattern) — kept as data
// here so the plan/pack shape stays in one place, translated only where
// it's actually displayed.
const PLANS = [
  {
    key: "spark",
    nameKey: "creditsPage.plans.spark.name",
    price: "$9.99",
    icon: Zap,
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/30",
    featureKeys: [
      "creditsPage.plans.spark.features.unlimitedWhisperLinks",
      "creditsPage.plans.spark.features.scheduling",
      "creditsPage.plans.spark.features.anonymousReplyInbox",
      ...(GHOST_BOOST_ENABLED ? ["creditsPage.plans.spark.features.ghostBoostCredits"] : []),
    ],
  },
  {
    key: "ember",
    nameKey: "creditsPage.plans.ember.name",
    price: "$19.99",
    icon: Flame,
    color: "text-secondary",
    bg: "bg-secondary/10",
    border: "border-secondary/30",
    popular: true,
    featureKeys: [
      "creditsPage.plans.ember.features.everythingInSpark",
      "creditsPage.plans.ember.features.moodTags",
      "creditsPage.plans.ember.features.identityRevealFlow",
      "creditsPage.plans.ember.features.deepAnalytics",
      ...(GHOST_BOOST_ENABLED ? ["creditsPage.plans.ember.features.ghostBoostCredits"] : []),
      "creditsPage.plans.ember.features.familyBlindCircle",
      "creditsPage.plans.ember.features.weeklyImpactDigest",
    ],
  },
];

// Each kind of history row gets its own glyph so the list scans at a glance
// (buying a pack vs. a plan's monthly grant vs. spending one on a boost).
// Unknown types fall back to an in/out arrow based on the amount's sign.
const TX_ICONS: Record<string, LucideIcon> = {
  purchase: CreditCard,
  plan_grant: Sparkles,
  spend: Ghost,
  boost: Ghost,
  bonus: Gift,
  refund: RotateCcw,
};

const CREDIT_PACKS = [
  { id: "single", boosts: 1, price: "$6.99" },
  { id: "triple", boosts: 3, price: "$17.99", savingsKey: "creditsPage.savings.triple" },
  { id: "ten", boosts: 10, price: "$49.99", savingsKey: "creditsPage.savings.ten" },
  { id: "twentyfive", boosts: 25, price: "$99.99", savingsKey: "creditsPage.savings.twentyfive" },
];

export function CreditsPage() {
  const { data: profile, isLoading: profileLoading } = useGetUserProfile();
  const { data: transactions, isLoading: txLoading } = useListCreditTransactions();
  const { toast } = useToast();
  const checkout = useCreateCheckoutSession();
  const { t } = useTranslation("account");
  // Free launch: no plans or packs to buy until billing is switched on.
  const { billingEnabled } = usePublicConfig();

  function startCheckout(kind: "credit_pack" | "plan", id: string) {
    checkout.mutate(
      { data: { kind, id } },
      {
        onSuccess: (res) => {
          if (res.url) {
            window.location.href = res.url;
          } else {
            toast({ title: t("creditsPage.toastCheckoutUnavailable"), variant: "destructive" });
          }
        },
        onError: () => {
          toast({
            title: t("creditsPage.toastBillingNotSetUpTitle"),
            description: t("creditsPage.toastBillingNotSetUpDescription"),
            variant: "destructive",
          });
        },
      }
    );
  }

  if (profileLoading) {
    return (
      <AppLayout>
        <div className="space-y-6">
          <Skeleton className="h-8 w-48" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Skeleton className="h-64 rounded-2xl" />
            <Skeleton className="h-64 rounded-2xl" />
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">{t("creditsPage.title")}</h1>
          <p className="text-muted-foreground mt-1">{t("creditsPage.subtitle")}</p>
        </div>

        {/* Current plan status */}
        <Card className="bg-card border-border/50 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-48 h-48 bg-primary/5 rounded-full blur-[80px] -mr-20 -mt-20 pointer-events-none" />
          <CardContent className="p-5 sm:p-6">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">{t("creditsPage.currentPlanLabel")}</p>
                <h2 className="mt-1 text-2xl font-serif font-bold text-foreground" data-testid="text-current-plan">
                  {!profile?.plan || profile.plan === "free"
                    ? t("creditsPage.freePlanName")
                    : PLANS.some((p) => p.key === profile.plan)
                      ? t(`creditsPage.plans.${profile.plan}.name`)
                      : <span className="capitalize">{profile.plan}</span>}
                </h2>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm text-muted-foreground">{t("creditsPage.ghostBoostCreditsLabel")}</p>
                <div className="mt-1 flex items-center gap-2 justify-end">
                  <Ghost className="w-5 h-5 text-primary" />
                  <span className="text-2xl font-bold text-foreground tabular-nums">{profile?.boostCredits ?? 0}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {!billingEnabled && (
          <Card className="border-primary/25 bg-gradient-to-br from-primary/10 via-card to-card" data-testid="card-free-for-now">
            <CardContent className="p-5 sm:p-6">
              <h2 className="font-serif text-xl font-semibold text-foreground">{t("creditsPage.freeForNow.title")}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t("creditsPage.freeForNow.body")}</p>
            </CardContent>
          </Card>
        )}

        {/* Subscription plans */}
        {billingEnabled && (
        <div>
          <h2 className="text-xl font-serif font-semibold mb-4">{t("creditsPage.upgradeYourPlan")}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {PLANS.map((plan) => {
              const Icon = plan.icon;
              const isCurrent = profile?.plan === plan.key;
              const planName = t(plan.nameKey);
              return (
                <Card
                  key={plan.key}
                  className={`bg-card relative overflow-hidden flex flex-col ${plan.popular ? "border-primary/40" : "border-border/50"}`}
                  data-testid={`plan-card-${plan.key}`}
                >
                  {plan.popular && (
                    <div className="absolute top-3 right-3">
                      <Badge className="bg-primary text-primary-foreground text-xs">{t("creditsPage.mostPopular")}</Badge>
                    </div>
                  )}
                  <div className={`absolute top-0 right-0 w-32 h-32 ${plan.bg} rounded-full blur-[60px] -mr-10 -mt-10 pointer-events-none`} />
                  <CardHeader className="pb-3">
                    <div className="flex items-center gap-3">
                      <div className={`p-2.5 rounded-xl ${plan.bg}`}>
                        <Icon className={`w-5 h-5 ${plan.color}`} />
                      </div>
                      <div>
                        <CardTitle className="text-lg font-serif">{planName}</CardTitle>
                        <div className="flex items-baseline gap-1">
                          <span className="text-2xl font-bold text-foreground tabular-nums">{plan.price}</span>
                          <span className="text-sm text-muted-foreground">{t("creditsPage.perMonth")}</span>
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                  {/* flex-1 + mt-auto on the button: both plans' buttons sit on
                      the same baseline side by side, however long each
                      feature list is. */}
                  <CardContent className="flex flex-1 flex-col gap-5">
                    <ul className="space-y-2 flex-1">
                      {plan.featureKeys.map((fKey) => (
                        <li key={fKey} className="flex items-start gap-2 text-sm">
                          <Check className={`w-4 h-4 ${plan.color} flex-shrink-0 mt-0.5`} />
                          <span className="text-muted-foreground">{t(fKey)}</span>
                        </li>
                      ))}
                    </ul>
                    {/* One primary action: the popular plan gets the filled,
                        glowing button; the other is an outline button. */}
                    <Button
                      variant={plan.popular ? "default" : "outline"}
                      className={`mt-auto h-11 w-full rounded-full ${
                        isCurrent
                          ? "opacity-60 cursor-not-allowed"
                          : plan.popular
                          ? "shadow-[0_0_20px_rgba(124,92,252,0.35)]"
                          : "border-border/70"
                      }`}
                      disabled={isCurrent || checkout.isPending}
                      onClick={() => startCheckout("plan", plan.key)}
                      data-testid={`button-upgrade-${plan.key}`}
                    >
                      {checkout.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : isCurrent ? (
                        t("creditsPage.currentPlanButton")
                      ) : (
                        <>
                          {t("creditsPage.upgradeTo", { name: planName })}
                          <ArrowUpRight className="w-4 h-4 ml-1" />
                        </>
                      )}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
        )}

        {/* Ghost Boost credit packs */}
        {billingEnabled && GHOST_BOOST_ENABLED && (
          <div>
            <h2 className="text-xl font-serif font-semibold mb-4">{t("creditsPage.ghostBoostCreditPacks")}</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {CREDIT_PACKS.map((pack) => (
                <Card
                  key={pack.id}
                  className="bg-card border-border/50 hover:border-primary/30 transition-colors cursor-pointer relative overflow-hidden"
                  data-testid={`credit-pack-${pack.id}`}
                >
                  <CardContent className="p-4 text-center">
                    {pack.savingsKey && (
                      <Badge className="absolute top-2 right-2 text-[10px] bg-green-500/20 text-green-400 border-green-500/30">
                        {t(pack.savingsKey)}
                      </Badge>
                    )}
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
                      <Ghost className="w-5 h-5 text-primary" />
                    </div>
                    <p className="text-2xl font-bold text-foreground">{pack.boosts}</p>
                    <p className="text-xs text-muted-foreground mb-3">
                      {pack.boosts === 1 ? t("creditsPage.boostSingular") : t("creditsPage.boostPlural")}
                    </p>
                    <p className="text-lg font-semibold text-foreground mb-3">{pack.price}</p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full rounded-full text-xs border-primary/30 hover:bg-primary/10 hover:text-primary"
                      disabled={checkout.isPending}
                      onClick={() => startCheckout("credit_pack", pack.id)}
                      data-testid={`button-buy-${pack.id}`}
                    >
                      {checkout.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : t("creditsPage.buy")}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Transaction history */}
        <div>
          <h2 className="text-xl font-serif font-semibold mb-4">{t("creditsPage.creditHistory")}</h2>
          {txLoading ? (
            <Skeleton className="h-32 rounded-2xl" />
          ) : transactions && transactions.length > 0 ? (
            <Card className="bg-card border-border/50">
              <CardContent className="p-0">
                {transactions.map((tx, i) => {
                  const credit = tx.amount >= 0;
                  const TxIcon = TX_ICONS[tx.type] ?? (credit ? ArrowDownLeft : ArrowUpRight);
                  const created = new Date(tx.createdAt);
                  return (
                    <div
                      key={tx.id}
                      className={`flex items-center justify-between gap-3 px-4 py-3.5 sm:px-5 ${i < transactions.length - 1 ? "border-b border-border/50" : ""}`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-9 h-9 shrink-0 rounded-full flex items-center justify-center ${credit ? "bg-green-500/10" : "bg-secondary/10"}`}>
                          <TxIcon className={`w-4 h-4 ${credit ? "text-green-400" : "text-secondary"}`} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground">
                            {t(`creditsPage.txTypes.${tx.type}`, {
                              defaultValue: tx.type.charAt(0).toUpperCase() + tx.type.slice(1).replace(/_/g, " "),
                            })}
                          </p>
                          <time
                            dateTime={tx.createdAt}
                            title={created.toLocaleString()}
                            className="text-xs text-muted-foreground"
                          >
                            {formatTimeAgo(created)}
                          </time>
                        </div>
                      </div>
                      <span className={`shrink-0 text-sm font-semibold tabular-nums ${credit ? "text-green-400" : "text-secondary"}`}>
                        {t("creditsPage.creditsDelta", {
                          count: Math.abs(tx.amount),
                          amount: `${credit ? "+" : "−"}${Math.abs(tx.amount)}`,
                        })}
                      </span>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ) : (
            <Card className="bg-card/50 border-dashed border-border py-10 text-center">
              <CreditCard className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground text-sm">{t("creditsPage.noCreditTransactions")}</p>
            </Card>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
