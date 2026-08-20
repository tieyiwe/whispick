import { useState } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { AppLayout } from "@/components/layout/AppLayout";
import { useCreateDebateTopic } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Swords, Loader2, Sparkles, ArrowLeft } from "lucide-react";

// Title/subtitle length by product design — keep in sync with
// api-server's routes/debateTopics.ts MAX_TOPIC_TEXT_LENGTH.
const MAX_TOPIC_TEXT_LENGTH = 200;

// Keys into createDebateTopic.examples in the debateTopics namespace — the
// display text itself is looked up via t() inside the component so it
// re-renders in the right language when i18next's active language changes.
const EXAMPLE_KEYS = ["honesty", "ageLimit", "protectFeelings"] as const;

export function CreateDebateTopic() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { t } = useTranslation("debateTopics");
  const [topicText, setTopicText] = useState("");
  const createTopic = useCreateDebateTopic();

  const examples = EXAMPLE_KEYS.map((key) => t(`createDebateTopic.examples.${key}`));

  const remaining = MAX_TOPIC_TEXT_LENGTH - topicText.length;
  const canSubmit = topicText.trim().length > 0 && remaining >= 0 && !createTopic.isPending;

  function handleSubmit() {
    const text = topicText.trim();
    if (!text) return;
    createTopic.mutate(
      { data: { topicText: text } },
      {
        onSuccess: (topic) => {
          toast({ title: t("createDebateTopic.toast.posted") });
          setLocation(`/debate-topics/${topic.id}`);
        },
        onError: () => toast({ title: t("createDebateTopic.toast.postError"), variant: "destructive" }),
      },
    );
  }

  return (
    <AppLayout>
      <div className="max-w-xl mx-auto space-y-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setLocation("/debate-topics")}
          className="-ml-2 -mt-2 text-muted-foreground hover:text-foreground"
          data-testid="button-back"
        >
          <ArrowLeft className="w-4 h-4 mr-1.5" /> {t("createDebateTopic.backButton")}
        </Button>

        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground flex items-center gap-3">
            <Swords className="w-7 h-7 text-primary" /> {t("createDebateTopic.title")}
          </h1>
          <p className="text-muted-foreground mt-1">{t("createDebateTopic.description")}</p>
        </div>

        <Card className="bg-card border-border/50 rounded-2xl p-6 space-y-4 glow-card">
          <div className="space-y-2">
            <Textarea
              value={topicText}
              onChange={(e) => setTopicText(e.target.value.slice(0, MAX_TOPIC_TEXT_LENGTH + 40))}
              placeholder={examples[0]}
              rows={3}
              className="font-serif text-xl font-bold leading-snug tracking-tight resize-none bg-background/60 border-border/50 rounded-xl"
              data-testid="input-topic-text"
              autoFocus
            />
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground flex items-center gap-1">
                <Sparkles className="w-3 h-3" /> {t("createDebateTopic.helperText")}
              </span>
              <span className={remaining < 0 ? "text-destructive font-medium" : "text-muted-foreground"}>{remaining}</span>
            </div>
          </div>

          <Button
            className="w-full rounded-full h-12 text-base font-medium shadow-[0_0_24px_rgba(124,92,252,0.35)]"
            disabled={!canSubmit}
            onClick={handleSubmit}
            data-testid="button-post-topic"
          >
            {createTopic.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Swords className="w-4 h-4 mr-2" />}
            {t("createDebateTopic.submitButton")}
          </Button>
        </Card>

        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("createDebateTopic.inspirationLabel")}</p>
          <div className="flex flex-wrap gap-2">
            {examples.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => setTopicText(example)}
                className="text-xs px-3 py-1.5 rounded-full border border-border/50 bg-card/50 text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
              >
                {example}
              </button>
            ))}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
