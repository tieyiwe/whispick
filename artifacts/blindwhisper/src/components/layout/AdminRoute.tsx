import { Redirect } from "wouter";
import { useGetUserProfile } from "@workspace/api-client-react";
import { Loader2 } from "lucide-react";

export function AdminRoute({ component: Component }: { component: React.ComponentType }) {
  const { data: profile, isLoading } = useGetUserProfile();

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
      </div>
    );
  }

  if (profile?.role !== "admin") {
    return <Redirect to="/dashboard" />;
  }

  return <Component />;
}
