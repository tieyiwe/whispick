import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useUser } from "@clerk/react";
import {
  useGetUserProfile,
  useUpdateUserProfile,
  useGetPushPublicKey,
  useCreatePushSubscription,
  useDeletePushSubscription,
  getGetUserProfileQueryKey,
  getGetPushPublicKeyQueryKey,
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
import { Loader2, User, Mail, Shield, Bell, Phone, ShieldCheck, Swords } from "lucide-react";
import { isPushSupported, getExistingPushSubscription, subscribeToPush, pushSubscriptionToJson } from "@/lib/push";
import { GENDER_OPTIONS, AGE_RANGE_OPTIONS } from "@/lib/demographics";
import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGUAGES, LANGUAGE_LABELS } from "@/lib/languages";
import i18n from "@/i18n";
import { PhoneVerificationFlow } from "@/components/shared/PhoneVerificationFlow";
import { AvatarCircle } from "@/components/shared/AvatarCircle";
import { AvatarPickerGrid } from "@/components/shared/AvatarPickerGrid";

const WHISPER_LINK_LIMITS: Record<string, number | null> = {
  free: 3,
  spark: null,
  ember: null,
};

export function SettingsPage() {
  const { data: profile, isLoading } = useGetUserProfile();
  const { isLoaded: clerkLoaded, user } = useUser();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation("account");
  const { t: tDemographics } = useTranslation("demographics");
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
      <div className="max-w-xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">{t("settingsPage.title")}</h1>
          <p className="text-muted-foreground mt-1">{t("settingsPage.subtitle")}</p>
        </div>

        {/* Profile */}
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
    </AppLayout>
  );
}
