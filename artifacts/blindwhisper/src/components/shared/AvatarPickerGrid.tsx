import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { AVATAR_IDS, avatarIcon, avatarBgClass, type AvatarId } from "@/lib/avatars";

// The whole preset library plus an explicit "no avatar" tile — no upload
// control anywhere in here, deliberately (see lib/avatars.ts). Used both by
// the per-thread anonymous identity (DebateTopicDetail.tsx) and the
// signed-in account-level Whisperer identity (SettingsPage.tsx).
export function AvatarPickerGrid({
  value,
  handle,
  onSelect,
}: {
  // Accepts a plain string here (not just AvatarId) because callers pass
  // through server-sourced values (comment.avatarId, profile.whispererAvatarId
  // etc.), which are typed as the wire-level `string | null`, not this
  // frontend catalog's narrower literal union.
  value: string | null;
  handle: string;
  onSelect: (avatarId: AvatarId | null) => void;
}) {
  const { t } = useTranslation("sharedA");

  return (
    <div className="grid grid-cols-5 gap-2.5" role="listbox" aria-label={t("avatarPickerGrid.chooseAvatar")}>
      <button
        type="button"
        onClick={() => onSelect(null)}
        aria-pressed={value === null}
        aria-label={t("avatarPickerGrid.noAvatar")}
        className={cn(
          "relative w-11 h-11 rounded-full flex items-center justify-center bg-muted text-muted-foreground font-serif font-bold text-base border-2 transition-colors",
          value === null ? "border-primary" : "border-transparent hover:border-border",
        )}
        data-testid="avatar-option-none"
      >
        {handle.charAt(0).toUpperCase() || "?"}
        {value === null && (
          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
            <Check className="w-2.5 h-2.5" strokeWidth={3} />
          </span>
        )}
      </button>
      {AVATAR_IDS.map((id) => {
        const Icon = avatarIcon(id);
        const selected = value === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onSelect(id)}
            aria-pressed={selected}
            aria-label={id}
            className={cn(
              "relative w-11 h-11 rounded-full flex items-center justify-center text-white border-2 transition-colors",
              avatarBgClass(id),
              selected ? "border-primary" : "border-transparent hover:border-border",
            )}
            data-testid={`avatar-option-${id}`}
          >
            <Icon className="w-5 h-5" strokeWidth={2.25} />
            {selected && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
                <Check className="w-2.5 h-2.5" strokeWidth={3} />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
