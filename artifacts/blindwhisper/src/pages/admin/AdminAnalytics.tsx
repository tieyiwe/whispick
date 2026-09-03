import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, XAxis } from "recharts";
import { AdminLayout } from "@/components/layout/AdminLayout";
import {
  useAdminGetUsageStats,
  useAdminGenerateUsageInsights,
  useAdminGetCategoryStats,
  useAdminGetDeliveryMethodStats,
  useAdminGetLocationStats,
  useAdminGetDemographicStats,
  useAdminGetFunnelStats,
  useAdminGetUsersOnlineNow,
  getAdminGetUsersOnlineNowQueryKey,
  useAdminGetTrafficByHour,
  useAdminGetVisitorsOnline,
  getAdminGetVisitorsOnlineQueryKey,
  useAdminGetVisitors,
  getAdminGetVisitorsQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { RankedBarChart } from "@/components/shared/RankedBarChart";
import { deliveryLabel } from "@/lib/deliveryMethod";
import { GENDER_LABELS, AGE_RANGE_LABELS, type Gender, type AgeRange } from "@/lib/demographics";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Sparkles, Loader2, MousePointerClick, Radio, Clock, Send, Users, Globe, Smartphone } from "lucide-react";

// Traffic-by-hour bar color: a darkened variant of the admin theme's matte-yellow
// --primary (hsl(46 64% 62%)). The primary at its usual lightness reads as too
// light for a dark chart surface (OKLCH L ~0.81, outside the ~0.48-0.67 dark-mode
// band), so it's stepped down to hsl(46 64% 40%) — validated against the admin
// card surface (#201E29) alongside the muted --chart-3 blue with
// scripts/validate_palette.js from the dataviz skill: lightness band, chroma
// floor, CVD separation (ΔE 26.2 protan/normal), and contrast all pass. Kept as
// two colors total — "peak hour" vs. "every other hour" — so no legend swatch
// grid is needed beyond the caption below the chart.
const TRAFFIC_PEAK_COLOR = "hsl(46 64% 40%)";
const TRAFFIC_BASE_COLOR = "hsl(var(--chart-3))";

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

