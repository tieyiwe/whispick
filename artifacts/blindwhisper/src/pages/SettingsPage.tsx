import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useUser } from "@clerk/react";
import {
  useGetUserProfile,
  useUpdateUserProfile,
  useGetPushPublicKey,
  useCreatePushSubscription,
  useDeletePushSubscription,
  useEnableWhisperBox,
  useDisableWhisperBox,
  useGetUserRecap,
  getGetUserProfileQueryKey,
  getGetPushPublicKeyQueryKey,
  getGetUserRecapQueryKey,
  type UserRecap,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Loader2, User, Mail, Shield, Bell, Phone, ShieldCheck, ShieldAlert, Swords, Mailbox, Share2, Image, UserPlus, MessageSquareText } from "lucide-react";
import { isPushSupported, getExistingPushSubscription, subscribeToPush, pushSubscriptionToJson } from "@/lib/push";
import { shareWhisperBoxStoryCard } from "@/lib/whisperBoxStoryCard";
import { whisperBoxShareUrl } from "@/lib/whisperBoxUrl";
import { isAppBadgeSupported, useAppBadgeEnabled } from "@/lib/useAppBadge";
import { GENDER_OPTIONS, AGE_RANGE_OPTIONS } from "@/lib/demographics";
import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGUAGES, LANGUAGE_LABELS } from "@/lib/languages";
import i18n from "@/i18n";
import { PhoneVerificationFlow } from "@/components/shared/PhoneVerificationFlow";
import { AvatarCircle } from "@/components/shared/AvatarCircle";
import { AvatarPickerGrid } from "@/components/shared/AvatarPickerGrid";
import { WhisperBoxLinkDialog } from "@/components/shared/WhisperBoxLinkDialog";

const WHISPER_LINK_LIMITS: Record<string, number | null> = {
  free: 3,
  spark: null,
  ember: null,
};

