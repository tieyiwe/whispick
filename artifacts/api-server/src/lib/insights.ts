import { db } from "@workspace/db";
import { usersTable, whispsTable, whispCategoriesTable } from "@workspace/db";
import { and, count, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { VIDEO_CATEGORIES } from "./categorize";
import { PLAN_LIMITS, GHOST_BOOST_ENABLED } from "./plans";

export type Insight = {
  id: string;
  title: string;
  description: string;
  severity: "opportunity" | "warning" | "info";
  metric?: string;
};

function categoryLabel(key: string): string {
  return VIDEO_CATEGORIES.find((c) => c.key === key)?.label ?? "Uncategorized";
}

// Heuristic, data-driven "smart analytics" — every insight below is computed
// straight from real rows (no ML, no guessing), then translated into plain
// language. Each check only fires when it has enough volume to say something
// meaningful (arbitrary but reasonable minimums noted inline), so an empty
// or brand-new database doesn't produce noisy, low-confidence insights.
export async function computeOpportunities(): Promise<Insight[]> {
  const insights: Insight[] = [];

  // 1. Whisper Link channel performance — which channel gets replies most,
  // and any channel that's clearly underperforming.
  const channelRows = await db
    .select({
      channel: whispsTable.whisperChannel,
      sent: count(),
      replied: sql<number>`count(*) filter (where ${whispsTable.status} = 'replied')`,
    })
    .from(whispsTable)
    .where(and(eq(whispsTable.deliveryMethod, "whisper_link"), isNotNull(whispsTable.whisperChannel)))
    .groupBy(whispsTable.whisperChannel);

  const withRate = channelRows
    .filter((r) => r.sent >= 5)
    .map((r) => ({ ...r, rate: r.replied / r.sent }))
    .sort((a, b) => b.rate - a.rate);

  if (withRate.length >= 2) {
    const best = withRate[0]!;
    const worst = withRate[withRate.length - 1]!;
    if (best.rate > worst.rate * 1.3) {
      insights.push({
        id: "channel-performance",
        title: `${best.channel} gets the most replies`,
        description: `Whisper Links sent via ${best.channel} get a reply ${Math.round(best.rate * 100)}% of the time, vs ${Math.round(worst.rate * 100)}% for ${worst.channel}. Consider defaulting new senders to ${best.channel} or nudging them toward it in the composer.`,
        severity: "opportunity",
        metric: `${Math.round(best.rate * 100)}% vs ${Math.round(worst.rate * 100)}%`,
      });
    }
  }

  // 2. Free-plan users at or near their monthly Whisper Link cap — an
  // upgrade prompt opportunity.
  const freeLimit = PLAN_LIMITS.free.whisperLinksPerMonth ?? 3;
  const nearCapRow = await db
    .select({ count: count() })
    .from(usersTable)
    .where(and(eq(usersTable.plan, "free"), gte(usersTable.whisperLinksUsed, freeLimit)))
    .then((r) => r[0]);

  if ((nearCapRow?.count ?? 0) >= 3) {
    insights.push({
      id: "upgrade-prompt",
      title: "Free-plan users are hitting their limit",
      description: `${nearCapRow!.count} users on the Free plan have used all ${freeLimit} of their monthly Whisper Links. They're a warm audience for an in-app upgrade prompt to Spark or Ember.`,
      severity: "opportunity",
      metric: String(nearCapRow!.count),
    });
  }

  // 3. Category volume vs. watch-through — flag a high-volume category with
  // a weak watch-through rate (content quality signal) and a low-volume
  // category with a strong one (an underexploited niche).
  const categoryRows = await db
    .select({
      category: whispCategoriesTable.category,
      sent: count(),
      watched: sql<number>`count(*) filter (where ${whispsTable.watchedAt} is not null)`,
    })
    .from(whispCategoriesTable)
    .innerJoin(whispsTable, eq(whispCategoriesTable.whispId, whispsTable.id))
    .where(eq(whispCategoriesTable.rank, 1))
    .groupBy(whispCategoriesTable.category)
    .having(sql`count(*) >= 5`);

  const withWatchRate = categoryRows.map((r) => ({ ...r, watchRate: r.watched / r.sent }));
  if (withWatchRate.length >= 2) {
    const avgRate = withWatchRate.reduce((s, r) => s + r.watchRate, 0) / withWatchRate.length;
    const mostSent = [...withWatchRate].sort((a, b) => b.sent - a.sent)[0]!;
    const bestNiche = [...withWatchRate].sort((a, b) => b.watchRate - a.watchRate)[0]!;

    if (mostSent.watchRate < avgRate * 0.7) {
      insights.push({
        id: "category-quality",
        title: `${categoryLabel(mostSent.category)} is your most-sent category but under-watched`,
        description: `${categoryLabel(mostSent.category)} accounts for the most sends (${mostSent.sent}) but only a ${Math.round(mostSent.watchRate * 100)}% watch-through rate, below the ${Math.round(avgRate * 100)}% average across categories. Worth a look at whether that content is landing.`,
        severity: "warning",
        metric: `${Math.round(mostSent.watchRate * 100)}%`,
      });
    }

    if (bestNiche.category !== mostSent.category && bestNiche.watchRate > avgRate * 1.3) {
      insights.push({
        id: "category-niche",
        title: `${categoryLabel(bestNiche.category)} has the best watch-through rate`,
        description: `${categoryLabel(bestNiche.category)} whisps get watched ${Math.round(bestNiche.watchRate * 100)}% of the time — well above average — but make up a smaller share of sends (${bestNiche.sent}). Promoting this category could grow high-engagement volume.`,
        severity: "opportunity",
        metric: `${Math.round(bestNiche.watchRate * 100)}%`,
      });
    }
  }

  // 4. Ghost Boost credits sitting unused — meaningless advice while Ghost
  // Boost sends are paused (see GHOST_BOOST_ENABLED), so skip it entirely
  // rather than nudge an admin toward re-engaging users on a feature they
  // currently can't spend credits on.
  if (GHOST_BOOST_ENABLED) {
    const idleCreditsRow = await db
      .select({ count: count() })
      .from(usersTable)
      .where(gte(usersTable.boostCredits, 1))
      .then((r) => r[0]);

    if ((idleCreditsRow?.count ?? 0) >= 3) {
      insights.push({
        id: "idle-credits",
        title: "Purchased Ghost Boost credits are sitting unused",
        description: `${idleCreditsRow!.count} users are holding at least 1 unused Ghost Boost credit. A re-engagement email or in-app nudge could convert those into sends.`,
        severity: "opportunity",
        metric: String(idleCreditsRow!.count),
      });
    }
  }

  // 5. Geographic concentration — is signup base concentrated in one place?
  const countryRows = await db
    .select({ country: usersTable.country, count: count() })
    .from(usersTable)
    .where(isNotNull(usersTable.country))
    .groupBy(usersTable.country)
    .orderBy(desc(count()))
    .limit(1);

  const totalWithLocationRow = await db
    .select({ count: count() })
    .from(usersTable)
    .where(isNotNull(usersTable.country))
    .then((r) => r[0]);

  const totalWithLocation = totalWithLocationRow?.count ?? 0;
  if (countryRows.length && totalWithLocation >= 10) {
    const top = countryRows[0]!;
    const share = top.count / totalWithLocation;
    if (share >= 0.5) {
      insights.push({
        id: "geo-concentration",
        title: `${Math.round(share * 100)}% of users are in ${top.country}`,
        description: `Your user base is heavily concentrated in ${top.country}. Localized marketing, currency, or timezone-aware send scheduling there could have outsized impact.`,
        severity: "info",
        metric: `${Math.round(share * 100)}%`,
      });
    }
  }

  // 6. Best time of day to send, by local send-hour histogram.
  const hourRows = await db
    .select({ hour: sql<number>`extract(hour from ${whispsTable.createdAt})`, count: count() })
    .from(whispsTable)
    .groupBy(sql`extract(hour from ${whispsTable.createdAt})`)
    .orderBy(desc(count()))
    .limit(1);

  const totalWhispsRow = await db.select({ count: count() }).from(whispsTable).then((r) => r[0]);
  if (hourRows.length && (totalWhispsRow?.count ?? 0) >= 20) {
    const peak = hourRows[0]!;
    insights.push({
      id: "peak-send-hour",
      title: `Most whisps are sent around ${peak.hour}:00 UTC`,
      description: `Sending activity peaks around ${peak.hour}:00 UTC. Scheduling push notifications, reminders, or Ghost Boost dispatch just before this window could improve visibility.`,
      severity: "info",
      metric: `${peak.hour}:00 UTC`,
    });
  }

  // 7. Scheduled-send feature adoption.
  const scheduledRow = await db
    .select({ count: count() })
    .from(whispsTable)
    .where(isNotNull(whispsTable.scheduledAt))
    .then((r) => r[0]);

  const total = totalWhispsRow?.count ?? 0;
  if (total >= 20) {
    const adoption = (scheduledRow?.count ?? 0) / total;
    if (adoption < 0.05) {
      insights.push({
        id: "scheduling-adoption",
        title: "Scheduled sending is barely used",
        description: `Only ${Math.round(adoption * 100)}% of whisps use scheduled sending. If the feature is meant to be a differentiator, it may need more visibility in the composer.`,
        severity: "info",
        metric: `${Math.round(adoption * 100)}%`,
      });
    }
  }

  return insights;
}
