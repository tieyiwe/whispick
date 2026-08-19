import { useState } from "react";
import { useSubscribeToMatching } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { LogoLockup } from "@/components/ui/logo";
import { Loader2, MailCheck, Sparkles } from "lucide-react";
import { VIDEO_CATEGORY_LABELS } from "@/lib/videoCategories";

const SUBSCRIBE_CATEGORIES = Object.entries(VIDEO_CATEGORY_LABELS).filter(([key]) => key !== "uncategorized");
const MAX_CATEGORIES = 8;

export function SubscribePage() {
  const [email, setEmail] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const subscribe = useSubscribeToMatching();

  function toggleCategory(key: string) {
    setCategories((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : prev.length >= MAX_CATEGORIES ? prev : [...prev, key]
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim()) {
      setError("Enter an email address");
      return;
    }
    if (categories.length === 0) {
      setError("Pick at least one topic");
      return;
    }
    subscribe.mutate(
      { data: { email: email.trim(), categories } },
      { onError: () => setError("Something went wrong. Double check your email and try again.") }
    );
  }

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col relative overflow-hidden">
      <div className="absolute top-[-15%] left-[-15%] w-[70%] h-[45%] rounded-full blur-[110px] pointer-events-none bg-primary/15" />
      <div className="absolute bottom-[-10%] right-[-15%] w-[55%] h-[35%] rounded-full blur-[100px] pointer-events-none bg-secondary/10" />

      <header
        className="px-5 pb-5 flex items-center justify-between border-b border-border/30 relative z-10"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 1.25rem)" }}
      >
        <LogoLockup />
        <a href="/sign-up" className="text-xs text-muted-foreground hover:text-primary transition-colors py-2">
          Become a Whisperer
        </a>
      </header>

      <main className="flex-1 max-w-lg mx-auto w-full px-5 py-10 space-y-6 relative z-10">
        {subscribe.isSuccess ? (
          <div className="rounded-2xl bg-card border border-border/50 p-8 text-center space-y-3" data-testid="subscribe-success">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
              <MailCheck className="w-6 h-6 text-primary" />
            </div>
            <p className="font-medium text-foreground">
              {subscribe.data?.alreadyVerified ? "You're all set" : "Almost done — check your inbox"}
            </p>
            <p className="text-sm text-muted-foreground">
              {subscribe.data?.alreadyVerified
                ? "Your topics are updated. Anonymous whisps matching them may land in your inbox anytime."
                : "Click the confirmation link we just emailed you to start receiving matches. It's the only way we know a real person owns this address."}
            </p>
          </div>
        ) : (
          <>
            <div className="text-center space-y-2">
              <div className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
                <Sparkles className="w-5 h-5 text-primary" />
              </div>
              <h1 className="text-xl font-serif font-semibold text-foreground">Get matched with anonymous whisps</h1>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Strangers on Blind Whisper send videos anonymously to people who might need them. Pick a few topics and
                we'll occasionally send you one that matches — no account needed, unsubscribe anytime.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="subscribe-email">
                  Email address
                </label>
                <Input
                  id="subscribe-email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="bg-input/50 border-border/50 rounded-xl"
                  data-testid="input-subscribe-email"
                />
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  Topics you'd want to hear about ({categories.length}/{MAX_CATEGORIES})
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {SUBSCRIBE_CATEGORIES.map(([key, label]) => (
                    <label
                      key={key}
                      className="flex items-center gap-2 p-2.5 rounded-xl border border-border/50 bg-card hover:border-primary/40 transition-colors cursor-pointer"
                    >
                      <Checkbox
                        checked={categories.includes(key)}
                        onCheckedChange={() => toggleCategory(key)}
                        data-testid={`checkbox-category-${key}`}
                      />
                      <span className="text-sm text-foreground">{label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <Button
                type="submit"
                className="w-full rounded-full"
                disabled={subscribe.isPending}
                data-testid="button-subscribe"
              >
                {subscribe.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Sign me up
              </Button>

              <p className="text-xs text-muted-foreground text-center">
                We'll only ever email you a whisp that matches your topics, or a one-click unsubscribe link. No spam,
                no selling your email.
              </p>
            </form>
          </>
        )}
      </main>
    </div>
  );
}
