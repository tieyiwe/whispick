import { AdminLayout } from "@/components/layout/AdminLayout";
import {
  useAdminGetCategoryStats,
  useAdminGetDeliveryMethodStats,
  useAdminGetLocationStats,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { RankedBarChart } from "@/components/shared/RankedBarChart";
import { deliveryLabel } from "@/lib/deliveryMethod";

export function AdminAnalytics() {
  const { data: categoryStats, isLoading: categoriesLoading } = useAdminGetCategoryStats();
  const { data: deliveryStats, isLoading: deliveryLoading } = useAdminGetDeliveryMethodStats();
  const { data: locationStats, isLoading: locationsLoading } = useAdminGetLocationStats();

  const categoryData = (categoryStats?.categories ?? []).map((c) => ({ label: c.label, value: c.weightedScore }));
  const deliveryData = (deliveryStats?.methods ?? []).map((m) => ({ label: deliveryLabel(m.method, null), value: m.count }));
  const channelData = (deliveryStats?.whisperLinkChannels ?? []).map((c) => ({ label: c.channel ?? "Unknown", value: c.count }));
  const countryData = (locationStats?.byCountry ?? []).map((c) => ({ label: c.country ?? "Unknown", value: c.count }));

  return (
    <AdminLayout>
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">Analytics</h1>
          <p className="text-muted-foreground mt-1">What people send, how it's delivered, and where they're sending from.</p>
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
      </div>
    </AdminLayout>
  );
}
