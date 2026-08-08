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
  const { data: profile } = useGetUserProfile();
  const { data: textWhisps, isLoading } = useListTextWhisps();

  const sent = (textWhisps ?? []).filter((t) => t.senderId === profile?.id);
  const received = (textWhisps ?? []).filter((t) => t.recipientUserId === profile?.id);

  return (
    <AppLayout>
      <div className="space-y-8">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-3xl font-serif font-bold text-foreground flex items-center gap-2">
              <ScrollText className="w-7 h-7 text-primary" /> Text Whisps
            </h1>
            <p className="text-muted-foreground mt-1">
              Short, anonymous notes between you and other Blind Whisper people — a separate thing from your video Whisps.
            </p>
          </div>
          <Link href="/send-text">
            <Button className="rounded-full" data-testid="button-new-text-whisp">
              <PlusCircle className="w-4 h-4 mr-2" /> New Text Whisp
            </Button>
          </Link>
        </div>

        {isLoading ? (
          <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}</div>
        ) : !textWhisps?.length ? (
          <Card className="bg-card/50 border-dashed border-border py-16 text-center">
            <p className="text-muted-foreground">No Text Whisps yet.</p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
                <Inbox className="w-4 h-4" /> Received ({received.length})
              </h2>
              {received.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing here yet.</p>
              ) : (
                received.map((t) => (
                  <Link key={t.id} href={`/text-whisps/${t.id}`}>
                    <Card
                      className={`p-3.5 hover:border-primary/40 transition-colors cursor-pointer ${t.status === "sent" ? "border-primary/40 bg-primary/5" : "bg-card border-border/50"}`}
                      data-testid={`text-whisp-received-${t.id}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm text-foreground truncate">{truncate(t.messageText, 60)}</p>
                        {t.status === "sent" && <span className="text-[10px] uppercase tracking-wide text-primary shrink-0">New</span>}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{new Date(t.createdAt).toLocaleDateString()}</p>
                    </Card>
                  </Link>
                ))
              )}
            </section>

            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground flex items-center gap-1.5">
                <Send className="w-4 h-4" /> Sent ({sent.length})
              </h2>
              {sent.length === 0 ? (
                <p className="text-sm text-muted-foreground">You haven't sent any yet.</p>
              ) : (
                sent.map((t) => (
                  <Link key={t.id} href={`/text-whisps/${t.id}`}>
                    <Card className="p-3.5 bg-card border-border/50 hover:border-primary/40 transition-colors cursor-pointer" data-testid={`text-whisp-sent-${t.id}`}>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm text-foreground truncate">{truncate(t.messageText, 60)}</p>
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0 capitalize">{t.status}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{new Date(t.createdAt).toLocaleDateString()}</p>
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
