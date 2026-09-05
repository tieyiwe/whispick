import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation("whisp");
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
      toast({ title: t("whisperGroupDetail.toast.addEmailOrPhone"), variant: "destructive" });
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
          toast({ title: t("whisperGroupDetail.toast.memberAdded") });
        },
        onError: () => toast({ title: t("whisperGroupDetail.toast.failedToAddMember"), variant: "destructive" }),
      }
    );
  }

  async function handleAddFromContacts() {
    const contacts = await pickContacts();
    if (!contacts.length) return;

    const withContactInfo = contacts.filter((c) => c.email || c.tel);
    if (!withContactInfo.length) {
      toast({ title: t("whisperGroupDetail.toast.noneHadContactInfo"), variant: "destructive" });
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
          toast({ title: t("whisperGroupDetail.toast.membersAdded", { count: withContactInfo.length }) });
        },
        onError: () => toast({ title: t("whisperGroupDetail.toast.failedToAddMembers"), variant: "destructive" }),
      }
    );
  }

  function handleRemoveMember(memberId: string) {
    removeMember.mutate(
      { id: id!, memberId },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: t("whisperGroupDetail.toast.memberRemoved") });
        },
        onError: () => toast({ title: t("whisperGroupDetail.toast.failedToRemoveMember"), variant: "destructive" }),
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
          toast({ title: t("whisperGroupDetail.toast.groupDeleted") });
        },
        onError: () => toast({ title: t("whisperGroupDetail.toast.failedToDeleteGroup"), variant: "destructive" }),
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
          <p className="text-muted-foreground">{t("whisperGroupDetail.notFound")}</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-5">
        <div className="flex items-center justify-between">
          <Button variant="ghost" onClick={() => setLocation("/whisper-groups")} className="text-muted-foreground -ml-2">
            <ArrowLeft className="w-4 h-4 mr-1" /> {t("whisperGroupDetail.whisperGroupsLink")}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" data-testid="button-delete-group">
                <Trash2 className="w-4 h-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("whisperGroupDetail.deleteDialog.title", { name: group.name })}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("whisperGroupDetail.deleteDialog.description")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("shared.cancel")}</AlertDialogCancel>
                <AlertDialogAction onClick={handleDeleteGroup} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  {t("shared.delete")}
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
            <Send className="w-4 h-4 mr-2" /> {t("whisperGroupDetail.sendAWhisp")}
          </Button>
        </div>

        <Card className="bg-card border-border/50">
          <CardContent className="p-5 space-y-4">
            <p className="font-medium text-foreground">{t("whisperGroupDetail.addMembers")}</p>

            {isContactPickerSupported() && (
              <Button
                type="button"
                variant="outline"
                className="w-full rounded-xl"
                onClick={handleAddFromContacts}
                disabled={addMembers.isPending}
                data-testid="button-add-from-contacts"
              >
                <Contact className="w-4 h-4 mr-2" /> {t("whisperGroupDetail.addFromContacts")}
              </Button>
            )}

            <div className="flex items-center gap-2">
              <div className="flex-1 h-px bg-border/40" />
              <span className="text-xs text-muted-foreground">{t("whisperGroupDetail.orAddManually")}</span>
              <div className="flex-1 h-px bg-border/40" />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Input
                placeholder={t("whisperGroupDetail.namePlaceholder")}
                className="bg-input/50 border-border/50 rounded-xl"
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
                data-testid="input-manual-member-name"
              />
              <Input
                placeholder={t("whisperGroupDetail.emailPlaceholder")}
                type="email"
                className="bg-input/50 border-border/50 rounded-xl"
                value={manualEmail}
                onChange={(e) => setManualEmail(e.target.value)}
                data-testid="input-manual-member-email"
              />
              <Input
                placeholder={t("whisperGroupDetail.phonePlaceholder")}
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
              {t("whisperGroupDetail.addMember")}
            </Button>
          </CardContent>
        </Card>

        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">{t("shared.memberCount", { count: group.members.length })}</p>
          {group.members.length ? group.members.map((m) => (
            <Card key={m.id} className="bg-card border-border/50" data-testid={`group-member-${m.id}`}>
              <CardContent className="p-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{m.name || t("whisperGroupDetail.unnamedContact")}</p>
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
              <p className="text-muted-foreground text-sm">{t("whisperGroupDetail.noMembersYet")}</p>
            </Card>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
