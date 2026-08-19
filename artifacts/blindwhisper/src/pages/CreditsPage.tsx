import { useGetUserProfile, useListCreditTransactions, useCreateCheckoutSession } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Check, Ghost, Zap, Flame, CreditCard, ArrowUpRight, Loader2 } from "lucide-react";

const PLANS = [
  {
    key: "spark",
    name: "Spark",
    price: "$9.99",
    period: "/month",
    icon: Zap,
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/30",
    features: [
      "Unlimited Whisper Links",
      "Scheduling",
      "Anonymous reply inbox",
      "2 Ghost Boost credits/month",
    ],
  },
  {
    key: "ember",
    name: "Ember",
    price: "$19.99",
    period: "/month",
    icon: Flame,
    color: "text-secondary",
    bg: "bg-secondary/10",
    border: "border-secondary/30",
    popular: true,
    features: [
      "Everything in Spark",
      "Mood tags",
      "Identity reveal flow",
      "Deep analytics per whisp",
      "5 Ghost Boost credits/month",
      "Family Blind Circle (5 members)",
      "Weekly Impact Digest",
    ],
  },
];

const CREDIT_PACKS = [
  { id: "single", boosts: 1, price: "$6.99", label: "Single Boost" },
  { id: "triple", boosts: 3, price: "$17.99", label: "3-Pack", savings: "Save 14%" },
  { id: "ten", boosts: 10, price: "$49.99", label: "10-Pack", savings: "Save 29%" },
  { id: "twentyfive", boosts: 25, price: "$99.99", label: "25-Pack", savings: "Save 43%" },
];

