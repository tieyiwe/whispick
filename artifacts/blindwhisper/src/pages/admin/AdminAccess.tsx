import { useState } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import {
  useAdminListAccessGrants,
  useAdminCreateAccessGrant,
  useAdminUpdateAccessGrant,
  useAdminRevokeAccessGrant,
  type AdminGrant,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { KeyRound, UserPlus, Loader2, Trash2, Pencil, Check, X, Clock } from "lucide-react";

const PERMISSION_LABELS: Record<string, string> = {
  users: "Users",
  whisps: "Whisps",
  moderation: "Moderation",
  reports: "Reports",
  suggestions: "Suggestions",
  agents: "Content agents (Town Crier & Circle Scout)",
  notifications: "Notifications",
  policies: "Policies",
  analytics: "Analytics & Overview",
  audit_log: "Audit Log",
  projects: "Projects & Tasks",
  bugrabbit: "BugRabbit (error tracker)",
};

function PermissionPicker({
  available,
  selected,
  onToggle,
}: {
  available: string[];
  selected: string[];
  onToggle: (key: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
      {available.map((key) => {
        const on = selected.includes(key);
        return (
          <button
            key={key}
            type="button"
            onClick={() => onToggle(key)}
            aria-pressed={on}
            data-testid={`permission-${key}`}
            className={`flex items-center gap-2 p-2 rounded-xl text-xs text-left border transition-all ${
              on ? "border-primary bg-primary/10 text-foreground" : "border-border/50 text-muted-foreground hover:border-border"
            }`}
          >
            <span className={`w-3.5 h-3.5 rounded flex items-center justify-center border ${on ? "bg-primary border-primary" : "border-border"}`}>
              {on && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
            </span>
            {PERMISSION_LABELS[key] ?? key}
          </button>
        );
      })}
    </div>
  );
}

// Staff & Access — the owner's tool for running the team: invite
// collaborators by email with a staff role (preset permission bundle,
// customizable per person), see who's linked and active, rescope live,
// revoke entirely. Backend: routes/adminAccess.ts; enforcement:
// lib/adminAuth.ts's requirePermission on every admin area.
export function AdminAccess() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useAdminListAccessGrants();
  const create = useAdminCreateAccessGrant();
  const update = useAdminUpdateAccessGrant();
  const revoke = useAdminRevokeAccessGrant();

  const [email, setEmail] = useState("");
  const [roleTitle, setRoleTitle] = useState("Moderator");
  const [permissions, setPermissions] = useState<string[]>(["moderation", "reports", "projects"]);
  const [editing, setEditing] = useState<{ id: string; roleTitle: string; permissions: string[] } | null>(null);

  const available = data?.availablePermissions ?? [];
  const presets = data?.rolePresets ?? [];

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["/api/admin/access/grants"] });
  }

  function applyPreset(title: string) {
    setRoleTitle(title);
    const preset = presets.find((p) => p.title === title);
    if (preset) setPermissions([...preset.permissions]);
  }

  function toggle(list: string[], key: string): string[] {
    return list.includes(key) ? list.filter((k) => k !== key) : [...list, key];
  }

  function handleInvite() {
    create.mutate(
      { data: { email: email.trim().toLowerCase(), roleTitle: roleTitle.trim(), permissions } },
      {
        onSuccess: (g) => {
          setEmail("");
          refresh();
          toast({
            title: `${g.roleTitle} invited`,
            description: g.linkedAt
              ? "They already have an account — access is active the next time they open the admin panel."
              : "Access will activate automatically the first time they sign in with this email.",
          });
        },
        onError: (err: any) => toast({ title: err?.data?.error ?? "Couldn't create the invite", variant: "destructive" }),
      },
    );
  }

  function handleSaveEdit() {
    if (!editing) return;
    update.mutate(
      { id: editing.id, data: { roleTitle: editing.roleTitle, permissions: editing.permissions } },
      {
        onSuccess: () => {
          setEditing(null);
          refresh();
          toast({ title: "Access updated", description: "Takes effect on their next admin request." });
        },
        onError: (err: any) => toast({ title: err?.data?.error ?? "Couldn't update access", variant: "destructive" }),
      },
    );
  }

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground flex items-center gap-2">
            <KeyRound className="w-7 h-7 text-primary" /> Staff & Access
          </h1>
          <p className="text-muted-foreground mt-1">
            Invite collaborators and control exactly which areas of the HQ each one can use. You're the
            super admin — full access, and the only one who can manage this page. Every staff member signs
            in with their own account and their own two-factor authenticator.
          </p>
        </div>

        <Card className="bg-card border-border/50">
          <CardContent className="p-6 space-y-4">
            <p className="font-medium text-foreground flex items-center gap-2"><UserPlus className="w-4 h-4 text-primary" /> Invite a collaborator</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-muted-foreground">Email</Label>
                <Input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="teammate@example.com"
                  type="email"
                  className="bg-input/50 border-border/50 rounded-xl"
                  data-testid="input-invite-email"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-muted-foreground">Staff role</Label>
                <Select value={roleTitle} onValueChange={applyPreset}>
                  <SelectTrigger className="bg-input/50 border-border/50 rounded-xl" data-testid="select-invite-role"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {presets.map((p) => (
                      <SelectItem key={p.title} value={p.title}>{p.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-muted-foreground">Permissions (customize freely — the role is just a starting point)</Label>
              <PermissionPicker available={available} selected={permissions} onToggle={(k) => setPermissions((p) => toggle(p, k))} />
            </div>
            <Button
              className="rounded-full"
              onClick={handleInvite}
              disabled={!email.trim() || permissions.length === 0 || create.isPending}
              data-testid="button-invite-collaborator"
            >
              {create.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <UserPlus className="w-4 h-4 mr-2" />}
              Invite
            </Button>
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="space-y-3">{[1, 2].map((i) => <Skeleton key={i} className="h-24 rounded-2xl" />)}</div>
        ) : data?.items.length ? (
          <div className="space-y-2">
            {data.items.map((g: AdminGrant) => {
              const isEditing = editing?.id === g.id;
              return (
                <Card key={g.id} className="bg-card border-border/50" data-testid={`grant-row-${g.id}`}>
                  <CardContent className="p-4 space-y-2.5">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap min-w-0">
                        <span className="font-medium text-foreground truncate">{g.email}</span>
                        <Badge className="bg-primary text-primary-foreground">{g.roleTitle}</Badge>
                        {g.linkedAt ? (
                          <Badge variant="outline" className="border-emerald-500 text-emerald-500">Active</Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground gap-1"><Clock className="w-3 h-3" /> Awaiting first sign-in</Badge>
                        )}
                      </div>
                      {g.lastSeenAt && (
                        <span className="text-xs text-muted-foreground shrink-0">Last seen {new Date(g.lastSeenAt).toLocaleString()}</span>
                      )}
                    </div>

                    {isEditing ? (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2">
                          <Input
                            value={editing.roleTitle}
                            onChange={(e) => setEditing({ ...editing, roleTitle: e.target.value.slice(0, 60) })}
                            className="rounded-xl w-56"
                          />
                        </div>
                        <PermissionPicker
                          available={available}
                          selected={editing.permissions}
                          onToggle={(k) => setEditing({ ...editing, permissions: toggle(editing.permissions, k) })}
                        />
                        <div className="flex gap-2">
                          <Button size="sm" className="rounded-full" onClick={handleSaveEdit} disabled={update.isPending || editing.permissions.length === 0}>
                            <Check className="w-3.5 h-3.5 mr-1.5" /> Save
                          </Button>
                          <Button size="sm" variant="outline" className="rounded-full" onClick={() => setEditing(null)}>
                            <X className="w-3.5 h-3.5 mr-1.5" /> Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex flex-wrap gap-1.5">
                          {g.permissions.map((p) => (
                            <Badge key={p} variant="outline" className="text-xs">{PERMISSION_LABELS[p] ?? p}</Badge>
                          ))}
                        </div>
                        <div className="flex items-center gap-1.5 pt-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="rounded-full"
                            onClick={() => setEditing({ id: g.id, roleTitle: g.roleTitle, permissions: [...g.permissions] })}
                          >
                            <Pencil className="w-3.5 h-3.5 mr-1.5" /> Edit access
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button size="sm" variant="ghost" className="rounded-full text-muted-foreground hover:text-destructive" disabled={revoke.isPending}>
                                <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Revoke
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Revoke {g.email}'s staff access?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Their account loses the admin role entirely — they go back to being a regular
                                  Blind Whisper user. Their personal account and content are untouched.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  onClick={() =>
                                    revoke.mutate(
                                      { id: g.id },
                                      {
                                        onSuccess: () => { refresh(); toast({ title: "Access revoked" }); },
                                        onError: (err: any) => toast({ title: err?.data?.error ?? "Couldn't revoke", variant: "destructive" }),
                                      },
                                    )
                                  }
                                >
                                  Revoke access
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card className="bg-card/50 border-dashed border-border py-16 text-center">
            <p className="text-muted-foreground">No staff yet — invite your first collaborator above.</p>
          </Card>
        )}
      </div>
    </AdminLayout>
  );
}
