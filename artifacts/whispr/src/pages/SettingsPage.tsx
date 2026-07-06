import { useState } from "react";
import { useGetUserProfile, useUpdateUserProfile, getGetUserProfileQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { Loader2, User, Mail, Shield } from "lucide-react";

export function SettingsPage() {
  const { data: profile, isLoading } = useGetUserProfile();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [fullName, setFullName] = useState("");
  const [initialized, setInitialized] = useState(false);

  if (profile && !initialized) {
    setFullName(profile.fullName ?? "");
    setInitialized(true);
  }

  const updateProfile = useUpdateUserProfile();

  function handleSave() {
    updateProfile.mutate(
      { data: { fullName: fullName || null } },
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
              <Avatar className="w-16 h-16 border-2 border-primary/30">
                <AvatarImage src={profile?.avatarUrl ?? ""} />
                <AvatarFallback className="bg-primary/10 text-primary text-xl font-serif">
                  {profile?.fullName?.charAt(0) ?? profile?.email?.charAt(0) ?? "W"}
                </AvatarFallback>
              </Avatar>
              <div>
                <p className="font-medium text-foreground">{profile?.fullName || "No name set"}</p>
                <p className="text-sm text-muted-foreground">{profile?.email}</p>
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
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-muted-foreground">Email</span>
              <span className="text-sm text-foreground">{profile?.email}</span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-muted-foreground">Plan</span>
              <span className="text-sm text-foreground capitalize">{profile?.plan}</span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-muted-foreground">Whisper Links Used</span>
              <span className="text-sm text-foreground">{profile?.whisperLinksUsed} / 3 this month</span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-muted-foreground">Ghost Boost Credits</span>
              <span className="text-sm text-foreground">{profile?.boostCredits}</span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-sm text-muted-foreground">Member since</span>
              <span className="text-sm text-foreground">{profile?.createdAt ? new Date(profile.createdAt).toLocaleDateString() : "—"}</span>
            </div>
          </CardContent>
        </Card>

        {/* Privacy */}
        <Card className="bg-card border-border/50">
          <CardHeader>
            <CardTitle className="text-base font-serif flex items-center gap-2">
              <Shield className="w-4 h-4 text-primary" /> Privacy
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>All whisps are sent anonymously by default. Recipient contact information (email/phone) is used solely for delivery and is never shared with third parties.</p>
            <p>For Ghost Boosts, contact info is hashed with SHA-256 before being used to build a custom audience — it is never stored in plaintext.</p>
            <p>You can request a full data export or account deletion by contacting support.</p>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
