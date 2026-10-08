import { useParams, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { AppLayout } from "@/components/layout/AppLayout";
import { useGetCircleWhisps, useListMyCircles, getGetCircleWhispsQueryKey } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { formatTimeAgo } from "@/lib/relativeTime";
import { MoodTag } from "@/components/shared/MoodTag";
import { ArrowLeft, PlayCircle, VenetianMask } from "lucide-react";
import { AnonymousMark } from "@/components/shared/AnonymousMark";

export function CircleDetail() {
  const { t } = useTranslation("circle");
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { data, isLoading } = useGetCircleWhisps(id!, {
    query: { enabled: !!id, queryKey: getGetCircleWhispsQueryKey(id!) },
  });
  const { data: myCircles } = useListMyCircles();
  const items = data?.items ?? [];
  const circle = myCircles?.find((c) => c.id === id);

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <Button variant="ghost" onClick={() => setLocation("/circles")} className="text-muted-foreground hover:text-foreground -ml-3 mb-2 h-11 px-3 rounded-full" data-testid="button-back-circles">
            <ArrowLeft className="w-4 h-4" /> {t("circleDetail.backToMyCircles")}
          </Button>
          <h1 className="text-3xl font-serif font-bold text-foreground flex items-center gap-3">
            <VenetianMask className="w-7 h-7 text-primary shrink-0" /> {circle?.name ?? t("circleDetail.titleFallback")}
          </h1>
          <p className="text-[15px] text-muted-foreground mt-1.5 max-w-xl leading-relaxed">
            {t("circleDetail.description")}
          </p>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4" aria-hidden>
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="rounded-2xl border border-border/50 bg-card overflow-hidden">
                <Skeleton className="aspect-video w-full rounded-none" />
                <div className="p-4 space-y-3">
                  <Skeleton className="h-5 w-4/5" />
                  <Skeleton className="h-6 w-28 rounded-full" />
                  <Skeleton className="h-3.5 w-32" />
                </div>
              </div>
            ))}
          </div>
        ) : items.length ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
            {items.map((item) => (
              <Link key={item.id} href={`/w/${item.publicToken}`} className="block rounded-2xl">
                <Card
                  className="bg-card hover:border-border transition-colors duration-200 border-border/50 rounded-2xl cursor-pointer overflow-hidden group h-full flex flex-col"
                  data-testid={`circle-detail-item-${item.id}`}
                >
                  {item.videoThumbnail ? (
                    <div className="relative aspect-video shrink-0 overflow-hidden bg-muted">
                      <img
                        src={item.videoThumbnail}
                        alt={item.videoTitle ?? t("circleDetail.videoAlt")}
                        loading="lazy"
                        className="w-full h-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.02]"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-black/10 to-black/20 flex items-center justify-center">
                        <PlayCircle className="w-10 h-10 text-white/90 drop-shadow" strokeWidth={1.5} />
                      </div>
                    </div>
                  ) : (
                    <div className="aspect-video shrink-0 bg-muted flex items-center justify-center">
                      <PlayCircle className="w-10 h-10 text-muted-foreground" strokeWidth={1.5} />
                    </div>
                  )}
                  <div className="p-4 flex-1 flex flex-col items-start gap-2.5 min-w-0">
                    {item.videoTitle && (
                      <p className="font-serif text-lg font-semibold leading-snug text-foreground line-clamp-2 group-hover:text-primary transition-colors">
                        {item.videoTitle}
                      </p>
                    )}
                    {item.moodTag && <MoodTag mood={item.moodTag} className="py-0.5! pr-3! text-[13px]!" />}
                    {item.anonymousNote && (
                      <p className="text-sm text-muted-foreground italic leading-relaxed line-clamp-3">
                        &ldquo;{item.anonymousNote}&rdquo;
                      </p>
                    )}
                    <div className="flex items-center gap-1.5 mt-auto pt-2 w-full border-t border-border/40">
                      <AnonymousMark size="sm" />
                      <p className="text-[13px] text-muted-foreground min-w-0 break-words">
                        {item.senderAlias ?? t("circleDetail.someone")} ·{" "}
                        <time dateTime={item.createdAt} className="tabular-nums">
                          {formatTimeAgo(new Date(item.createdAt))}
                        </time>
                      </p>
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        ) : (
          <Card className="bg-card/50 border-dashed border-border/60 rounded-2xl py-14 px-6 text-center">
            <VenetianMask className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
            <h3 className="text-xl font-serif font-semibold text-foreground mb-2">{t("circleDetail.emptyTitle")}</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              {t("circleDetail.emptyDescription")}
            </p>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
