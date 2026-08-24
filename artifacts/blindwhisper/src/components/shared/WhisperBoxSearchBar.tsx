import { useState } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search } from "lucide-react";

// A handle can be typed with or without a leading "@" — normalize before
// navigating so both work the same way a real @-mention search would.
function normalizeHandle(raw: string): string {
  return raw.trim().replace(/^@/, "");
}

// Lets someone jump straight to a friend's Whisper Box by typing their
// handle, instead of needing the exact shared link. No lookup call here —
// it navigates straight to /whisper-box/:handle and lets that page's own
// fetch (GET /public/whisper-box/:handle) resolve it, reusing the same
// "identical 404 whether unknown or disabled" handling that page already
// has rather than duplicating a pre-check.
export function WhisperBoxSearchBar({ className }: { className?: string }) {
  const { t } = useTranslation("whisperBox");
  const [, setLocation] = useLocation();
  const [query, setQuery] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const handle = normalizeHandle(query);
    if (!handle) return;
    setLocation(`/whisper-box/${encodeURIComponent(handle)}`);
  }

  return (
    <form onSubmit={handleSubmit} className={`flex gap-2 ${className ?? ""}`} data-testid="form-whisper-box-search">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("searchBar.placeholder")}
          className="bg-input/50 border-border/50 rounded-full pl-9"
          data-testid="input-whisper-box-search"
        />
      </div>
      <Button type="submit" variant="outline" className="rounded-full shrink-0" disabled={!query.trim()} data-testid="button-whisper-box-search">
        {t("searchBar.button")}
      </Button>
    </form>
  );
}
