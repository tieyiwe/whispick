import { useState } from "react";
import { useLocation } from "wouter";
import { useListSuggestions, getListSuggestionsQueryKey, type SuggestedVideo } from "@workspace/api-client-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Thumbnail } from "@/components/shared/Thumbnail";
import { PlatformIcon } from "@/components/shared/PlatformIcon";
import { savePendingForward } from "@/lib/forwardVideo";
import { Sparkles, Star, PlayCircle, Send } from "lucide-react";

function SuggestionCard({ suggestion, onWhisper }: { suggestion: SuggestedVideo; onWhisper: (s: SuggestedVideo) => void }) {
  return (
    <Card className="bg-card border-border/50 overflow-hidden flex flex-col" data-testid={`suggestion-card-${suggestion.id}`}>
      <div className="relative aspect-video bg-muted">
        {suggestion.videoThumbnail ? (
          <Thumbnail src={suggestion.videoThumbnail} alt={suggestion.videoTitle ?? "Video thumbnail"} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <PlayCircle className="w-8 h-8 text-muted-foreground" />
          </div>
        )}
        {suggestion.featured && (
          <Badge className="absolute top-2 left-2 bg-amber-500/90 text-white border-none rounded-full">
            <Star className="w-3 h-3 mr-1 fill-white" /> Featured
          </Badge>
        )}
      </div>
      <CardContent className="p-4 flex-1 flex flex-col gap-2">
        <div className="flex items-center gap-1.5">
          <PlatformIcon platform={suggestion.videoPlatform} className="w-3.5 h-3.5" />
          <span className="text-xs text-muted-foreground capitalize">{suggestion.videoPlatform}</span>
        </div>
        <p className="font-medium text-foreground text-sm leading-snug line-clamp-2">{suggestion.videoTitle || "Untitled video"}</p>
        {suggestion.aiSummary && <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">{suggestion.aiSummary}</p>}
        <div className="flex items-center gap-1.5 flex-wrap mt-auto pt-1">
          {suggestion.categories.slice(0, 3).map((c) => (
            <Badge key={c} variant="outline" className="text-[10px] px-1.5 py-0 rounded-full">{c}</Badge>
          ))}
        </div>
        <div className="flex gap-2 pt-1">
          <Button asChild variant="outline" size="sm" className="flex-1 rounded-full">
            <a href={suggestion.videoUrl} target="_blank" rel="noopener noreferrer">Watch</a>
          </Button>
          <Button size="sm" className="flex-1 rounded-full" onClick={() => onWhisper(suggestion)} data-testid={`button-whisper-suggestion-${suggestion.id}`}>
            <Send className="w-3.5 h-3.5 mr-1.5" /> Whisper this
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function SuggestionsLibrary() {
  const [, setLocation] = useLocation();
  const [category, setCategory] = useState<string | null>(null);
  const [featuredOnly, setFeaturedOnly] = useState(false);

  const params = {
    ...(category ? { category } : {}),
    ...(featuredOnly ? { featured: "true" } : {}),
  };

  const { data, isLoading } = useListSuggestions(params, {
    query: { queryKey: getListSuggestionsQueryKey(params) },
  });

  function handleWhisper(suggestion: SuggestedVideo) {
    savePendingForward({
      videoUrl: suggestion.videoUrl,
      videoTitle: suggestion.videoTitle,
      videoThumbnail: suggestion.videoThumbnail,
      videoEmbedUrl: suggestion.videoEmbedUrl,
      videoPlatform: suggestion.videoPlatform,
    });
    setLocation("/send");
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-primary" /> Suggestions Library
          </h1>
          <p className="text-muted-foreground mt-1">
            Videos worth passing along. Find one that fits someone in your circle and whisper it to them anonymously.
          </p>
        </div>

        <div className="flex gap-2 flex-wrap items-center">
          <button
            type="button"
            onClick={() => setCategory(null)}
            className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
              category === null ? "bg-primary/10 text-primary border-primary/30" : "border-border/50 text-muted-foreground hover:text-foreground"
            }`}
            data-testid="suggestion-filter-all"
          >
            All
          </button>
          {data?.categories.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setCategory(category === c.key ? null : c.key)}
              className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                category === c.key ? "bg-primary/10 text-primary border-primary/30" : "border-border/50 text-muted-foreground hover:text-foreground"
              }`}
              data-testid={`suggestion-filter-${c.key}`}
            >
              {c.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setFeaturedOnly((v) => !v)}
            className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors flex items-center gap-1 ${
              featuredOnly ? "bg-amber-500/10 text-amber-400 border-amber-500/30" : "border-border/50 text-muted-foreground hover:text-foreground"
            }`}
            data-testid="suggestion-filter-featured"
          >
            <Star className={`w-3 h-3 ${featuredOnly ? "fill-amber-400" : ""}`} /> Featured
          </button>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="h-64 rounded-2xl" />)}
          </div>
        ) : data?.items.length ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.items.map((s) => <SuggestionCard key={s.id} suggestion={s} onWhisper={handleWhisper} />)}
          </div>
        ) : (
          <Card className="bg-card/50 border-dashed border-border py-16 text-center">
            <p className="text-muted-foreground">Nothing here yet — check back soon.</p>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
