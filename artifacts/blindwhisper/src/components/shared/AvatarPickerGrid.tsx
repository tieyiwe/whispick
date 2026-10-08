import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { AVATAR_IDS, avatarIcon, avatarBgClass, type AvatarId } from "@/lib/avatars";

// The whole preset library plus an explicit "no avatar" option — no upload
// control anywhere in here, deliberately (see lib/avatars.ts). Used both by
// the per-thread anonymous identity (DebateTopicDetail.tsx, inside a w-80
// popover) and the signed-in account-level Whisperer identity
// (SettingsPage.tsx), so the layout has to hold at ~288px and stay compact
// in a wide card.
//
// "No avatar" is its own labelled chip above the grid rather than a bare
// letter tile mixed in with the icons — it's a different kind of choice.
// The 24 presets are ordered shape-by-shape in threes (violet, amber, rose),
// so six columns put exactly two shapes on each row.
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
  const noneSelected = value === null;

  return (
    <div className="space-y-3 max-w-sm" role="listbox" aria-label={t("avatarPickerGrid.chooseAvatar")}>
      <button
        type="button"
        onClick={() => onSelect(null)}
        aria-pressed={noneSelected}
        aria-label={t("avatarPickerGrid.noAvatar")}
        className={cn(
          "inline-flex min-h-11 items-center gap-2.5 rounded-full border py-1 pl-1 pr-4 text-sm transition-colors",
          noneSelected
            ? "border-primary bg-primary/10 text-foreground"
            : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground",
        )}
        data-testid="avatar-option-none"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-muted font-serif text-base font-bold text-foreground">
          {handle.charAt(0).toUpperCase() || "?"}
        </span>
        {t("avatarPickerGrid.useInitial")}
        {noneSelected && <Check className="h-4 w-4 text-primary" strokeWidth={2.5} />}
      </button>

      <div className="grid grid-cols-6 gap-x-1.5 gap-y-2 justify-items-center">
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
                "relative w-full max-w-11 aspect-square rounded-full flex items-center justify-center text-white transition-[box-shadow,transform] duration-150 ease-out",
                avatarBgClass(id),
                selected
                  ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
                  : "hover:scale-[1.06] opacity-90 hover:opacity-100",
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
    </div>
  );
}