export function SettingsPage() {
  // refetchOnMount: "always" (not the default staleTime-gated refetch) —
  // this page is the "Get your Whisper Box link" entry point, and
  // whisperBoxHandlePersonalized/whisperBoxEnabled can change from
  // elsewhere in the same session (another tab, the onboarding flow) with
  // no local mutation here to invalidate this query's cache. Without this,
  // a stale cached profile can wrongly show the "personalize your link"
  // name-capture step (or hide copy/share) until *some* mutation on this
  // page happens to invalidate it — which is exactly the "had to toggle it
  // off and on before copy/share worked" bug this fixes.
  const { data: profile, isLoading } = useGetUserProfile({
    query: { refetchOnMount: "always", queryKey: getGetUserProfileQueryKey() },
  });
  const { isLoaded: clerkLoaded, user } = useUser();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation("account");
  const { t: tDemographics } = useTranslation("demographics");
  const { t: tWhisperBox } = useTranslation("whisperBox");
  const [fullName, setFullName] = useState("");
  const [gender, setGender] = useState("");
  const [ageRange, setAgeRange] = useState("");
  const [preferredLanguage, setPreferredLanguage] = useState("");
  const [whispererAvatarId, setWhispererAvatarId] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  if (profile && !initialized) {
    setFullName(profile.fullName ?? "");
    setGender(profile.gender ?? "");
    setAgeRange(profile.ageRange ?? "");
    setPreferredLanguage(profile.preferredLanguage ?? "");
    setWhispererAvatarId(profile.whispererAvatarId ?? null);
    setInitialized(true);
  }

  const updateProfile = useUpdateUserProfile();

  const [appBadgeEnabled, setAppBadgeEnabled] = useAppBadgeEnabled();

  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [pushCheckDone, setPushCheckDone] = useState(false);
  const getPushPublicKey = useGetPushPublicKey({ query: { enabled: false, queryKey: getGetPushPublicKeyQueryKey() } });
  const createPushSubscription = useCreatePushSubscription();
  const deletePushSubscription = useDeletePushSubscription();

  useEffect(() => {
    if (!isPushSupported()) {
      setPushCheckDone(true);
      return;
    }
    getExistingPushSubscription()
      .then((sub) => setPushEnabled(!!sub))
      .finally(() => setPushCheckDone(true));
  }, []);

  // There's no dedicated boolean field for "is Whisper Box on" anywhere the
  // frontend can read directly — the recap endpoint's whisperBoxMessagesReceived
  // is null unless the caller has whisperBoxEnabled (see UserRecap's own doc
  // comment), which is the signal this card uses instead. enableWhisperBox /
  // disableWhisperBox's own responses are written straight into the recap
  // query cache (setQueryData below) rather than a separate local override —
  // a local override would keep shadowing the query forever, including
  // after a handle change from somewhere else (e.g. WhisperBoxLinkDialog's
  // personalize step), leaving this card stuck showing a stale handle. This
  // way every consumer of the same recap query (Dashboard, Inbox, this
  // page) reads the same, always-current value.
  // Same refetchOnMount:"always" reasoning as the profile query above —
  // whisperBoxEnabled/whisperBoxHandle here gate the entire copy/share UI
  // and need to reflect live state every time this page is opened, not
  // whatever was cached from earlier in the session.
  const { data: recap, isLoading: recapLoading } = useGetUserRecap(undefined, {
    query: { refetchOnMount: "always", queryKey: getGetUserRecapQueryKey() },
  });
  const whisperBoxEnabled = recap ? recap.whisperBoxMessagesReceived !== null : false;
  const whisperBoxHandle = recap?.whisperBoxHandle ?? null;
  const enableWhisperBox = useEnableWhisperBox();
  const disableWhisperBox = useDisableWhisperBox();
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  // Gates the two quick share actions below — see WhisperBoxLinkDialog's
  // comment for why an un-personalized (random-word, or stale-name) handle
  // isn't worth sharing. Backend-computed (routes/user.ts) rather than a
  // local `!!fullName` check, so a display name change that hasn't been
  // captured into the handle yet still routes through the capture dialog —
  // `!!fullName` alone couldn't tell "never personalized" apart from
  // "personalized, then the name changed since".
  const handlePersonalized = profile?.whisperBoxHandlePersonalized ?? false;

  function handleWhisperBoxToggleSuccess(enabled: boolean, handle: string | null, requestedNameTaken = false) {
    // Write straight into the shared recap cache so the switch and share
    // link update instantly (no flash back to the old state while the
    // invalidated query refetches), and every other consumer of this same
    // query key sees it too.
    queryClient.setQueryData<UserRecap | undefined>(getGetUserRecapQueryKey(), (old) =>
      old
        ? { ...old, whisperBoxHandle: handle, whisperBoxMessagesReceived: enabled ? (old.whisperBoxMessagesReceived ?? 0) : null }
        : old,
    );
    queryClient.invalidateQueries({ queryKey: getGetUserRecapQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetUserProfileQueryKey() });
    toast(
      requestedNameTaken && handle
        ? { title: tWhisperBox("linkDialog.toastNameTaken", { handle }) }
        : { title: enabled ? tWhisperBox("settingsSection.toastEnabled") : tWhisperBox("settingsSection.toastDisabled") },
    );
  }

  function handleWhisperBoxToggleError() {
    toast({ title: tWhisperBox("settingsSection.toastToggleFailed"), variant: "destructive" });
  }

  function handleToggleWhisperBox(enabled: boolean) {
    if (enabled) {
      enableWhisperBox.mutate(undefined, {
        onSuccess: (result) => handleWhisperBoxToggleSuccess(true, result.handle, result.requestedNameTaken),
        onError: handleWhisperBoxToggleError,
      });
    } else {
      disableWhisperBox.mutate(undefined, {
        onSuccess: () => handleWhisperBoxToggleSuccess(false, whisperBoxHandle),
        onError: handleWhisperBoxToggleError,
      });
    }
  }

  function handleShareWhisperBoxLink() {
    if (!whisperBoxHandle) return;
    if (!handlePersonalized) {
      setLinkDialogOpen(true);
      return;
    }
    const url = whisperBoxShareUrl(whisperBoxHandle);
    if (navigator.share) {
      navigator.share({ title: tWhisperBox("settingsSection.shareTitle"), url }).catch(() => {});
      return;
    }
    navigator.clipboard
      .writeText(url)
      .then(() => toast({ title: tWhisperBox("settingsSection.toastLinkCopied") }))
      .catch(() => toast({ title: tWhisperBox("settingsSection.toastCopyFailed"), variant: "destructive" }));
  }

  const [storyShareLoading, setStoryShareLoading] = useState(false);

  // The branded, image-based counterpart to handleShareWhisperBoxLink above
  // — see src/lib/whisperBoxStoryCard.ts. Generates a Story-ratio PNG card
  // client-side and, where the platform supports it, hands it straight to
  // the native share sheet so Instagram/Snapchat/TikTok show up as targets,
  // rather than sharing a bare link.
  async function handleShareWhisperBoxStory() {
    if (!whisperBoxHandle || storyShareLoading) return;
    if (!handlePersonalized) {
      setLinkDialogOpen(true);
      return;
    }
    setStoryShareLoading(true);
    try {
      const url = whisperBoxShareUrl(whisperBoxHandle);
      const result = await shareWhisperBoxStoryCard({
        handle: whisperBoxHandle,
        url,
        promptText: tWhisperBox("settingsSection.storyPromptText"),
        dir: i18n.dir(),
        shareTitle: tWhisperBox("settingsSection.shareTitle"),
        shareText: tWhisperBox("settingsSection.storyShareText"),
      });
      if (result === "downloaded") {
        toast({ title: tWhisperBox("settingsSection.toastStoryDownloaded") });
      } else if (result === "shared-image") {
        toast({ title: tWhisperBox("settingsSection.toastStoryShared") });
      } else if (result === "unsupported") {
        toast({ title: tWhisperBox("settingsSection.toastStoryUnsupported"), variant: "destructive" });
      }
    } catch {
      toast({ title: tWhisperBox("settingsSection.toastStoryFailed"), variant: "destructive" });
    } finally {
      setStoryShareLoading(false);
    }
  }

  async function handleEnablePush() {
    setPushLoading(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        toast({ title: t("settingsPage.toastNotificationPermissionDenied"), variant: "destructive" });
        return;
      }
      const { publicKey } = await getPushPublicKey.refetch().then((r) => {
        if (!r.data) throw new Error("Missing VAPID key");
        return r.data;
      });
      const subscription = await subscribeToPush(publicKey);
      const { endpoint, keys } = pushSubscriptionToJson(subscription);
      await new Promise<void>((resolve, reject) => {
        createPushSubscription.mutate(
          { data: { endpoint, keys } },
          { onSuccess: () => resolve(), onError: () => reject() }
        );
      });
      setPushEnabled(true);
      toast({ title: t("settingsPage.toastPushEnabled") });
    } catch {
      toast({ title: t("settingsPage.toastPushEnableFailed"), variant: "destructive" });
    } finally {
      setPushLoading(false);
    }
  }

  async function handleDisablePush() {
    setPushLoading(true);
    try {
      const subscription = await getExistingPushSubscription();
      if (subscription) {
        const { endpoint } = pushSubscriptionToJson(subscription);
        await new Promise<void>((resolve) => {
          deletePushSubscription.mutate({ data: { endpoint } }, { onSettled: () => resolve() });
        });
        await subscription.unsubscribe();
      }
      setPushEnabled(false);
      toast({ title: t("settingsPage.toastPushDisabled") });
    } finally {
      setPushLoading(false);
    }
  }

  function handleToggleEmailNotifications(enabled: boolean) {
    updateProfile.mutate(
      { data: { emailNotificationsEnabled: enabled } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetUserProfileQueryKey() });
          toast({
            title: enabled
              ? t("settingsPage.toastEmailNotificationsOn")
              : t("settingsPage.toastEmailNotificationsOff"),
          });
        },
        onError: () => toast({ title: t("settingsPage.toastUpdateFailed"), variant: "destructive" }),
      }
    );
  }

  // Reciprocal by design (see docs/security-auth.md's "Online presence"
  // section) — the server-side toggle both hides this account from anyone
  // who follows it in Debate Now and stops it from seeing anyone else
  // online, so the description below says as much rather than only
  // describing the half that's about being seen.
  function handleToggleShowOnlineStatus(enabled: boolean) {
    updateProfile.mutate(
      { data: { showOnlineStatus: enabled } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetUserProfileQueryKey() });
          toast({
            title: enabled
              ? t("settingsPage.toastShowOnlineStatusOn")
              : t("settingsPage.toastShowOnlineStatusOff"),
          });
        },
        onError: () => toast({ title: t("settingsPage.toastUpdateFailed"), variant: "destructive" }),
      }
    );
  }

  // Admin-only preferences (Settings' "Admin notifications" card, gated on
  // profile.role === "admin") — whether THIS admin account gets alerted
  // when a new user signs up or a new Debate Now topic is posted. Separate
  // toggles on purpose, same reasoning as the email/online-status pair
  // above: one alert type being noisy shouldn't force turning off the
  // other too.
  function handleToggleAdminNewSignup(enabled: boolean) {
    updateProfile.mutate(
      { data: { notifyOnNewSignup: enabled } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetUserProfileQueryKey() });
          toast({
            title: enabled
              ? t("settingsPage.toastAdminNewSignupOn")
              : t("settingsPage.toastAdminNewSignupOff"),
          });
        },
        onError: () => toast({ title: t("settingsPage.toastUpdateFailed"), variant: "destructive" }),
      }
    );
  }

  function handleToggleAdminNewDebateTopic(enabled: boolean) {
    updateProfile.mutate(
      { data: { notifyOnNewDebateTopic: enabled } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetUserProfileQueryKey() });
          toast({
            title: enabled
              ? t("settingsPage.toastAdminNewDebateTopicOn")
              : t("settingsPage.toastAdminNewDebateTopicOff"),
          });
        },
        onError: () => toast({ title: t("settingsPage.toastUpdateFailed"), variant: "destructive" }),
      }
    );
  }

  function handleSave() {
    updateProfile.mutate(
      {
        data: {
          fullName: fullName || null,
          gender: gender || null,
          ageRange: ageRange || null,
          ...(preferredLanguage ? { preferredLanguage: preferredLanguage as any } : {}),
          whispererAvatarId,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetUserProfileQueryKey() });
          // Switches the rendered UI immediately, ahead of AppLayout's own
          // sync effect (which only fires once the invalidated query
          // refetches) — the whole point of picking a language here is
          // seeing it take effect right away, not on the next navigation.
          if (preferredLanguage) void i18n.changeLanguage(preferredLanguage);
          toast({ title: t("settingsPage.toastProfileUpdated") });
        },
        onError: () => toast({ title: t("settingsPage.toastProfileUpdateFailed"), variant: "destructive" }),
      }
    );
  }

  if (isLoading) {
    return (
      <AppLayout>
        <div className="max-w-xl mx-auto space-y-4">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-48 rounded-2xl" />
          <Skeleton className="h-32 rounded-2xl" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">{t("settingsPage.title")}</h1>
          <p className="text-muted-foreground mt-1">{t("settingsPage.subtitle")}</p>
        </div>

        {/* Profile + Debate Now identity — who you are, in this app and in
            Debate Now specifically. Grouped under one label so the settings
            list reads as a few labeled clusters instead of 8 identical
            unlabeled boxes in a row. */}
        <div className="space-y-4">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/60 px-1">
            {t("settingsPage.sectionGroupProfile")}
          </h2>

        <Card className="bg-card border-border/50">
          <CardHeader>
            <CardTitle className="text-base font-serif flex items-center gap-2">
              <User className="w-4 h-4 text-primary" /> {t("settingsPage.profileCardTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center gap-4">
              <Avatar className="w-16 h-16 border-2 border-primary/30 shrink-0">
                <AvatarImage src={profile?.avatarUrl ?? ""} />
                <AvatarFallback className="bg-primary/10 text-primary text-xl font-serif">
                  {profile?.fullName?.charAt(0) ?? profile?.email?.charAt(0) ?? "W"}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-foreground truncate">{profile?.fullName || t("settingsPage.noNameSet")}</p>
                <p className="text-sm text-muted-foreground truncate">{profile?.email}</p>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-muted-foreground" htmlFor="full-name">{t("settingsPage.displayName")}</Label>
              <Input
                id="full-name"
                className="bg-input/50 border-border/50 rounded-xl"
                placeholder={t("settingsPage.namePlaceholder")}
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                data-testid="input-full-name"
              />
              <p className="text-xs text-muted-foreground" data-testid="text-display-name-handle-hint">
                {t("settingsPage.displayNameHandleHint")}
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-muted-foreground">{t("settingsPage.language")}</Label>
              <Select value={preferredLanguage} onValueChange={setPreferredLanguage}>
                <SelectTrigger className="bg-input/50 border-border/50 rounded-xl" data-testid="select-settings-language">
                  <SelectValue placeholder={t("settingsPage.notSet")} />
                </SelectTrigger>
                <SelectContent>
                  {SUPPORTED_LANGUAGES.map((code) => (
                    <SelectItem key={code} value={code}>{LANGUAGE_LABELS[code]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-muted-foreground">{t("settingsPage.gender")}</Label>
                <Select value={gender} onValueChange={setGender}>
                  <SelectTrigger className="bg-input/50 border-border/50 rounded-xl" data-testid="select-settings-gender">
                    <SelectValue placeholder={t("settingsPage.notSet")} />
                  </SelectTrigger>
                  <SelectContent>
                    {GENDER_OPTIONS.map((g) => (
                      <SelectItem key={g} value={g}>{tDemographics(`gender.${g}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground">{t("settingsPage.ageRange")}</Label>
                <Select value={ageRange} onValueChange={setAgeRange}>
                  <SelectTrigger className="bg-input/50 border-border/50 rounded-xl" data-testid="select-settings-age-range">
                    <SelectValue placeholder={t("settingsPage.notSet")} />
                  </SelectTrigger>
                  <SelectContent>
                    {AGE_RANGE_OPTIONS.map((a) => (
                      <SelectItem key={a} value={a}>{tDemographics(`ageRange.${a}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Button
              onClick={handleSave}
              disabled={updateProfile.isPending}
              className="rounded-full"
              data-testid="button-save-profile"
            >
              {updateProfile.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {t("settingsPage.saveChanges")}
            </Button>
          </CardContent>
        </Card>

        {/* Debate Topics identity — the persistent, cross-topic Whisperer
            handle/avatar shown as the byline on every topic and comment this
            account posts while signed in (see DebateTopicComment.handle's
            schema comment). The handle itself is assigned automatically
            (posting a topic, or commenting while signed in) — only the
            avatar is editable here. */}
        <Card className="bg-card border-border/50">
          <CardHeader>
            <CardTitle className="text-base font-serif flex items-center gap-2">
              <Swords className="w-4 h-4 text-primary" /> {t("settingsPage.debateIdentityCardTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <AvatarCircle
                avatarId={whispererAvatarId}
                handle={profile?.whispererHandle || profile?.email || "W"}
                size="lg"
              />
              <div className="min-w-0">
                <p className="font-medium text-foreground truncate">{profile?.whispererHandle || t("settingsPage.handleNotAssigned")}</p>
                <p className="text-xs text-muted-foreground">
                  {profile?.whispererHandle
                    ? t("settingsPage.handleDescriptionAssigned")
                    : t("settingsPage.handleDescriptionUnassigned")}
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-muted-foreground">{t("settingsPage.avatar")}</Label>
              <AvatarPickerGrid
                value={whispererAvatarId}
                handle={profile?.whispererHandle || profile?.email || "W"}
                onSelect={setWhispererAvatarId}
              />
            </div>
            <Button
              onClick={handleSave}
              disabled={updateProfile.isPending}
              className="rounded-full"
              data-testid="button-save-avatar"
            >
              {updateProfile.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              {t("settingsPage.saveChanges")}
            </Button>
          </CardContent>
        </Card>
        </div>

        {/* Account, Security, Phone number — the account's identity and
            access surfaces, grouped separately from the profile-presentation
            cards above. */}
        <div className="space-y-4">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/60 px-1">
            {t("settingsPage.sectionGroupAccountSecurity")}
          </h2>

        {/* Account info */}
        <Card className="bg-card border-border/50">
          <CardHeader>
            <CardTitle className="text-base font-serif flex items-center gap-2">
              <Mail className="w-4 h-4 text-primary" /> {t("settingsPage.accountCardTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between gap-3 py-2">
              <span className="text-sm text-muted-foreground shrink-0">{t("settingsPage.email")}</span>
              <span className="text-sm text-foreground truncate min-w-0 text-right">{profile?.email}</span>
            </div>
            <div className="flex items-center justify-between gap-3 py-2">
              <span className="text-sm text-muted-foreground shrink-0">{t("settingsPage.plan")}</span>
              <span className="text-sm text-foreground capitalize truncate min-w-0 text-right">{profile?.plan}</span>
            </div>
            <div className="flex items-center justify-between gap-3 py-2">
              <span className="text-sm text-muted-foreground shrink-0">{t("settingsPage.whisperLinksUsed")}</span>
              <span className="text-sm text-foreground truncate min-w-0 text-right">
                {profile?.whisperLinksUsed}
                {profile?.plan && WHISPER_LINK_LIMITS[profile.plan] != null
                  ? t("settingsPage.whisperLinkLimit", { limit: WHISPER_LINK_LIMITS[profile.plan] })
                  : t("settingsPage.unlimited")}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 py-2">
              <span className="text-sm text-muted-foreground shrink-0">{t("settingsPage.ghostBoostCredits")}</span>
              <span className="text-sm text-foreground truncate min-w-0 text-right">{profile?.boostCredits}</span>
            </div>
            <div className="flex items-center justify-between gap-3 py-2">
              <span className="text-sm text-muted-foreground shrink-0">{t("settingsPage.memberSince")}</span>
              <span className="text-sm text-foreground truncate min-w-0 text-right">{profile?.createdAt ? new Date(profile.createdAt).toLocaleDateString() : "—"}</span>
            </div>
          </CardContent>
        </Card>

        {/* Security — always visible regardless of whether the MFA nudge on
            Dashboard has been dismissed, so an account can always see
            (and act on) its 2FA status here even after skipping the nudge
            for good. */}
        <Card className="bg-card border-border/50">
          <CardHeader>
            <CardTitle className="text-base font-serif flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-primary" /> {t("settingsPage.securityCardTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-foreground">{t("settingsPage.twoFactorAuth")}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {!clerkLoaded
                    ? t("settingsPage.checkingStatus")
                    : user?.twoFactorEnabled
                      ? t("settingsPage.twoFactorEnabled")
                      : t("settingsPage.twoFactorNotSetUp")}
                </p>
              </div>
              <Link href="/account/security">
                <Button variant="outline" size="sm" className="rounded-full shrink-0" data-testid="button-manage-mfa">
                  {user?.twoFactorEnabled ? t("settingsPage.manage") : t("settingsPage.setUp")}
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Phone verification — anyone who skipped/dismissed the onboarding
            dialog (PhoneVerificationDialog, shown on first Dashboard visit)
            can still do this later. Same real, one-time Twilio Verify SMS
            code flow either way (PhoneVerificationFlow). Once verified,
            SMS/WhatsApp whisps sent to this number deliver in-app instead
            of costing a real Twilio send (see api-server's lib/deliver.ts). */}
        <Card className="bg-card border-border/50">
          <CardHeader>
            <CardTitle className="text-base font-serif flex items-center gap-2">
              <Phone className="w-4 h-4 text-primary" /> {t("settingsPage.phoneNumberCardTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {profile?.phoneVerifiedAt ? (
              <div className="flex items-center gap-2 text-sm text-foreground" data-testid="text-phone-verified">
                <ShieldCheck className="w-4 h-4 text-primary shrink-0" />
                <span>{t("settingsPage.phoneVerified", { phone: profile.phone })}</span>
              </div>
            ) : (
              <PhoneVerificationFlow />
            )}
          </CardContent>
        </Card>
        </div>

        {/* Notifications, Whisper Box, Privacy — how the app reaches you and
            what it does with your data, grouped last since these are the
            "set it and forget it" preferences rather than identity/security. */}
        <div className="space-y-4">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/60 px-1">
            {t("settingsPage.sectionGroupPreferences")}
          </h2>

        {/* Notifications */}
        <Card className="bg-card border-border/50">
          <CardHeader>
            <CardTitle className="text-base font-serif flex items-center gap-2">
              <Bell className="w-4 h-4 text-primary" /> {t("settingsPage.notificationsCardTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {isPushSupported() && (
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-foreground">{t("settingsPage.pushNotifications")}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t("settingsPage.pushNotificationsDescription")}
                  </p>
                </div>
                <Button
                  variant={pushEnabled ? "outline" : "default"}
                  size="sm"
                  className="rounded-full shrink-0"
                  disabled={!pushCheckDone || pushLoading}
                  onClick={pushEnabled ? handleDisablePush : handleEnablePush}
                  data-testid="button-toggle-push"
                >
                  {pushLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
                  {pushEnabled ? t("settingsPage.disable") : t("settingsPage.enable")}
                </Button>
              </div>
            )}
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-foreground">{t("settingsPage.emailNotifications")}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t("settingsPage.emailNotificationsDescription")}
                </p>
              </div>
              <Switch
                checked={profile?.emailNotificationsEnabled ?? true}
                onCheckedChange={handleToggleEmailNotifications}
                disabled={updateProfile.isPending}
                data-testid="switch-email-notifications"
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-foreground">{t("settingsPage.showOnlineStatus")}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t("settingsPage.showOnlineStatusDescription")}
                </p>
              </div>
              <Switch
                checked={profile?.showOnlineStatus ?? true}
                onCheckedChange={handleToggleShowOnlineStatus}
                disabled={updateProfile.isPending}
                data-testid="switch-show-online-status"
              />
            </div>
            {isAppBadgeSupported() && (
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-foreground">{t("settingsPage.appBadge")}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t("settingsPage.appBadgeDescription")}
                  </p>
                </div>
                <Switch
                  checked={appBadgeEnabled}
                  onCheckedChange={setAppBadgeEnabled}
                  data-testid="switch-app-badge"
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Admin notifications — only rendered for an admin account (owner
            or collaborator; see adminAuth.ts). Two independent toggles, not
            one "admin alerts" switch, matching the ask that either can be
            turned off without silencing the other. Backend delivery is the
            same in-app bell + best-effort push every other notification
            uses (lib/adminNotify.ts) — an admin sees these exactly where
            they'd see any other notification, since an admin is still just
            a user underneath. */}
        {profile?.role === "admin" && (
          <Card className="bg-card border-border/50">
            <CardHeader>
              <CardTitle className="text-base font-serif flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-primary" /> {t("settingsPage.adminNotificationsCardTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-start gap-2.5">
                  <UserPlus className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-foreground">{t("settingsPage.adminNewSignupLabel")}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{t("settingsPage.adminNewSignupDescription")}</p>
                  </div>
                </div>
                <Switch
                  checked={profile?.notifyOnNewSignup ?? true}
                  onCheckedChange={handleToggleAdminNewSignup}
                  disabled={updateProfile.isPending}
                  data-testid="switch-admin-notify-new-signup"
                />
              </div>
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-start gap-2.5">
                  <MessageSquareText className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-foreground">{t("settingsPage.adminNewDebateTopicLabel")}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{t("settingsPage.adminNewDebateTopicDescription")}</p>
                  </div>
                </div>
                <Switch
                  checked={profile?.notifyOnNewDebateTopic ?? true}
                  onCheckedChange={handleToggleAdminNewDebateTopic}
                  disabled={updateProfile.isPending}
                  data-testid="switch-admin-notify-new-debate-topic"
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Whisper Box — the app's one deliberately anonymous-SENDER
            surface: opting in gets a public link anyone (no account needed)
            can use to send one anonymous message. See
            docs/features-community.md's "Whisper Box" section. */}
        <Card className="bg-card border-border/50">
          <CardHeader>
            <CardTitle className="text-base font-serif flex items-center gap-2">
              <Mailbox className="w-4 h-4 text-primary" /> {tWhisperBox("settingsSection.cardTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {recapLoading ? (
              <Skeleton className="h-10 rounded-xl" />
            ) : (
              <>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-foreground">{tWhisperBox("settingsSection.toggleLabel")}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {whisperBoxEnabled
                        ? tWhisperBox("settingsSection.enabledDescription")
                        : tWhisperBox("settingsSection.disabledDescription")}
                    </p>
                  </div>
                  <Switch
                    checked={whisperBoxEnabled}
                    onCheckedChange={handleToggleWhisperBox}
                    disabled={enableWhisperBox.isPending || disableWhisperBox.isPending}
                    data-testid="switch-whisper-box-enabled"
                  />
                </div>
                {whisperBoxEnabled && whisperBoxHandle && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 p-3 rounded-xl bg-muted/30 border border-border/40">
                      <Input
                        readOnly
                        value={whisperBoxShareUrl(whisperBoxHandle)}
                        onFocus={(e) => e.currentTarget.select()}
                        className="text-xs bg-transparent border-none px-0 h-auto flex-1 truncate focus-visible:ring-0"
                        data-testid="input-whisper-box-link"
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="rounded-full shrink-0"
                        onClick={handleShareWhisperBoxLink}
                        data-testid="button-share-whisper-box-link"
                      >
                        <Share2 className="w-3.5 h-3.5 mr-1.5" /> {tWhisperBox("settingsSection.shareButton")}
                      </Button>
                    </div>
                    {/* The branded, image-based share option — visually
                        distinct (filled, gradient ring echoing an
                        Instagram/Snapchat/TikTok Story ring) from the plain
                        outline copy-link button above, since this one
                        produces a whole PNG card rather than a bare URL. */}
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleShareWhisperBoxStory}
                      disabled={storyShareLoading}
                      className="w-full rounded-full text-white shadow-sm"
                      style={{
                        background:
                          "linear-gradient(90deg, hsl(var(--primary)) 0%, hsl(var(--secondary)) 55%, hsl(var(--gilded)) 100%)",
                      }}
                      data-testid="button-share-whisper-box-story"
                    >
                      {storyShareLoading ? (
                        <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                      ) : (
                        <Image className="w-3.5 h-3.5 mr-1.5" />
                      )}
                      {tWhisperBox("settingsSection.shareStoryButton")}
                    </Button>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Privacy */}
        <Card className="bg-card border-border/50">
          <CardHeader>
            <CardTitle className="text-base font-serif flex items-center gap-2">
              <Shield className="w-4 h-4 text-primary" /> {t("settingsPage.privacyCardTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>{t("settingsPage.privacyWhispsText")}</p>
            <p>{t("settingsPage.privacyGhostBoostText")}</p>
            <p>{t("settingsPage.privacyDataRequestText")}</p>
            <p className="flex items-center gap-3 pt-1">
              <Link href="/privacy" className="text-primary hover:underline">{t("settingsPage.privacyPolicyLink")}</Link>
              <span className="text-border">•</span>
              <Link href="/terms" className="text-primary hover:underline">{t("settingsPage.termsOfServiceLink")}</Link>
            </p>
          </CardContent>
        </Card>
        </div>
      </div>

      {whisperBoxHandle && (
        <WhisperBoxLinkDialog
          handle={whisperBoxHandle}
          handlePersonalized={handlePersonalized}
          currentDisplayName={profile?.fullName ?? null}
          open={linkDialogOpen}
          onOpenChange={setLinkDialogOpen}
        />
      )}
    </AppLayout>
  );
}
