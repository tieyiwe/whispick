import { useState } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import {
  useAdminGetUsageStats,
  useAdminGenerateUsageInsights,
  useAdminGetCategoryStats,
  useAdminGetDeliveryMethodStats,
  useAdminGetLocationStats,
  useAdminGetDemographicStats,
  useAdminGetFunnelStats,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { RankedBarChart } from "@/components/shared/RankedBarChart";
import { deliveryLabel } from "@/lib/deliveryMethod";
import { GENDER_LABELS, AGE_RANGE_LABELS, type Gender, type AgeRange } from "@/lib/demographics";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Sparkles, Loader2, MousePointerClick } from "lucide-react";

const FUNNEL_STAGES = [
  { key: "sent", label: "Sent" },
  { key: "delivered", label: "Delivered" },
  { key: "opened", label: "Opened" },
  { key: "watched", label: "Watched" },
  { key: "replied", label: "Replied" },
  { key: "appreciated", label: "Appreciated" },
] as const;

// Feature-usage rankings + the AI analyzer. Most-used tells you what to
// protect; least-used (among features that have had a fair chance) is the
// trim/redesign shortlist; the analyzer turns both into concrete
// recommendations via Claude (lib/usageInsights.ts server-side).
function FeatureUsageSection() {
  const { toast } = useToast();
  const [days, setDays] = useState("30");
  const { data, isLoading } = useAdminGetUsageStats({ days: Number(days) });
  const analyze = useAdminGenerateUsageInsights();
  const [insights, setInsights] = useState<{ title: string; detail: string }[] | null>(null);

  const items = data?.items ?? [];
  const most = items.slice(0, 12);
  const least = items.length > 12 ? [...items].slice(-12).reverse() : [];

  function handleAnalyze() {
    analyze.mutate(
      { data: { days: Number(days) } },
      {
        onSuccess: (r) => setInsights(r.insights),
        onError: (err: any) => toast({ title: err?.data?.error ?? "Analyzer unavailable", variant: "destructive" }),
      },
    );
  }

  return (
    <Card className="bg-card border-border/50">
      <CardHeader className="flex flex-row items-center justify-between gap-3 flex-wrap space-y-0">
        <CardTitle className="flex items-center gap-2">
          <MousePointerClick className="w-5 h-5 text-primary" /> Feature usage
        </CardTitle>
        <div className="flex items-center gap-2">
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-28 rounded-full bg-input/50 border-border/50"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7 days</SelectItem>
              <SelectItem value="30">30 days</SelectItem>
              <SelectItem value="90">90 days</SelectItem>
            </SelectContent>
          </Select>
          <Button size="sm" className="rounded-full" onClick={handleAnalyze} disabled={analyze.isPending} data-testid="button-usage-insights">
            {analyze.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 mr-1.5" />}
            Smart insights
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {insights && (
          <div className="space-y-2">
            {insights.map((ins, i) => (
              <div key={i} className="rounded-xl border border-primary/30 bg-primary/5 p-3">
                <p className="text-sm font-semibold text-foreground">{ins.title}</p>
                <p className="text-sm text-muted-foreground mt-0.5">{ins.detail}</p>
              </div>
            ))}
          </div>
        )}

        {isLoading ? (
          <Skeleton className="h-40 rounded-2xl" />
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No usage recorded in this window yet — tracking starts counting from this deploy onward.
          </p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Most used</p>
              <div className="space-y-1">
                {most.map((f) => (
                  <div key={f.feature} className="flex items-center justify-between text-sm py-1.5 px-3 rounded-lg bg-muted/20">
                    <span className="text-foreground font-mono text-xs truncate">{f.feature}</span>
                    <span className="text-muted-foreground font-mono shrink-0 ml-3">{f.totalCount}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Least used</p>
              {least.length === 0 ? (
                <p className="text-sm text-muted-foreground">Not enough distinct features tracked yet to call anything "least used."</p>
              ) : (
                <div className="space-y-1">
                  {least.map((f) => (
                    <div key={f.feature} className="flex items-center justify-between text-sm py-1.5 px-3 rounded-lg bg-muted/20">
                      <span className="text-foreground font-mono text-xs truncate">{f.feature}</span>
                      <span className="text-muted-foreground font-mono shrink-0 ml-3">{f.totalCount}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function AdminAnalytics() {
  const { data: categoryStats, isLoading: categoriesLoading } = useAdminGetCategoryStats();
  const { data: deliveryStats, isLoading: deliveryLoading } = useAdminGetDeliveryMethodStats();
  const { data: locationStats, isLoading: locationsLoading } = useAdminGetLocationStats();
  const { data: demographicStats, isLoading: demographicsLoading } = useAdminGetDemographicStats();
  const { data: funnelStats, isLoading: funnelLoading } = useAdminGetFunnelStats();

  const categoryData = (categoryStats?.categories ?? []).map((c) => ({ label: c.label, value: c.weightedScore }));
  const deliveryData = (deliveryStats?.methods ?? []).map((m) => ({ label: deliveryLabel(m.method, null), value: m.count }));
  const channelData = (deliveryStats?.whisperLinkChannels ?? []).map((c) => ({ label: c.channel ?? "Unknown", value: c.count }));
  const countryData = (locationStats?.byCountry ?? []).map((c) => ({ label: c.country ?? "Unknown", value: c.count }));
  const regionData = (locationStats?.byRegion ?? []).map((r) => ({
    label: r.country ? `${r.region ?? "Unknown"}, ${r.country}` : (r.region ?? "Unknown"),
    value: r.count,
  }));
  const genderData = (demographicStats?.byGender ?? []).map((g) => ({
    label: (g.value && GENDER_LABELS[g.value as Gender]) || g.value || "Unknown",
    value: g.count,
  }));
  const ageRangeData = (demographicStats?.byAgeRange ?? []).map((a) => ({
    label: (a.value && AGE_RANGE_LABELS[a.value as AgeRange]) || a.value || "Unknown",
    value: a.count,
  }));
  const funnelData = FUNNEL_STAGES.map((s) => ({ label: s.label, value: funnelStats?.funnel[s.key] ?? 0 }));

  return (
    <AdminLayout>
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">Analytics</h1>
          <p className="text-muted-foreground mt-1">What people send, how it's delivered, and where they're sending from.</p>
        </div>

        <Card className="bg-card border-border/50">
          <CardHeader>
            <CardTitle className="text-base font-serif">Sent → delivered → opened → watched → replied</CardTitle>
            <p className="text-xs text-muted-foreground">
              Every recipient-directed whisp (Whisper Link, Group Whisper) — Blind Circle is excluded since it has no
              single recipient to fall off for.
              {funnelStats && funnelStats.funnel.failed > 0 ? ` ${funnelStats.funnel.failed} failed to send outright.` : ""}
            </p>
          </CardHeader>
          <CardContent>
            {funnelLoading ? <Skeleton className="h-40 rounded-xl" /> : <RankedBarChart data={funnelData} valueLabel="Whisps" />}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="bg-card border-border/50">
            <CardHeader>
              <CardTitle className="text-base font-serif">Delivery success rate by channel</CardTitle>
              <p className="text-xs text-muted-foreground">Every Twilio/email send attempt (initial sends and reminders), not just the first try.</p>
            </CardHeader>
            <CardContent className="space-y-2">
              {funnelLoading ? <Skeleton className="h-32 rounded-xl" /> : funnelStats?.deliveryByChannel.length ? (
                funnelStats.deliveryByChannel.map((c) => (
                  <div key={c.channel} className="flex items-center justify-between text-sm py-1.5 px-3 rounded-lg bg-muted/20">
                    <span className="text-foreground capitalize">{c.channel}</span>
                    <span className="text-muted-foreground">
                      {c.succeeded}/{c.attempts} accepted
                      <span className={`ml-2 font-medium ${c.successRate < 90 ? "text-destructive" : "text-foreground"}`}>{c.successRate}%</span>
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground py-8 text-center">No send attempts logged yet.</p>
              )}
            </CardContent>
          </Card>

          <Card className="bg-card border-border/50">
            <CardHeader>
              <CardTitle className="text-base font-serif">Blind Circles</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {funnelLoading ? <Skeleton className="h-32 rounded-xl" /> : (
                <>
                  <div className="flex items-center justify-between text-sm py-1.5 px-3 rounded-lg bg-muted/20">
                    <span className="text-foreground">Blind Circles / members</span>
                    <span className="text-muted-foreground font-mono">
                      {funnelStats?.circles.totalCircles ?? 0} / {funnelStats?.circles.totalMembers ?? 0}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm py-1.5 px-3 rounded-lg bg-muted/20">
                    <span className="text-foreground">Blind Circle posts</span>
                    <span className="text-muted-foreground font-mono">{funnelStats?.circles.totalDrops ?? 0}</span>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="bg-card border-border/50">
          <CardHeader>
            <CardTitle className="text-base font-serif">SMS/WhatsApp cost-saving: in-app vs Twilio</CardTitle>
            <p className="text-xs text-muted-foreground">
              Whisper Link / Group Whisper SMS or WhatsApp sends where the recipient's phone matched a known,
              verified Blind Whisper user — those deliver in-app for free instead of costing a real Twilio send.
              Covers initial sends, reminders, reveal requests, and reply notifications.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {funnelLoading ? <Skeleton className="h-24 rounded-xl" /> : (
              <>
                <div className="flex items-center justify-between text-sm py-1.5 px-3 rounded-lg bg-muted/20">
                  <span className="text-foreground">Delivered in-app (matched, no Twilio cost)</span>
                  <span className="text-muted-foreground font-mono">{funnelStats?.phoneMatchRouting.inApp ?? 0}</span>
                </div>
                <div className="flex items-center justify-between text-sm py-1.5 px-3 rounded-lg bg-muted/20">
                  <span className="text-foreground">Sent via Twilio (unmatched)</span>
                  <span className="text-muted-foreground font-mono">{funnelStats?.phoneMatchRouting.twilio ?? 0}</span>
                </div>
                <div className="flex items-center justify-between text-sm py-1.5 px-3 rounded-lg bg-muted/20">
                  <span className="text-foreground">In-app match rate</span>
                  <span className="text-muted-foreground font-mono">{funnelStats?.phoneMatchRouting.matchRate ?? 0}%</span>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-border/50">
          <CardHeader>
            <CardTitle className="text-base font-serif">AI Concierge ("Not sure what to send?")</CardTitle>
            <p className="text-xs text-muted-foreground">
              Usage of the composer's situation-to-suggestion assist — how often it's used, whether it found a library video to match, and
              whether that led to an actual send.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {funnelLoading ? <Skeleton className="h-24 rounded-xl" /> : (
              <>
                <div className="flex items-center justify-between text-sm py-1.5 px-3 rounded-lg bg-muted/20">
                  <span className="text-foreground">Requests</span>
                  <span className="text-muted-foreground font-mono">{funnelStats?.concierge.totalRequests ?? 0}</span>
                </div>
                <div className="flex items-center justify-between text-sm py-1.5 px-3 rounded-lg bg-muted/20">
                  <span className="text-foreground">Requests with a video match</span>
                  <span className="text-muted-foreground font-mono">
                    {funnelStats?.concierge.requestsWithVideoMatch ?? 0}
                    {funnelStats && funnelStats.concierge.totalRequests > 0
                      ? ` (${Math.round((funnelStats.concierge.requestsWithVideoMatch / funnelStats.concierge.totalRequests) * 100)}%)`
                      : ""}
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm py-1.5 px-3 rounded-lg bg-muted/20">
                  <span className="text-foreground">Led to a send</span>
                  <span className="text-muted-foreground font-mono">
                    {funnelStats?.concierge.sends ?? 0}
                    {funnelStats && funnelStats.concierge.totalRequests > 0
                      ? ` (${Math.round((funnelStats.concierge.sends / funnelStats.concierge.totalRequests) * 100)}%)`
                      : ""}
                  </span>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-border/50">
          <CardHeader>
            <CardTitle className="text-base font-serif">Invite a Friend</CardTitle>
            <p className="text-xs text-muted-foreground">
              Anonymous invite-a-friend volume and how many actually converted into a real account.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {funnelLoading ? <Skeleton className="h-24 rounded-xl" /> : (
              <>
                <div className="flex items-center justify-between text-sm py-1.5 px-3 rounded-lg bg-muted/20">
                  <span className="text-foreground">Invites sent</span>
                  <span className="text-muted-foreground font-mono">{funnelStats?.invites.sent ?? 0}</span>
                </div>
                <div className="flex items-center justify-between text-sm py-1.5 px-3 rounded-lg bg-muted/20">
                  <span className="text-foreground">Joined</span>
                  <span className="text-muted-foreground font-mono">
                    {funnelStats?.invites.joined ?? 0} ({funnelStats?.invites.conversionRate ?? 0}%)
                  </span>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-border/50">
          <CardHeader>
            <CardTitle className="text-base font-serif">Text Whisps</CardTitle>
            <p className="text-xs text-muted-foreground">
              Short, text-only anonymous messages to any phone number — in-app for existing users, a guest SMS link
              otherwise. See Moderation for flagged content — Text Whisp replies/messages run through the same
              content-safety pass as whisps.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {funnelLoading ? <Skeleton className="h-24 rounded-xl" /> : (
              <>
                <div className="flex items-center justify-between text-sm py-1.5 px-3 rounded-lg bg-muted/20">
                  <span className="text-foreground">Sent</span>
                  <span className="text-muted-foreground font-mono">{funnelStats?.textWhisps.sent ?? 0}</span>
                </div>
                <div className="flex items-center justify-between text-sm py-1.5 px-3 rounded-lg bg-muted/20">
                  <span className="text-foreground">Read</span>
                  <span className="text-muted-foreground font-mono">{funnelStats?.textWhisps.read ?? 0}</span>
                </div>
                <div className="flex items-center justify-between text-sm py-1.5 px-3 rounded-lg bg-muted/20">
                  <span className="text-foreground">Replied</span>
                  <span className="text-muted-foreground font-mono">{funnelStats?.textWhisps.replied ?? 0}</span>
                </div>
                <div className="flex items-center justify-between text-sm py-1.5 px-3 rounded-lg bg-muted/20">
                  <span className="text-foreground">Delivered in-app (existing users)</span>
                  <span className="text-muted-foreground font-mono">{funnelStats?.textWhisps.deliveredInApp ?? 0}</span>
                </div>
                <div className="flex items-center justify-between text-sm py-1.5 px-3 rounded-lg bg-muted/20">
                  <span className="text-foreground">Delivered as guest link (SMS)</span>
                  <span className="text-muted-foreground font-mono">{funnelStats?.textWhisps.deliveredGuest ?? 0}</span>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-border/50">
          <CardHeader>
            <CardTitle className="text-base font-serif">Most-sent video categories</CardTitle>
            <p className="text-xs text-muted-foreground">
              Ranked by weighted score — a video's #1-ranked category counts 3x, #2 counts 2x, #3 counts 1x, so this reflects which
              categories most define what gets sent, not just raw tag volume. Categories are detected from the video's title, confirmed
              against its transcript when one can be fetched.
            </p>
          </CardHeader>
          <CardContent>
            {categoriesLoading ? <Skeleton className="h-64 rounded-xl" /> : <RankedBarChart data={categoryData} valueLabel="Weighted score" />}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="bg-card border-border/50">
            <CardHeader>
              <CardTitle className="text-base font-serif">Delivery method usage</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {deliveryLoading ? <Skeleton className="h-40 rounded-xl" /> : (
                <>
                  <RankedBarChart data={deliveryData} valueLabel="Whisps" />
                  <div className="flex flex-wrap gap-2 pt-2 border-t border-border/30">
                    {(deliveryStats?.methods ?? []).map((m) => (
                      <span key={m.method} className="text-xs text-muted-foreground">
                        {deliveryLabel(m.method, null)}: <span className="text-foreground font-medium">{m.percentage}%</span>
                      </span>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card className="bg-card border-border/50">
            <CardHeader>
              <CardTitle className="text-base font-serif">Whisper Link channel split</CardTitle>
            </CardHeader>
            <CardContent>
              {deliveryLoading ? <Skeleton className="h-40 rounded-xl" /> : <RankedBarChart data={channelData} valueLabel="Whisps" />}
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="bg-card border-border/50">
            <CardHeader>
              <CardTitle className="text-base font-serif">Users by gender</CardTitle>
              <p className="text-xs text-muted-foreground">
                Self-reported once, before a user's first whisp send.
                {demographicStats && demographicStats.unansweredUsers > 0
                  ? ` ${demographicStats.unansweredUsers} of ${demographicStats.totalUsers} users haven't sent a first whisp yet.`
                  : ""}
              </p>
            </CardHeader>
            <CardContent>
              {demographicsLoading ? <Skeleton className="h-40 rounded-xl" /> : <RankedBarChart data={genderData} valueLabel="Users" />}
            </CardContent>
          </Card>

          <Card className="bg-card border-border/50">
            <CardHeader>
              <CardTitle className="text-base font-serif">Users by age range</CardTitle>
            </CardHeader>
            <CardContent>
              {demographicsLoading ? <Skeleton className="h-40 rounded-xl" /> : <RankedBarChart data={ageRangeData} valueLabel="Users" />}
            </CardContent>
          </Card>
        </div>

        <Card className="bg-card border-border/50">
          <CardHeader>
            <CardTitle className="text-base font-serif">Users by country</CardTitle>
            <p className="text-xs text-muted-foreground">
              Best-effort IP geolocation captured once at signup.
              {locationStats && locationStats.unknownLocationUsers > 0
                ? ` ${locationStats.unknownLocationUsers} of ${locationStats.totalUsers} users have no location on file.`
                : ""}
            </p>
          </CardHeader>
          <CardContent>
            {locationsLoading ? <Skeleton className="h-64 rounded-xl" /> : <RankedBarChart data={countryData} valueLabel="Users" />}
          </CardContent>
        </Card>

        {!!locationStats?.byRegion.length && (
          <Card className="bg-card border-border/50">
            <CardHeader>
              <CardTitle className="text-base font-serif">Users by region</CardTitle>
              <p className="text-xs text-muted-foreground">State/province, from the same one-time IP geolocation.</p>
            </CardHeader>
            <CardContent>
              <RankedBarChart data={regionData} valueLabel="Users" />
            </CardContent>
          </Card>
        )}

        {!!locationStats?.byCity.length && (
          <Card className="bg-card border-border/50">
            <CardHeader>
              <CardTitle className="text-base font-serif">Top cities</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {locationStats.byCity.slice(0, 10).map((c, i) => (
                  <div key={i} className="flex items-center justify-between text-sm py-1.5 px-3 rounded-lg bg-muted/20">
                    <span className="text-foreground">{c.city}{c.country ? `, ${c.country}` : ""}</span>
                    <span className="text-muted-foreground font-mono">{c.count}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <FeatureUsageSection />
      </div>
    </AdminLayout>
  );
}