// Live headcount + a 24-bucket UTC histogram of platform activity. Polls the
// online count on the same 60s cadence AdminUsers uses for its "last seen"
// column, so the tile actually feels live rather than serving a stale cache.
function LiveActivitySection() {
  const [days, setDays] = useState("30");
  const { data: onlineNow, isLoading: onlineLoading } = useAdminGetUsersOnlineNow({
    query: { queryKey: getAdminGetUsersOnlineNowQueryKey(), staleTime: 0, refetchInterval: 60_000, refetchOnWindowFocus: true },
  });
  const { data: traffic, isLoading: trafficLoading } = useAdminGetTrafficByHour({ days: Number(days) });

  const hours = traffic?.hours ?? [];
  const peakHour = traffic?.peakHour ?? null;
  const peakCount = peakHour !== null ? hours.find((h) => h.hour === peakHour)?.count : undefined;

  const chartConfig = {
    count: { label: "Events", color: TRAFFIC_BASE_COLOR },
  } satisfies ChartConfig;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card className="bg-card border-border/50">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Online now</p>
                {onlineLoading ? (
                  <Skeleton className="h-8 w-16 mt-1 rounded-md" />
                ) : (
                  <h3 className="text-2xl font-bold text-foreground mt-1">{(onlineNow?.onlineCount ?? 0).toLocaleString()}</h3>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  active in the last {onlineNow?.windowMinutes ?? "—"} min
                </p>
              </div>
              <div className="p-2.5 rounded-xl bg-primary/10 relative">
                <Radio className="w-4 h-4 text-primary" />
                <span className="absolute top-1.5 right-1.5 flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/50">
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Peak activity hour</p>
                {trafficLoading ? (
                  <Skeleton className="h-8 w-20 mt-1 rounded-md" />
                ) : (
                  <h3 className="text-2xl font-bold text-foreground mt-1">
                    {peakHour !== null ? `${String(peakHour).padStart(2, "0")}:00 UTC` : "—"}
                  </h3>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  {peakHour !== null && peakCount !== undefined
                    ? `${peakCount.toLocaleString()} events, last ${days} days`
                    : `not enough traffic yet, last ${days} days`}
                </p>
              </div>
              <div className="p-2.5 rounded-xl bg-blue-500/10">
                <Clock className="w-4 h-4 text-blue-400" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card border-border/50">
        <CardHeader className="flex flex-row items-center justify-between gap-3 flex-wrap space-y-0">
          <CardTitle className="flex items-center gap-2 text-base font-serif">
            <Clock className="w-4 h-4 text-primary" /> Traffic by hour (UTC)
          </CardTitle>
          <Select value={days} onValueChange={setDays}>
            <SelectTrigger className="w-28 rounded-full bg-input/50 border-border/50"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7 days</SelectItem>
              <SelectItem value="30">30 days</SelectItem>
              <SelectItem value="90">90 days</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground -mt-1">
            Platform-wide activity events, bucketed by hour of day in UTC — where interest clusters across the day, not tied to any one user's local time.
          </p>
          {trafficLoading ? (
            <Skeleton className="h-52 rounded-xl" />
          ) : !hours.length ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No activity recorded in this window yet.</p>
          ) : (
            <>
              <ChartContainer config={chartConfig} className="w-full aspect-auto h-52">
                <BarChart data={hours} margin={{ left: 0, right: 0, top: 8 }} barCategoryGap="18%">
                  <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.3} />
                  <XAxis
                    dataKey="hour"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v) => `${v}:00`}
                    ticks={[0, 3, 6, 9, 12, 15, 18, 21]}
                    interval={0}
                  />
                  <ChartTooltip
                    cursor={{ fill: "hsl(var(--muted))", opacity: 0.3 }}
                    content={
                      <ChartTooltipContent
                        hideLabel
                        labelFormatter={(_, payload) => `${String(payload?.[0]?.payload?.hour ?? 0).padStart(2, "0")}:00 UTC`}
                      />
                    }
                  />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={22}>
                    {hours.map((h) => (
                      <Cell key={h.hour} fill={h.hour === peakHour ? TRAFFIC_PEAK_COLOR : TRAFFIC_BASE_COLOR} />
                    ))}
                  </Bar>
                </BarChart>
              </ChartContainer>
              <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-border/30">
                <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: TRAFFIC_PEAK_COLOR }} />
                  Peak hour
                </span>
                <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: TRAFFIC_BASE_COLOR }} />
                  Other hours
                </span>
                {peakHour !== null && (
                  <span className="text-xs text-foreground font-medium ml-auto">
                    Peak activity: {String(peakHour).padStart(2, "0")}:00 UTC
                  </span>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// Signed-in + anonymous, updated by the second — distinct from
// LiveActivitySection above, which only ever covers accounts (usersTable.
// lastSeenAt has nothing to say about a visitor who's never signed in). The
// headcount tile polls at 1s (a single indexed COUNT, cheap enough for
// that cadence — see routes/adminVisitors.ts's own comment on why the
// breakdowns below don't get the same treatment); everything else polls
// slower since it's a heavier read.
function LiveVisitorsSection() {
  const { data: online, isLoading: onlineLoading, isError: onlineError } = useAdminGetVisitorsOnline({
    query: { queryKey: getAdminGetVisitorsOnlineQueryKey(), staleTime: 0, refetchInterval: 1_000, refetchOnWindowFocus: true },
  });
  const { data: visitors, isLoading: visitorsLoading } = useAdminGetVisitors({
    query: { queryKey: getAdminGetVisitorsQueryKey(), staleTime: 0, refetchInterval: 8_000, refetchOnWindowFocus: true },
  });

  const byCountry = (visitors?.byCountry ?? []).slice(0, 8);
  const byDevice = visitors?.byDevice ?? [];
  const recent = visitors?.recent ?? [];

  return (
    <div className="space-y-4">
      {/* An outright request failure here is NOT the same as "no one's
          online" — collapsing both into a "0" hides a real backend problem
          (most often this environment's visitor_sessions table not being
          migrated). Surface it explicitly so it's diagnosable instead of
          looking like an empty platform. */}
      {onlineError && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300" data-testid="live-visitors-error">
          Couldn't load live visitor data. If this persists, the tracking table may not be migrated in this environment — run <code className="font-mono text-xs">pnpm --filter @workspace/db run push</code> against this deployment's database.
        </div>
      )}
      <Card className="bg-card border-border/50">
        <CardContent className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Visitors on the platform</p>
              {onlineLoading ? (
                <Skeleton className="h-8 w-16 mt-1 rounded-md" />
              ) : (
                <h3 className="text-2xl font-bold text-foreground mt-1">{onlineError ? "—" : (online?.onlineCount ?? 0).toLocaleString()}</h3>
              )}
              <p className="text-xs text-muted-foreground mt-1">signed-in + anonymous, right now</p>
            </div>
            <div className="p-2.5 rounded-xl bg-primary/10 relative">
              <Globe className="w-4 h-4 text-primary" />
              <span className="absolute top-1.5 right-1.5 flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card className="bg-card border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-serif flex items-center gap-2">
              <Globe className="w-4 h-4 text-primary" /> By country
            </CardTitle>
          </CardHeader>
          <CardContent>
            {visitorsLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-5 w-full rounded" />
                <Skeleton className="h-5 w-full rounded" />
                <Skeleton className="h-5 w-full rounded" />
              </div>
            ) : !byCountry.length ? (
              <p className="text-sm text-muted-foreground py-3">No one's here right now.</p>
            ) : (
              <div className="space-y-1.5">
                {byCountry.map((c) => (
                  <div key={c.country} className="flex items-center justify-between text-sm">
                    <span className="text-foreground">{c.country}</span>
                    <span className="text-muted-foreground">{c.count}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-serif flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-primary" /> By device
            </CardTitle>
          </CardHeader>
          <CardContent>
            {visitorsLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-5 w-full rounded" />
                <Skeleton className="h-5 w-full rounded" />
              </div>
            ) : !byDevice.length ? (
              <p className="text-sm text-muted-foreground py-3">No one's here right now.</p>
            ) : (
              <div className="space-y-1.5">
                {byDevice.map((d) => (
                  <div key={d.deviceType} className="flex items-center justify-between text-sm">
                    <span className="text-foreground capitalize">{d.deviceType}</span>
                    <span className="text-muted-foreground">{d.count}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-serif flex items-center gap-2">
            <Users className="w-4 h-4 text-primary" /> Recent sessions
          </CardTitle>
        </CardHeader>
        <CardContent>
          {visitorsLoading ? (
            <Skeleton className="h-24 rounded-xl" />
          ) : !recent.length ? (
            <p className="text-sm text-muted-foreground py-3">No one's here right now.</p>
          ) : (
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {recent.map((v, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between gap-3 text-xs py-1.5 border-b border-border/20 last:border-0"
                >
                  <span className="text-foreground">{v.country ?? "Unknown"}</span>
                  <span className="text-muted-foreground capitalize">{v.deviceType}</span>
                  <span className={v.isSignedIn ? "text-primary shrink-0" : "text-muted-foreground shrink-0"}>
                    {v.isSignedIn ? "Signed in" : "Anonymous"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
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

        <div className="space-y-4">
          <div>
            <h2 className="text-xl font-serif font-semibold flex items-center gap-2">
              <Send className="w-5 h-5 text-primary" /> Delivery funnel
            </h2>
            <p className="text-sm text-muted-foreground mt-0.5">From send to reply — where whisps and related features succeed or drop off.</p>
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
        </div>

        <div className="space-y-4">
          <div>
            <h2 className="text-xl font-serif font-semibold flex items-center gap-2">
              <Radio className="w-5 h-5 text-primary" /> Who's active right now
            </h2>
            <p className="text-sm text-muted-foreground mt-0.5">A live headcount and when in the day (UTC) traffic actually shows up.</p>
          </div>
          <LiveActivitySection />
        </div>

        <div className="space-y-4">
          <div>
            <h2 className="text-xl font-serif font-semibold flex items-center gap-2">
              <Globe className="w-5 h-5 text-primary" /> Live visitors
            </h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Everyone on the platform right now — signed-in and anonymous — by country and device.
            </p>
          </div>
          <LiveVisitorsSection />
        </div>

        <div className="space-y-4">
          <div>
            <h2 className="text-xl font-serif font-semibold flex items-center gap-2">
              <Users className="w-5 h-5 text-primary" /> Content & audience
            </h2>
            <p className="text-sm text-muted-foreground mt-0.5">What gets sent, and who's sending it.</p>
          </div>

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
      </div>
    </AdminLayout>
  );
}