export function CreditsPage() {
  const { data: profile, isLoading: profileLoading } = useGetUserProfile();
  const { data: transactions, isLoading: txLoading } = useListCreditTransactions();
  const { toast } = useToast();
  const checkout = useCreateCheckoutSession();

  function startCheckout(kind: "credit_pack" | "plan", id: string) {
    checkout.mutate(
      { data: { kind, id } },
      {
        onSuccess: (res) => {
          if (res.url) {
            window.location.href = res.url;
          } else {
            toast({ title: "Checkout is not available right now", variant: "destructive" });
          }
        },
        onError: () => {
          toast({
            title: "Billing isn't set up yet",
            description: "Ask an admin to configure Stripe to enable payments.",
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
          <h1 className="text-3xl font-serif font-bold text-foreground">Credits & Plan</h1>
          <p className="text-muted-foreground mt-1">Manage your subscription and Ghost Boost credits.</p>
        </div>

        {/* Current plan status */}
        <Card className="bg-card border-border/50 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-48 h-48 bg-primary/5 rounded-full blur-[80px] -mr-20 -mt-20 pointer-events-none" />
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Current Plan</p>
                <div className="flex items-center gap-2">
                  <h2 className="text-2xl font-serif font-bold capitalize text-foreground">{profile?.plan ?? "Free"}</h2>
                  <Badge variant="outline" className="border-primary/40 text-primary capitalize">
                    {profile?.plan ?? "free"}
                  </Badge>
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm text-muted-foreground mb-1">Ghost Boost Credits</p>
                <div className="flex items-center gap-2 justify-end">
                  <Ghost className="w-5 h-5 text-primary" />
                  <span className="text-2xl font-bold text-foreground">{profile?.boostCredits ?? 0}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Subscription plans */}
        <div>
          <h2 className="text-xl font-serif font-semibold mb-4">Upgrade Your Plan</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {PLANS.map((plan) => {
              const Icon = plan.icon;
              const isCurrent = profile?.plan === plan.key;
              return (
                <Card
                  key={plan.key}
                  className={`bg-card border-border/50 relative overflow-hidden ${plan.popular ? "ring-1 ring-primary/40" : ""}`}
                  data-testid={`plan-card-${plan.key}`}
                >
                  {plan.popular && (
                    <div className="absolute top-3 right-3">
                      <Badge className="bg-primary text-primary-foreground text-xs">Most Popular</Badge>
                    </div>
                  )}
                  <div className={`absolute top-0 right-0 w-32 h-32 ${plan.bg} rounded-full blur-[60px] -mr-10 -mt-10 pointer-events-none`} />
                  <CardHeader className="pb-3">
                    <div className="flex items-center gap-3">
                      <div className={`p-2.5 rounded-xl ${plan.bg}`}>
                        <Icon className={`w-5 h-5 ${plan.color}`} />
                      </div>
                      <div>
                        <CardTitle className="text-lg font-serif">{plan.name}</CardTitle>
                        <div className="flex items-baseline gap-1">
                          <span className="text-2xl font-bold text-foreground">{plan.price}</span>
                          <span className="text-sm text-muted-foreground">{plan.period}</span>
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <ul className="space-y-2">
                      {plan.features.map((f) => (
                        <li key={f} className="flex items-start gap-2 text-sm">
                          <Check className={`w-4 h-4 ${plan.color} flex-shrink-0 mt-0.5`} />
                          <span className="text-muted-foreground">{f}</span>
                        </li>
                      ))}
                    </ul>
                    <Button
                      className={`w-full rounded-full ${
                        isCurrent
                          ? "opacity-60 cursor-not-allowed"
                          : plan.popular
                          ? "shadow-[0_0_15px_rgba(124,92,252,0.3)]"
                          : ""
                      }`}
                      disabled={isCurrent || checkout.isPending}
                      onClick={() => startCheckout("plan", plan.key)}
                      data-testid={`button-upgrade-${plan.key}`}
                    >
                      {checkout.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : isCurrent ? (
                        "Current Plan"
                      ) : (
                        <>
                          Upgrade to {plan.name}
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

        {/* Ghost Boost credit packs */}
        <div>
          <h2 className="text-xl font-serif font-semibold mb-4">Ghost Boost Credit Packs</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {CREDIT_PACKS.map((pack) => (
              <Card
                key={pack.id}
                className="bg-card border-border/50 hover:border-primary/30 transition-colors cursor-pointer relative overflow-hidden"
                data-testid={`credit-pack-${pack.id}`}
              >
                <CardContent className="p-4 text-center">
                  {pack.savings && (
                    <Badge className="absolute top-2 right-2 text-[10px] bg-green-500/20 text-green-400 border-green-500/30">
                      {pack.savings}
                    </Badge>
                  )}
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
                    <Ghost className="w-5 h-5 text-primary" />
                  </div>
                  <p className="text-2xl font-bold text-foreground">{pack.boosts}</p>
                  <p className="text-xs text-muted-foreground mb-3">{pack.boosts === 1 ? "Boost" : "Boosts"}</p>
                  <p className="text-lg font-semibold text-foreground mb-3">{pack.price}</p>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full rounded-full text-xs border-primary/30 hover:bg-primary/10 hover:text-primary"
                    disabled={checkout.isPending}
                    onClick={() => startCheckout("credit_pack", pack.id)}
                    data-testid={`button-buy-${pack.id}`}
                  >
                    {checkout.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Buy"}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* Transaction history */}
        <div>
          <h2 className="text-xl font-serif font-semibold mb-4">Credit History</h2>
          {txLoading ? (
            <Skeleton className="h-32 rounded-2xl" />
          ) : transactions && transactions.length > 0 ? (
            <Card className="bg-card border-border/50">
              <CardContent className="p-0">
                {transactions.map((tx, i) => (
                  <div
                    key={tx.id}
                    className={`flex items-center justify-between p-4 ${i < transactions.length - 1 ? "border-b border-border/50" : ""}`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                        <CreditCard className="w-4 h-4 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="text-sm font-medium capitalize text-foreground">{tx.type}</p>
                        <p className="text-xs text-muted-foreground">{new Date(tx.createdAt).toLocaleDateString()}</p>
                      </div>
                    </div>
                    <span className={`text-sm font-semibold ${tx.amount >= 0 ? "text-green-400" : "text-secondary"}`}>
                      {tx.amount >= 0 ? "+" : ""}{tx.amount} credits
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : (
            <Card className="bg-card/50 border-dashed border-border py-10 text-center">
              <CreditCard className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground text-sm">No credit transactions yet.</p>
            </Card>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
