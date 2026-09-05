import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, X } from "lucide-react";

const MAX_TOPICS = 20;

// Simple add/remove chip list — this codebase doesn't have a reusable
// tag-input component anywhere yet (checked VIDEO_CATEGORIES' picker in
// AdminSuggestions.tsx, which is a fixed checkbox grid, not free text), so
// this is a small purpose-built one rather than a plain list of text inputs.
export function TopicThemesEditor({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");

  function addTopic() {
    const trimmed = draft.trim();
    if (!trimmed || value.includes(trimmed) || value.length >= MAX_TOPICS) return;
    onChange([...value, trimmed]);
    setDraft("");
  }

  function removeTopic(topic: string) {
    onChange(value.filter((t) => t !== topic));
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5 min-h-8">
        {value.length === 0 && <p className="text-xs text-muted-foreground py-1">No topic themes yet — add at least one.</p>}
        {value.map((topic) => (
          <Badge key={topic} variant="outline" className="gap-1 pl-2.5 pr-1 py-1 rounded-full" data-testid={`topic-chip-${topic}`}>
            {topic}
            {!disabled && (
              <button
                type="button"
                onClick={() => removeTopic(topic)}
                className="ml-0.5 rounded-full hover:bg-muted p-0.5"
                aria-label={`Remove ${topic}`}
                data-testid={`button-remove-topic-${topic}`}
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </Badge>
        ))}
      </div>
      {!disabled && (
        <div className="flex items-center gap-2">
          <Input
            placeholder={value.length >= MAX_TOPICS ? `Max ${MAX_TOPICS} topics` : "Add a topic theme…"}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTopic();
              }
            }}
            disabled={value.length >= MAX_TOPICS}
            className="bg-input/50 border-border/50 rounded-xl"
            data-testid="input-add-topic"
          />
          <Button type="button" variant="outline" size="sm" className="rounded-full shrink-0" onClick={addTopic} disabled={value.length >= MAX_TOPICS || !draft.trim()} data-testid="button-add-topic">
            <Plus className="w-3.5 h-3.5 mr-1" /> Add
          </Button>
        </div>
      )}
    </div>
  );
}
