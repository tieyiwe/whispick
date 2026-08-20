import { useTranslation } from "react-i18next";
import { AppLayout } from "@/components/layout/AppLayout";
import { useListTextWhisps, useGetUserProfile } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { ScrollText, Send, Inbox, PlusCircle } from "lucide-react";

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function TextWhispsList() {
  const { t } = useTranslation("textWhisp");
  const { data: profile } = useGetUserProfile();
  const { data: textWhisps, isLoading } = useListTextWhisps();

  const sent = (textWhisps ?? []).filter((w) => w.senderId === profile?.id);
  const received = (textWhisps ?? []).filter((w) => w.viewerIsRecipient);

  return (
    <AppLayout>
      <div className="space-y-8">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-3xl font-serif font-bold text-foreground flex items-center gap-2">
              <ScrollText className="w-7 h-7 text-primary" /> {t("textWhispsList.heading")}
            </h1>
            <p className="text-muted-foreground mt-1">
              {t("textWhispsList.description")}
            </p>
          </div>
          <Link href="/send-text">
            <Button className="rounded-full" data-testid="button-new-text-whisp">
              <PlusCircle className="w-4 h-4 mr-2" /> {t("textWhispsList.newButton")}
            </Button>
          </Link>
        </div>

        {isLoading ? (
          <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div>
        ) : !textWhisps?.length ? (
          <Card className="bg-card/50 border-dashed border-border py-16 text-center">
            <p className="text-muted-foreground">{t("textWhispsList.emptyState")}</p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
                <Inbox className="w-4 h-4" /> {t("textWhispsList.receivedHeading", { count: received.length })}
              </h2>
              {received.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("textWhispsList.receivedEmpty")}</p>
              ) : (
                received.map((w) => (
                  <Link key={w.id} href={`/text-whisps/${w.id}`}>
                    <Card
                      className={`p-3.5 hover:border-primary/40 transition-colors cursor-pointer ${w.status === "sent" ? "border-primary/40 bg-primary/5" : "bg-card border-border/50"}`}
                      data-testid={`text-whisp-received-${w.id}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm text-foreground truncate">{truncate(w.messageText, 60)}</p>
                        {w.status === "sent" && <span className="text-[10px] uppercase tracking-wide text-primary shrink-0">{t("textWhispsList.newBadge")}</span>}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{new Date(w.createdAt).toLocaleDateString()}</p>
                    </Card>
                  </Link>
                ))
              )}
            </section>

            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
                <Send className="w-4 h-4" /> {t("textWhispsList.sentHeading", { count: sent.length })}
              </h2>
              {sent.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("textWhispsList.sentEmpty")}</p>
              ) : (
                sent.map((w) => (
                  <Link key={w.id} href={`/text-whisps/${w.id}`}>
                    <Card className="p-3.5 bg-card border-border/50 hover:border-primary/40 transition-colors cursor-pointer" data-testid={`text-whisp-sent-${w.id}`}>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm text-foreground truncate">{truncate(w.messageText, 60)}</p>
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0 capitalize">{w.status}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{new Date(w.createdAt).toLocaleDateString()}</p>
                    </Card>
                  </Link>
                ))
              )}
            </section>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
