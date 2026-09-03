import { Link } from "wouter";
import { AdminLayout } from "@/components/layout/AdminLayout";
import {
  useAdminGetOverviewStats,
  useAdminGetOpportunities,
  useAdminGetFunnelStats,
  useAdminGetVisitorsOnline,
  useAdminGetUsersOnlineNow,
  getAdminGetVisitorsOnlineQueryKey,
  getAdminGetUsersOnlineNowQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendAreaChart } from "@/components/shared/TrendAreaChart";
import { Users, Send, UserX, TrendingUp, Lightbulb, TriangleAlert, Info, AlertOctagon, Globe, Radio } from "lucide-react";

const SEVERITY_CONFIG = {
  opportunity: { icon: Lightbulb, className: "bg-primary/10 border-primary/20 text-primary" },
  warning: { icon: TriangleAlert, className: "bg-amber-500/10 border-amber-500/20 text-amber-400" },
  info: { icon: Info, className: "bg-blue-500/10 border-blue-500/20 text-blue-400" },
} as const;

export function AdminDashboard() {
  const { data: stats, isLoading: statsLoading } = useAdminGetOverviewStats();
  const { data: opportunities, isLoading: opportunitiesLoading } = useAdminGetOpportunities();
  const { data: funnelStats } = useAdminGetFunnelStats();

  // Live "right now" counts, polled on a fast cadence so the Overview shows
  // real-time presence at a glance without opening the full Analytics page.
  // visitorsOnline counts every open tab (signed-in OR anonymous, see
  // visitor_sessions); usersOnline counts signed-in accounts active in the
  // last few minutes (users.lastSeenAt). Both refetch in the background so
  // the number keeps ticking even while this tab isn't focused.
  const { data: visitorsOnline } = useAdminGetVisitorsOnline({
    query: { queryKey: getAdminGetVisitorsOnlineQueryKey(), refetchInterval: 5_000, refetchIntervalInBackground: true },
  });
  const { data: usersOnline } = useAdminGetUsersOnlineNow({
    query: { queryKey: getAdminGetUsersOnlineNowQueryKey(), refetchInterval: 5_000, refetchIntervalInBackground: true },
  });

  const statCards = [
    { label: "Total Users", value: stats?.totalUsers ?? 0, icon: Users, color: "text-primary", bg: "bg-primary/10" },
    { label: "Total Whisps", value: stats?.totalWhisps ?? 0, icon: Send, color: "text-blue-400", bg: "bg-blue-500/10" },
    { label: "Active (7d)", value: stats?.activeUsersLast7Days ?? 0, icon: TrendingUp, color: "text-secondary", bg: "bg-secondary/10" },
    { label: "Failed Deliveries", value: funnelStats?.funnel.failed ?? 0, icon: AlertOctagon, color: "text-destructive", bg: "bg-destructive/10", href: "/admin_pro/whisps?status=failed" },
    { label: "Banned", value: stats?.bannedUsers ?? 0, icon: UserX, color: "text-destructive", bg: "bg-destructive/10" },
  ];

  return (
    <AdminLayout>
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">Overview</h1>
          <p className="text-muted-foreground mt-1">App-wide health, growth, and smart analytics.</p>
        </div>

        {/* Live "right now" strip — refreshes every few seconds. Mirrors the
            fuller live roster on the Analytics page, surfaced on the Overview
            so real-time presence is the first thing visible. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card className="bg-card border-border/50 relative overflow-hidden">
            <span className="absolute top-4 right-4 flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
            </span>
            <CardContent className="p-5">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Globe className="w-4 h-4 text-emerald-400" /> Visitors online now
              </div>
              <h3 className="text-3xl font-bold text-foreground mt-2" data-testid="overview-visitors-online">
                {(visitorsOnline?.onlineCount ?? 0).toLocaleString()}
              </h3>
              <p className="text-xs text-muted-foreground mt-1">Every open tab — signed in or anonymous.</p>
            </CardContent>
          </Card>
          <Card className="bg-card border-border/50">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <Radio className="w-4 h-4 text-primary" /> Signed-in users active now
              </div>
              <h3 className="text-3xl font-bold text-foreground mt-2" data-testid="overview-users-online">
                {(usersOnline?.onlineCount ?? 0).toLocaleString()}
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                Accounts active in the last {usersOnline?.windowMinutes ?? 5} min.{" "}
                <Link href="/admin_pro/analytics" className="text-primary hover:underline">Full live view →</Link>
              </p>
            </CardContent>
          </Card>
        </div>

        {statsLoading ? (
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            {statCards.map((s) => {
              const card = (
                <Card className="bg-card border-border/50 h-full">
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">{s.label}</p>
                        <h3 className="text-2xl font-bold text-foreground mt-1">{s.value.toLocaleString()}</h3>
                      </div>
                      <div className={`p-2.5 rounded-xl ${s.bg}`}>
                        <s.icon className={`w-4 h-4 ${s.color}`} />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
              return s.href ? (
                <Link key={s.label} href={s.href} className="block hover:opacity-80 transition-opacity">{card}</Link>
              ) : (
                <div key={s.label}>{card}</div>
              );
            })}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="bg-card border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-serif">New signups (30 days)</CardTitle>
            </CardHeader>
            <CardContent>
              {statsLoading ? <Skeleton className="h-40 rounded-xl" /> : <TrendAreaChart data={stats?.signupTrend ?? []} valueLabel="Signups" />}
            </CardContent>
          </Card>
          <Card className="bg-card border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-serif">Whisps sent (30 days)</CardTitle>
            </CardHeader>
            <CardContent>
              {statsLoading ? <Skeleton className="h-40 rounded-xl" /> : <TrendAreaChart data={stats?.whispTrend ?? []} valueLabel="Whisps" />}
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card className="bg-card border-border/50">
            <CardContent className="p-5">
              <p className="text-xs text-muted-foreground">New users (30d)</p>
              <p className="text-xl font-bold text-foreground mt-1">{stats?.newUsersLast30Days ?? 0}</p>
            </CardContent>
          </Card>
          <Card className="bg-card border-border/50">
            <CardContent className="p-5">
              <p className="text-xs text-muted-foreground">Plan upgrades granted</p>
              <p className="text-xl font-bold text-foreground mt-1">{stats?.planGrants ?? 0}</p>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-3">
          <h2 className="text-xl font-serif font-semibold flex items-center gap-2">
            <Lightbulb className="w-5 h-5 text-primary" /> Smart Analytics
          </h2>
          <p className="text-sm text-muted-foreground -mt-2">Computed straight from your data — growth opportunities and quality signals worth a look.</p>
          {opportunitiesLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
            </div>
          ) : opportunities?.insights.length ? (
            <div className="space-y-3">
              {opportunities.insights.map((insight) => {
                const config = SEVERITY_CONFIG[insight.severity];
                const Icon = config.icon;
                return (
                  <Card key={insight.id} className={`border ${config.className}`} data-testid={`insight-${insight.id}`}>
                    <CardContent className="p-4 flex gap-3">
                      <Icon className="w-5 h-5 shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-medium text-foreground">{insight.title}</p>
                          {insight.metric && <span className="text-sm font-mono font-semibold shrink-0">{insight.metric}</span>}
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">{insight.description}</p>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : (
            <Card className="bg-card/50 border-dashed border-border py-10 text-center">
              <p className="text-muted-foreground">Not enough activity yet to surface insights — check back once more whisps are sent.</p>
            </Card>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
