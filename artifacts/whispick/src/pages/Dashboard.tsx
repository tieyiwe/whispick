import { useEffect } from "react";
import { useGetWhispStats } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Send, Eye, PlayCircle, MessageSquareHeart, TrendingUp, Ghost } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Link, useLocation } from "wouter";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { MoodTag } from "@/components/shared/MoodTag";
import { Button } from "@/components/ui/button";
import { hasPendingForward } from "@/lib/forwardVideo";

export function Dashboard() {
  const { data: stats, isLoading } = useGetWhispStats();
  const [, setLocation] = useLocation();

  // A brand-new account created via "Pass it forward" from the public whisp
  // page always lands here first (Clerk's sign-up redirect is fixed at
  // /dashboard) — bounce straight to Send Whisp, which consumes (and
  // clears) the pending video itself.
  useEffect(() => {
    if (hasPendingForward()) setLocation("/send");
  }, [setLocation]);

  if (isLoading) {
    return (
      <AppLayout>
        <div className="space-y-6">
          <Skeleton className="h-10 w-48" />
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-32 rounded-2xl" />)}
          </div>
          <Skeleton className="h-[400px] rounded-2xl mt-8" />
        </div>
      </AppLayout>
    );
  }

  const statCards = [
    { title: "Sent Whisps", value: stats?.totalSent || 0, icon: Send, color: "text-primary", bg: "bg-primary/10" },
    { title: "Open Rate", value: `${Math.round(stats?.openRate || 0)}%`, icon: Eye, color: "text-blue-400", bg: "bg-blue-500/10" },
    { title: "Videos Watched", value: stats?.totalWatched || 0, icon: PlayCircle, color: "text-secondary", bg: "bg-secondary/10" },
    { title: "Replies Received", value: stats?.totalReplied || 0, icon: MessageSquareHeart, color: "text-amber-400", bg: "bg-amber-500/10" },
  ];

  return (
    <AppLayout>
      <div className="space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-serif font-bold text-foreground">Dashboard</h1>
            <p className="text-muted-foreground mt-1">Here's how your whisps are performing.</p>
          </div>
          <Link href="/send">
            <Button className="rounded-full shadow-[0_0_15px_rgba(124,92,252,0.3)]">
              <Send className="w-4 h-4 mr-2" /> Send New Whisp
            </Button>
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {statCards.map((stat, i) => (
            <Card key={i} className="bg-card border-border/50 shadow-sm overflow-hidden relative">
              <div className={`absolute top-0 right-0 w-24 h-24 rounded-full ${stat.bg} blur-2xl -mr-10 -mt-10 pointer-events-none`} />
              <CardContent className="p-6">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">{stat.title}</p>
                    <h3 className="text-3xl font-bold text-foreground mt-2">{stat.value}</h3>
                  </div>
                  <div className={`p-3 rounded-xl ${stat.bg}`}>
                    <stat.icon className={`w-5 h-5 ${stat.color}`} />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-serif font-semibold">Recent Whisps</h2>
              <Link href="/whisps" className="text-sm text-primary hover:underline">View all</Link>
            </div>
            
            <div className="space-y-3">
              {stats?.recentWhisps && stats.recentWhisps.length > 0 ? (
                stats.recentWhisps.map((whisp) => (
                  <Link key={whisp.id} href={`/whisps/${whisp.id}`}>
                    <Card className="bg-card hover:bg-card/80 transition-colors border-border/50 cursor-pointer overflow-hidden group">
                      <div className="flex flex-col sm:flex-row h-full">
                        {whisp.videoThumbnail ? (
                          <div className="w-full sm:w-40 h-32 sm:h-auto shrink-0 relative">
                            <img src={whisp.videoThumbnail} alt={whisp.videoTitle || "Video"} className="w-full h-full object-cover" />
                            <div className="absolute inset-0 bg-black/40 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                              <PlayCircle className="w-8 h-8 text-white opacity-80" />
                            </div>
                          </div>
                        ) : (
                          <div className="w-full sm:w-40 h-32 sm:h-auto shrink-0 bg-muted flex items-center justify-center">
                            <PlayCircle className="w-8 h-8 text-muted-foreground" />
                          </div>
                        )}
                        <div className="p-4 flex-1 flex flex-col justify-center min-w-0">
                          <div className="flex items-start justify-between gap-4 mb-2">
                            <h4 className="font-medium text-foreground truncate">{whisp.videoTitle || "Video Link"}</h4>
                            <StatusBadge status={whisp.status} />
                          </div>
                          <div className="flex items-center text-sm text-muted-foreground mb-3">
                            <span className="truncate">
                              Sent to {whisp.recipientEmail || whisp.recipientPhone || (whisp.deliveryMethod === "circle_drop" ? "Circle feed" : "Ghost Boost audience")}
                            </span>
                            <span className="mx-2">•</span>
                            <span>{new Date(whisp.createdAt).toLocaleDateString()}</span>
                          </div>
                          {whisp.moodTag && <MoodTag mood={whisp.moodTag} className="scale-90 origin-left self-start" />}
                        </div>
                      </div>
                    </Card>
                  </Link>
                ))
              ) : (
                <Card className="bg-card/50 border-dashed border-border py-12 text-center">
                  <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                    <Send className="w-8 h-8 text-primary" />
                  </div>
                  <h3 className="text-lg font-medium text-foreground mb-2">No whisps sent yet</h3>
                  <p className="text-muted-foreground max-w-md mx-auto mb-6">
                    Start sharing meaningful videos with the people you care about.
                  </p>
                  <Link href="/send">
                    <Button variant="outline" className="rounded-full">Create Your First Whisp</Button>
                  </Link>
                </Card>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <h2 className="text-xl font-serif font-semibold">Ghost Boosts</h2>
            <Card className="bg-card border-border/50 relative overflow-hidden">
              <div className="absolute top-[-20%] right-[-10%] w-[60%] h-[60%] bg-primary/10 rounded-full blur-[60px] pointer-events-none" />
              <CardContent className="p-6 text-center">
                <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center mx-auto mb-4 glow-card">
                  <Ghost className="w-8 h-8 text-primary" />
                </div>
                <h3 className="text-3xl font-bold text-foreground mb-1">{stats?.boostCredits || 0}</h3>
                <p className="text-muted-foreground text-sm mb-6">Boost Credits Available</p>
                
                <p className="text-xs text-muted-foreground mb-6">
                  Ghost Boost queues a whisp for boosted, wider-reach delivery instead of a direct message — it doesn't guarantee it reaches one specific person the way Whisper Link does.
                </p>
                
                <Link href="/credits">
                  <Button variant="outline" className="w-full rounded-full border-primary/30 hover:bg-primary/10 hover:text-primary">
                    Get More Credits
                  </Button>
                </Link>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
