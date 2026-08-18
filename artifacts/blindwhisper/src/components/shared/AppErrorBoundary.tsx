import { Component, type ReactNode } from "react";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";

// Every non-critical page is React.lazy()-loaded (see App.tsx), which means
// its JS chunk is fetched over the network the first time a route is
// visited, not bundled up front. If that fetch 404s — the single most common
// cause: this tab has an old build's index.html/JS still in memory, and a
// deploy since then deleted the old chunk files Vite content-hashes on every
// build — the dynamic import() throws synchronously during render. With no
// boundary anywhere in the tree, React unmounts everything down to the root
// and the app goes fully blank, which is exactly the "goes blank, I have to
// close and reopen" bug this fixes. lib/appUpdate.ts's watchForUpdates
// prevents most of these proactively (reloading a stale tab before it ever
// hits this), but it can't cover every timing window — a chunk fetched in
// the same instant a new deploy's old files get removed, for one — so this
// is the last-resort net: catch it, and self-heal with a real reload instead
// of leaving a blank screen for someone to puzzle over.
const CHUNK_ERROR_PATTERN =
  /failed to fetch dynamically imported module|loading chunk .* failed|error loading dynamically imported module|importing a module script failed/i;

function isChunkLoadError(error: unknown): boolean {
  return error instanceof Error && CHUNK_ERROR_PATTERN.test(error.message);
}

// Guards the auto-reload against a genuine crash loop: if reloading doesn't
// actually fix it (a real bug, not a stale chunk), retrying on every render
// would spin the tab forever instead of ever showing the fallback UI below.
const RELOAD_GUARD_KEY = "blindwhisper:errorBoundaryReloadedAt";
const RELOAD_GUARD_WINDOW_MS = 10_000;

function shouldAutoReload(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) ?? 0);
    return Date.now() - last > RELOAD_GUARD_WINDOW_MS;
  } catch {
    // No sessionStorage (private mode, locked-down profile) — can't tell if
    // this already just retried, so don't risk a loop.
    return false;
  }
}

function markReloaded(): void {
  try {
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
  } catch {
    // Nothing to do — worst case the guard below doesn't fire and this falls
    // through to the manual-reload fallback UI instead, which is still safe.
  }
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: unknown): { error: Error } {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: Error): void {
    if (isChunkLoadError(error) && shouldAutoReload()) {
      markReloaded();
      window.location.reload();
    }
  }

  render() {
    if (!this.state.error) return this.props.children;

    // A chunk-load error either just triggered the auto-reload above (this
    // renders for the brief instant before that lands) or already used up
    // its one auto-retry this session — either way, the same manual fallback
    // covers it, along with any other render error this boundary catches.
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <Logo className="h-10 w-auto text-primary" aria-hidden />
        <p className="font-serif text-lg text-foreground">Something went wrong loading this page.</p>
        <p className="text-sm text-muted-foreground max-w-xs">
          This usually clears up with a reload — often because a new version just went live.
        </p>
        <Button onClick={() => window.location.reload()} className="rounded-full" data-testid="button-error-reload">
          Reload
        </Button>
      </div>
    );
  }
}
