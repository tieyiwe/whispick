import { useState } from "react";
import { Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import {
  useListMyCircles,
  useCreateCircle,
  useJoinCircle,
  getListMyCirclesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Lock, Plus, LogIn, Copy, Loader2, ChevronRight } from "lucide-react";

export function MyCircles() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [newCircleName, setNewCircleName] = useState("");
  const [inviteCode, setInviteCode] = useState("");

  const { data: circles, isLoading } = useListMyCircles({
    query: { queryKey: getListMyCirclesQueryKey() },
  });
  const createCircle = useCreateCircle();
  const joinCircle = useJoinCircle();

  function handleCreate() {
    const name = newCircleName.trim();
    if (!name) return;
    createCircle.mutate(
      { data: { name } },
      {
        onSuccess: () => {
          setNewCircleName("");
          queryClient.invalidateQueries({ queryKey: getListMyCirclesQueryKey() });
          toast({ title: "Blind Circle created" });
        },
        onError: () => toast({ title: "Failed to create circle", variant: "destructive" }),
      }
    );
  }

  function handleJoin() {
    const code = inviteCode.trim();
    if (!code) return;
    joinCircle.mutate(
      { data: { inviteCode: code } },
      {
        onSuccess: () => {
          setInviteCode("");
          queryClient.invalidateQueries({ queryKey: getListMyCirclesQueryKey() });
          toast({ title: "Joined circle" });
        },
        onError: () => toast({ title: "Invalid invite code", variant: "destructive" }),
      }
    );
  }

  function copyInviteCode(code: string) {
    navigator.clipboard.writeText(code).then(() => toast({ title: "Invite code copied" }));
  }

  return (
    <AppLayout>
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground flex items-center gap-3">
            <Lock className="w-7 h-7 text-primary" /> My Blind Circles
          </h1>
          <p className="text-muted-foreground mt-1">
            Small, invite-only groups for whisps you only want a few people to see.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card className="bg-card border-border/50">
            <CardContent className="p-5 space-y-3">
              <p className="font-medium text-foreground flex items-center gap-2">
                <Plus className="w-4 h-4 text-primary" /> Create a circle
              </p>
              <div className="flex gap-2">
                <Input
                  placeholder="e.g. Book Club"
                  className="bg-input/50 border-border/50 rounded-xl"
                  value={newCircleName}
                  onChange={(e) => setNewCircleName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                  data-testid="input-new-circle-name"
                />
                <Button
                  onClick={handleCreate}
                  disabled={!newCircleName.trim() || createCircle.isPending}
                  className="rounded-xl shrink-0"
                  data-testid="button-create-circle"
                >
                  {createCircle.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card border-border/50">
            <CardContent className="p-5 space-y-3">
              <p className="font-medium text-foreground flex items-center gap-2">
                <LogIn className="w-4 h-4 text-primary" /> Join with a code
              </p>
              <div className="flex gap-2">
                <Input
                  placeholder="Invite code"
                  className="bg-input/50 border-border/50 rounded-xl"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleJoin()}
                  data-testid="input-invite-code"
                />
                <Button
                  onClick={handleJoin}
                  disabled={!inviteCode.trim() || joinCircle.isPending}
                  variant="outline"
                  className="rounded-xl shrink-0"
                  data-testid="button-join-circle"
                >
                  {joinCircle.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Join"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
          </div>
        ) : circles?.length ? (
          <div className="space-y-3">
            {circles.map((circle) => (
              <Card key={circle.id} className="bg-card border-border/50" data-testid={`circle-row-${circle.id}`}>
                <CardContent className="p-4 flex items-center justify-between gap-4">
                  <Link href={`/circles/${circle.id}`} className="flex-1 min-w-0 flex items-center gap-3 group">
                    <div className="p-2.5 rounded-xl bg-primary/10">
                      <Lock className="w-4 h-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-foreground truncate group-hover:text-primary transition-colors">{circle.name}</p>
                      <p className="text-xs text-muted-foreground">Tap to view feed</p>
                    </div>
                  </Link>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => copyInviteCode(circle.inviteCode)}
                      className="rounded-full text-muted-foreground"
                      data-testid={`button-copy-invite-${circle.id}`}
                    >
                      <Copy className="w-3.5 h-3.5 mr-1.5" /> {circle.inviteCode}
                    </Button>
                    <Link href={`/circles/${circle.id}`}>
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    </Link>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="bg-card/50 border-dashed border-border py-16 text-center">
            <Lock className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
            <h3 className="text-xl font-medium text-foreground mb-2">No circles yet</h3>
            <p className="text-muted-foreground max-w-md mx-auto">
              Create one to share whisps privately with a small group, or join one with an invite code.
            </p>
          </Card>
        )}
      </div>
    </AppLayout>
  );
}
