import { useParams, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { AppLayout } from "@/components/layout/AppLayout";
import { useGetCircleWhisps, useListMyCircles, getGetCircleWhispsQueryKey } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { MoodTag } from "@/components/shared/MoodTag";
import { ArrowLeft, PlayCircle, VenetianMask } from "lucide-react";

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
          <Button variant="ghost" onClick={() => setLocation("/circles")} className="text-muted-foreground -ml-2 mb-2" data-testid="button-back-circles">
            <ArrowLeft className="w-4 h-4 mr-1" /> {t("circleDetail.backToMyCircles")}
          </Button>
          <h1 className="text-3xl font-serif font-bold text-foreground flex items-center gap-3">
            <VenetianMask className="w-7 h-7 text-primary" /> {circle?.name ?? t("circleDetail.titleFallback")}
          </h1>
          <p className="text-muted-foreground mt-1">
            {t("circleDetail.description")}
          </p>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Skeleton key={i} className="h-64 rounded-2xl" />
            ))}
          </div>
        ) : items.length ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {items.map((item) => (
              <Link key={item.id} href={`/w/${item.publicToken}`}>
                <Card
                  className="bg-card hover:bg-card/80 transition-colors border-border/50 cursor-pointer overflow-hidden group h-full flex flex-col"
                  data-testid={`circle-detail-item-${item.id}`}
                >
                  {item.videoThumbnail ? (
                    <div className="relative h-36 shrink-0">
                      <img src={item.videoThumbnail} alt={item.videoTitle ?? t("circleDetail.videoAlt")} className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/40 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                        <PlayCircle className="w-9 h-9 text-white opacity-80" />
                      </div>
                    </div>
                  ) : (
                    <div className="h-36 shrink-0 bg-muted flex items-center justify-center">
                      <PlayCircle className="w-9 h-9 text-muted-foreground" />
                    </div>
                  )}
                  <div className="p-4 flex-1 flex flex-col gap-2 min-w-0">
                    {item.videoTitle && <p className="font-medium text-foreground truncate">{item.videoTitle}</p>}
                    {item.moodTag && <MoodTag mood={item.moodTag} className="scale-90 origin-left self-start" />}
                    {item.anonymousNote && (
                      <p className="text-sm text-muted-foreground italic line-clamp-2">"{item.anonymousNote}"</p>
                    )}
                    <p className="text-xs text-muted-foreground mt-auto">
                      {item.senderAlias ?? t("circleDetail.someone")} · {new Date(item.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        ) : (
          <Card className="bg-card/50 border-dashed border-border py-16 text-center">
            <VenetianMask className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
            <h3 className="text-xl font-medium text-foreground mb-2">{t("circleDetail.emptyTitle")}</h3>
            <p className="text-muted-foreground max-w-md mx-auto">
              {t("circleDetail.emptyDescription")}
            </p>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
