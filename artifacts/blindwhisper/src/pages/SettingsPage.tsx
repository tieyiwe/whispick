import { useEffect, useState } from "react";
import { Link } from "wouter";
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
import { useToast } from "@/hooks/use-toast";
import { Loader2, User, Mail, Shield, Bell } from "lucide-react";
import { isPushSupported, getExistingPushSubscription, subscribeToPush, pushSubscriptionToJson } from "@/lib/push";
import { GENDER_OPTIONS, GENDER_LABELS, AGE_RANGE_OPTIONS, AGE_RANGE_LABELS } from "@/lib/demographics";

const WHISPER_LINK_LIMITS: Record<string, number | null> = {
  free: 3,
  spark: null,
  ember: null,
};

export function SettingsPage() {
  const { data: profile, isLoading } = useGetUserProfile();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [fullName, setFullName] = useState("");
  const [gender, setGender] = useState("");
  const [ageRange, setAgeRange] = useState("");
  const [initialized, setInitialized] = useState(false);

  if (profile && !initialized) {
    setFullName(profile.fullName ?? "");
    setGender(profile.gender ?? "");
    setAgeRange(profile.ageRange ?? "");
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
        toast({ title: "Notification permission denied", variant: "destructive" });
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
      toast({ title: "Push notifications enabled" });
    } catch {
      toast({ title: "Couldn't enable push notifications", variant: "destructive" });
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
      toast({ title: "Push notifications disabled" });
    } finally {
      setPushLoading(false);
    }
  }

  function handleSave() {
    updateProfile.mutate(
      { data: { fullName: fullName || null, gender: gender || null, ageRange: ageRange || null } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetUserProfileQueryKey() });
          toast({ title: "Profile updated" });
        },
        onError: () => toast({ title: "Failed to update profile", variant: "destructive" }),
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
          <h1 className="text-3xl font-serif font-bold text-foreground">Settings</h1>
          <p className="text-muted-foreground mt-1">Manage your account and preferences.</p>
        </div>

        {/* Profile */}
        <Card className="bg-card border-border/50">
          <CardHeader>
            <CardTitle className="text-base font-serif flex items-center gap-2">
              <User className="w-4 h-4 text-primary" /> Profile
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
                <p className="font-medium text-foreground truncate">{profile?.fullName || "No name set"}</p>
                <p className="text-sm text-muted-foreground truncate">{profile?.email}</p>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-muted-foreground" htmlFor="full-name">Display Name</Label>
              <Input
                id="full-name"
                className="bg-input/50 border-border/50 rounded-xl"
                placeholder="Your name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                data-testid="input-full-name"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-muted-foreground">Gender</Label>
                <Select value={gender} onValueChange={setGender}>
                  <SelectTrigger className="bg-input/50 border-border/50 rounded-xl" data-testid="select-settings-gender">
                    <SelectValue placeholder="Not set" />
                  </SelectTrigger>
                  <SelectContent>
                    {GENDER_OPTIONS.map((g) => (
                      <SelectItem key={g} value={g}>{GENDER_LABELS[g]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-muted-foreground">Age range</Label>
                <Select value={ageRange} onValueChange={setAgeRange}>
                  <SelectTrigger className="bg-input/50 border-border/50 rounded-xl" data-testid="select-settings-age-range">
                    <SelectValue placeholder="Not set" />
                  </SelectTrigger>
                  <SelectContent>
                    {AGE_RANGE_OPTIONS.map((a) => (
                      <SelectItem key={a} value={a}>{AGE_RANGE_LABELS[a]}</SelectItem>
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
              Save Changes
            </Button>
          </CardContent>
        </Card>

        {/* Account info */}
        <Card className="bg-card border-border/50">
          <CardHeader>
            <CardTitle className="text-base font-serif flex items-center gap-2">
              <Mail className="w-4 h-4 text-primary" /> Account
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between gap-3 py-2">
              <span className="text-sm text-muted-foreground shrink-0">Email</span>
              <span className="text-sm text-foreground truncate min-w-0 text-right">{profile?.email}</span>
            </div>
            <div className="flex items-center justify-between gap-3 py-2">
              <span className="text-sm text-muted-foreground shrink-0">Plan</span>
              <span className="text-sm text-foreground capitalize truncate min-w-0 text-right">{profile?.plan}</span>
            </div>
            <div className="flex items-center justify-between gap-3 py-2">
              <span className="text-sm text-muted-foreground shrink-0">Whisper Links Used</span>
              <span className="text-sm text-foreground truncate min-w-0 text-right">
                {profile?.whisperLinksUsed}
                {profile?.plan && WHISPER_LINK_LIMITS[profile.plan] != null ? ` / ${WHISPER_LINK_LIMITS[profile.plan]} this month` : " (unlimited)"}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 py-2">
              <span className="text-sm text-muted-foreground shrink-0">Ghost Boost Credits</span>
              <span className="text-sm text-foreground truncate min-w-0 text-right">{profile?.boostCredits}</span>
            </div>
            <div className="flex items-center justify-between gap-3 py-2">
              <span className="text-sm text-muted-foreground shrink-0">Member since</span>
              <span className="text-sm text-foreground truncate min-w-0 text-right">{profile?.createdAt ? new Date(profile.createdAt).toLocaleDateString() : "—"}</span>
            </div>
          </CardContent>
        </Card>

        {/* Push notifications */}
        {isPushSupported() && (
          <Card className="bg-card border-border/50">
            <CardHeader>
              <CardTitle className="text-base font-serif flex items-center gap-2">
                <Bell className="w-4 h-4 text-primary" /> Notifications
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-foreground">Push notifications</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Get notified the moment a whisp is opened, watched, or replied to.
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
                  {pushEnabled ? "Disable" : "Enable"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Privacy */}
        <Card className="bg-card border-border/50">
          <CardHeader>
            <CardTitle className="text-base font-serif flex items-center gap-2">
              <Shield className="w-4 h-4 text-primary" /> Privacy
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>All whisps are sent anonymously by default. Recipient contact information (email/phone) is used solely for delivery and is never shared with third parties.</p>
            <p>Ghost Boost doesn't collect recipient contact info — it's a queued, boosted-reach send with no specific recipient, not a targeted ad.</p>
            <p>You can request a full data export or account deletion by contacting support.</p>
            <p className="flex items-center gap-3 pt-1">
              <Link href="/privacy" className="text-primary hover:underline">Privacy Policy</Link>
              <span className="text-border">•</span>
              <Link href="/terms" className="text-primary hover:underline">Terms of Service</Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
