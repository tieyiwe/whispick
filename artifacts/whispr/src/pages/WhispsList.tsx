import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useListWhisps } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { Link } from "wouter";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { MoodTag } from "@/components/shared/MoodTag";
import { PlayCircle, Search, Filter } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

export function WhispsList() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  
  const { data: whisps, isLoading } = useListWhisps(
    statusFilter !== "all" ? { status: statusFilter } : undefined
  );

  const filteredWhisps = whisps?.filter(w => 
    !searchQuery || 
    w.videoTitle?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    w.recipientEmail?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    w.recipientPhone?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <AppLayout>
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">My Whisps</h1>
          <p className="text-muted-foreground mt-1">Track the videos you've sent.</p>
        </div>

        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              placeholder="Search by title or recipient..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 bg-card border-border/50 rounded-full"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-[180px] bg-card border-border/50 rounded-full">
              <Filter className="w-4 h-4 mr-2 text-muted-foreground" />
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="delivered">Delivered</SelectItem>
              <SelectItem value="opened">Opened</SelectItem>
              <SelectItem value="watched">Watched</SelectItem>
              <SelectItem value="replied">Replied</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-32 rounded-2xl" />)}
          </div>
        ) : filteredWhisps?.length ? (
          <div className="space-y-4">
            {filteredWhisps.map((whisp) => (
              <Link key={whisp.id} href={`/whisps/${whisp.id}`}>
                <Card className="bg-card hover:bg-card/80 transition-colors border-border/50 cursor-pointer overflow-hidden group">
                  <div className="flex flex-col sm:flex-row h-full">
                    {whisp.videoThumbnail ? (
                      <div className="w-full sm:w-48 h-36 sm:h-auto shrink-0 relative">
                        <img src={whisp.videoThumbnail} alt={whisp.videoTitle || "Video"} className="w-full h-full object-cover" />
                        <div className="absolute inset-0 bg-black/40 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                          <PlayCircle className="w-10 h-10 text-white opacity-80" />
                        </div>
                      </div>
                    ) : (
                      <div className="w-full sm:w-48 h-36 sm:h-auto shrink-0 bg-muted flex items-center justify-center">
                        <PlayCircle className="w-10 h-10 text-muted-foreground" />
                      </div>
                    )}
                    <div className="p-5 flex-1 flex flex-col justify-center min-w-0">
                      <div className="flex items-start justify-between gap-4 mb-2">
                        <h3 className="font-semibold text-foreground text-lg truncate">{whisp.videoTitle || "Video Link"}</h3>
                        <StatusBadge status={whisp.status} />
                      </div>
                      <div className="flex items-center text-sm text-muted-foreground mb-4">
                        <span className="truncate">To: {whisp.recipientEmail || whisp.recipientPhone || "Ghost Boost"}</span>
                        <span className="mx-2">•</span>
                        <span>{new Date(whisp.createdAt).toLocaleDateString()}</span>
                        <span className="mx-2">•</span>
                        <span>via {whisp.deliveryMethod === 'ghost_boost' ? 'Ghost Boost' : 'Whisper Link'}</span>
                      </div>
                      <div className="mt-auto">
                        {whisp.moodTag && <MoodTag mood={whisp.moodTag} className="scale-90 origin-left" />}
                      </div>
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        ) : (
          <Card className="bg-card/50 border-dashed border-border py-16 text-center">
            <h3 className="text-xl font-medium text-foreground mb-2">No whisps found</h3>
            <p className="text-muted-foreground max-w-md mx-auto mb-6">
              {searchQuery || statusFilter !== "all" 
                ? "Try adjusting your filters to find what you're looking for." 
                : "You haven't sent any whisps yet."}
            </p>
            {(!searchQuery && statusFilter === "all") && (
              <Link href="/send">
                <Button className="rounded-full shadow-[0_0_15px_rgba(124,92,252,0.3)]">
                  Send Your First Whisp
                </Button>
              </Link>
            )}
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
