import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import {
  useGetWhisperGroup,
  useAddWhisperGroupMembers,
  useRemoveWhisperGroupMember,
  useDeleteWhisperGroup,
  getGetWhisperGroupQueryKey,
  getListWhisperGroupsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
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
import { isContactPickerSupported, pickContacts } from "@/lib/contactPicker";
import { ArrowLeft, UsersRound, Contact, Plus, Trash2, Send, Loader2, Mail, Phone } from "lucide-react";

export function WhisperGroupDetail() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [manualName, setManualName] = useState("");
  const [manualEmail, setManualEmail] = useState("");
  const [manualPhone, setManualPhone] = useState("");

  const { data: group, isLoading } = useGetWhisperGroup(id!, {
    query: { enabled: !!id, queryKey: getGetWhisperGroupQueryKey(id!) },
  });
  const addMembers = useAddWhisperGroupMembers();
  const removeMember = useRemoveWhisperGroupMember();
  const deleteGroup = useDeleteWhisperGroup();

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: getGetWhisperGroupQueryKey(id!) });
    queryClient.invalidateQueries({ queryKey: getListWhisperGroupsQueryKey() });
  }

  function handleAddManual() {
    if (!manualEmail.trim() && !manualPhone.trim()) {
      toast({ title: "Add an email or a phone number", variant: "destructive" });
      return;
    }
    addMembers.mutate(
      {
        id: id!,
        data: {
          members: [
            {
              name: manualName.trim() || null,
              email: manualEmail.trim() || null,
              phone: manualPhone.trim() || null,
            },
          ],
        },
      },
      {
        onSuccess: () => {
          setManualName("");
          setManualEmail("");
          setManualPhone("");
          invalidate();
          toast({ title: "Member added" });
        },
        onError: () => toast({ title: "Failed to add member", variant: "destructive" }),
      }
    );
  }

  async function handleAddFromContacts() {
    const contacts = await pickContacts();
    if (!contacts.length) return;

    const withContactInfo = contacts.filter((c) => c.email || c.tel);
    if (!withContactInfo.length) {
      toast({ title: "None of those contacts had an email or phone number", variant: "destructive" });
      return;
    }

    addMembers.mutate(
      {
        id: id!,
        data: {
          members: withContactInfo.map((c) => ({ name: c.name, email: c.email, phone: c.tel })),
        },
      },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: `${withContactInfo.length} member${withContactInfo.length > 1 ? "s" : ""} added` });
        },
        onError: () => toast({ title: "Failed to add members", variant: "destructive" }),
      }
    );
  }

  function handleRemoveMember(memberId: string) {
    removeMember.mutate(
      { id: id!, memberId },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: "Member removed" });
        },
        onError: () => toast({ title: "Failed to remove member", variant: "destructive" }),
      }
    );
  }

  function handleDeleteGroup() {
    deleteGroup.mutate(
      { id: id! },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListWhisperGroupsQueryKey() });
          setLocation("/whisper-groups");
          toast({ title: "Group deleted" });
        },
        onError: () => toast({ title: "Failed to delete group", variant: "destructive" }),
      }
    );
  }

  if (isLoading) {
    return (
      <AppLayout>
        <div className="max-w-2xl mx-auto space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-48 rounded-2xl" />
        </div>
      </AppLayout>
    );
  }

  if (!group) {
    return (
      <AppLayout>
        <div className="max-w-2xl mx-auto text-center py-16">
          <p className="text-muted-foreground">Group not found.</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-5">
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => setLocation("/whisper-groups")} className="text-muted-foreground -ml-2">
            <ArrowLeft className="w-4 h-4 mr-1" /> Whisper Groups
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" data-testid="button-delete-group">
                <Trash2 className="w-4 h-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete "{group.name}"?</AlertDialogTitle>
                <AlertDialogDescription>
                  This removes the saved group and its member list. Whisps you've already sent to this group aren't affected.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDeleteGroup} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-serif font-bold text-foreground flex items-center gap-2 truncate">
            <UsersRound className="w-6 h-6 text-primary shrink-0" /> {group.name}
          </h1>
          <Button
            className="rounded-full shrink-0"
            onClick={() => setLocation(`/send?group=${group.id}`)}
            disabled={!group.members.length}
            data-testid="button-send-to-group"
          >
            <Send className="w-4 h-4 mr-2" /> Send a Whisp
          </Button>
        </div>

        <Card className="bg-card border-border/50">
          <CardContent className="p-5 space-y-4">
            <p className="font-medium text-foreground">Add members</p>

            {isContactPickerSupported() && (
              <Button
                type="button"
                variant="outline"
                className="w-full rounded-xl"
                onClick={handleAddFromContacts}
                disabled={addMembers.isPending}
                data-testid="button-add-from-contacts"
              >
                <Contact className="w-4 h-4 mr-2" /> Add from Contacts
              </Button>
            )}

            <div className="flex items-center gap-2">
              <div className="flex-1 h-px bg-border/40" />
              <span className="text-xs text-muted-foreground">or add manually</span>
              <div className="flex-1 h-px bg-border/40" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Input
                placeholder="Name (optional)"
                className="bg-input/50 border-border/50 rounded-xl"
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                data-testid="input-manual-member-name"
              />
              <Input
                placeholder="Email"
                type="email"
                className="bg-input/50 border-border/50 rounded-xl"
                value={manualEmail}
                onChange={(e) => setManualEmail(e.target.value)}
                data-testid="input-manual-member-email"
              />
              <Input
                placeholder="Phone"
                type="tel"
                className="bg-input/50 border-border/50 rounded-xl"
                value={manualPhone}
                onChange={(e) => setManualPhone(e.target.value)}
                data-testid="input-manual-member-phone"
              />
            </div>
            <Button
              variant="outline"
              className="rounded-xl"
              onClick={handleAddManual}
              disabled={addMembers.isPending}
              data-testid="button-add-manual-member"
            >
              {addMembers.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
              Add member
            </Button>
          </CardContent>
        </Card>

        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">{group.members.length} member{group.members.length === 1 ? "" : "s"}</p>
          {group.members.length ? group.members.map((m) => (
            <Card key={m.id} className="bg-card border-border/50" data-testid={`group-member-${m.id}`}>
              <CardContent className="p-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{m.name || "Unnamed contact"}</p>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    {m.email && <span className="flex items-center gap-1 truncate"><Mail className="w-3 h-3 shrink-0" /> {m.email}</span>}
                    {m.phone && <span className="flex items-center gap-1 truncate"><Phone className="w-3 h-3 shrink-0" /> {m.phone}</span>}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="rounded-full text-muted-foreground hover:text-destructive shrink-0"
                  onClick={() => handleRemoveMember(m.id)}
                  disabled={removeMember.isPending}
                  data-testid={`button-remove-member-${m.id}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </CardContent>
            </Card>
          )) : (
            <Card className="bg-card/50 border-dashed border-border py-8 text-center">
              <p className="text-muted-foreground text-sm">No members yet — add some above.</p>
            </Card>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
