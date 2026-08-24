import { useTranslation } from "react-i18next";
import { AppLayout } from "@/components/layout/AppLayout";
import { useListTextWhisps, useGetUserProfile } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Link } from "wouter";
import { ScrollText, Send, Inbox, PlusCircle, Phone, Clock } from "lucide-react";

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// Shared date+time stamp — every card shows both, not just the date, so a
// recipient/sender can tell "this morning" from "three Tuesdays ago" without
// opening the thread.
function formatWhen(when: string): string {
  return new Date(when).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
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
            {/* Received: primary-tinted icon chip and left edge, so the
                direction reads at a glance even before the copy is read —
                mirrors the accent Sent already got below. */}
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
                      className={`p-3.5 border-l-4 hover:border-l-primary transition-colors cursor-pointer ${w.status === "sent" ? "border-l-primary bg-primary/5 border-y-primary/20 border-r-primary/20" : "border-l-primary/30 bg-card border-y-border/50 border-r-border/50"}`}
                      data-testid={`text-whisp-received-${w.id}`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <Inbox className="w-4 h-4 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-medium text-primary truncate" data-testid={`text-whisp-received-from-${w.id}`}>
                              {t("textWhispsList.fromPrefix")} {w.senderAlias?.trim() || t("textWhispsList.anonymousSender")}
                            </p>
                            {w.status === "sent" && (
                              <span className="text-[10px] uppercase tracking-wide font-semibold text-primary shrink-0 bg-primary/10 rounded-full px-2 py-0.5">
                                {t("textWhispsList.newBadge")}
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-foreground truncate mt-0.5">{truncate(w.messageText, 60)}</p>
                          <p className="flex items-center gap-1 text-xs text-muted-foreground mt-1.5">
                            <Phone className="w-3 h-3 flex-shrink-0" /> {t("textWhispsList.receivedAtPrefix")} {w.recipientPhone}
                          </p>
                          <p className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                            <Clock className="w-3 h-3 flex-shrink-0" /> {formatWhen(w.createdAt)}
                          </p>
                        </div>
                      </div>
                    </Card>
                  </Link>
                ))
              )}
            </section>

            {/* Sent: secondary-tinted icon chip, and the recipient's own
                number front and center — the sender already typed it, so
                showing it back isn't a new disclosure, just a reminder of
                who this one went to. */}
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
                <Send className="w-4 h-4" /> {t("textWhispsList.sentHeading", { count: sent.length })}
              </h2>
              {sent.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("textWhispsList.sentEmpty")}</p>
              ) : (
                sent.map((w) => (
                  <Link key={w.id} href={`/text-whisps/${w.id}`}>
                    <Card
                      className="p-3.5 border-l-4 border-l-secondary/50 bg-card border-y-border/50 border-r-border/50 hover:border-l-secondary transition-colors cursor-pointer"
                      data-testid={`text-whisp-sent-${w.id}`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-full bg-secondary/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <Send className="w-4 h-4 text-secondary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-medium text-secondary truncate flex items-center gap-1" data-testid={`text-whisp-sent-to-${w.id}`}>
                              <Phone className="w-3 h-3 flex-shrink-0" /> {t("textWhispsList.toPrefix")} {w.recipientPhone}
                            </p>
                            <StatusBadge status={w.status} />
                          </div>
                          <p className="text-sm text-foreground truncate mt-0.5">{truncate(w.messageText, 60)}</p>
                          <p className="flex items-center gap-1 text-xs text-muted-foreground mt-1.5">
                            <Clock className="w-3 h-3 flex-shrink-0" /> {formatWhen(w.createdAt)}
                          </p>
                        </div>
                      </div>
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
