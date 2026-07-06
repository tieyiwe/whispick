import { useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  useScrapeVideoMeta,
  useCreateWhisp,
  getGetWhispStatsQueryKey,
  getListWhispsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { MoodTag } from "@/components/shared/MoodTag";
import {
  ArrowLeft,
  ArrowRight,
  Link2,
  Loader2,
  PlayCircle,
  Mail,
  Phone,
  Ghost,
  Users,
  Send,
  Check,
} from "lucide-react";
import {
  SiYoutube,
  SiTiktok,
  SiInstagram,
  SiFacebook,
} from "react-icons/si";

const MOOD_TAGS = [
  { key: "i-see-you", label: "I See You", color: "#F59E0B" },
  { key: "heal-together", label: "Heal Together", color: "#3B82F6" },
  { key: "i-love-you", label: "I Love You", color: "#EC4899" },
  { key: "think-about-this", label: "Think About This", color: "#10B981" },
  { key: "for-your-growth", label: "For Your Growth", color: "#8B5CF6" },
  { key: "just-because", label: "Just Because", color: "#D4B896" },
];

const SENDER_ALIASES = [
  "Someone who cares",
  "A friend",
  "Someone who loves you",
  "An admirer",
];

function PlatformIcon({ platform }: { platform?: string | null }) {
  const cls = "w-5 h-5";
  switch (platform) {
    case "youtube": return <SiYoutube className={cls} style={{ color: "#FF0000" }} />;
    case "tiktok": return <SiTiktok className={cls} />;
    case "instagram": return <SiInstagram className={cls} style={{ color: "#E1306C" }} />;
    case "facebook": return <SiFacebook className={cls} style={{ color: "#1877F2" }} />;
    default: return <PlayCircle className={cls} />;
  }
}

function ParticleAnimation() {
  return (
    <div className="relative h-32 flex items-center justify-center pointer-events-none overflow-hidden">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="particle absolute w-3 h-3 rounded-full bg-primary/80 blur-[2px]"
          style={{
            left: `${15 + i * 10}%`,
            bottom: "0",
            animationDelay: `${i * 0.25}s`,
            animationDuration: `${2.5 + (i % 3) * 0.5}s`,
            width: `${8 + (i % 3) * 4}px`,
            height: `${8 + (i % 3) * 4}px`,
            background: i % 3 === 0 ? "#7C5CFC" : i % 3 === 1 ? "#FF6B6B" : "#a78bfa",
          }}
        />
      ))}
    </div>
  );
}

const step1Schema = z.object({ videoUrl: z.string().url("Please enter a valid URL") });
const step5Schema = z.object({
  recipientEmail: z.string().email().optional().or(z.literal("")),
  recipientPhone: z.string().optional(),
});

export function SendWhisp() {
  const [step, setStep] = useState(1);
  const [videoUrl, setVideoUrl] = useState("");
  const [videoMeta, setVideoMeta] = useState<{
    title?: string | null;
    thumbnail?: string | null;
    platform?: string;
    authorName?: string | null;
  } | null>(null);
  const [moodTag, setMoodTag] = useState<string | null>(null);
  const [anonymousNote, setAnonymousNote] = useState("");
  const [senderAlias, setSenderAlias] = useState(SENDER_ALIASES[0]);
  const [customAlias, setCustomAlias] = useState("");
  const [deliveryMethod, setDeliveryMethod] = useState<"whisper_link" | "ghost_boost" | "circle_drop">("whisper_link");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [sent, setSent] = useState(false);
  const [sentWhispId, setSentWhispId] = useState<string | null>(null);

  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const scrapeMeta = useScrapeVideoMeta();
  const createWhisp = useCreateWhisp();

  const urlForm = useForm({ resolver: zodResolver(step1Schema), defaultValues: { videoUrl: "" } });

  function handleUrlSubmit() {
    const url = urlForm.getValues("videoUrl");
    if (!url) return;
    setVideoUrl(url);
    scrapeMeta.mutate(
      { data: { url } },
      {
        onSuccess: (meta) => {
          setVideoMeta(meta);
          setStep(2);
        },
        onError: () => {
          setVideoMeta({ platform: "other" });
          setStep(2);
        },
      }
    );
  }

  async function handleSend() {
    const alias = customAlias.trim() || senderAlias;
    createWhisp.mutate(
      {
        data: {
          videoUrl,
          videoTitle: videoMeta?.title ?? null,
          videoThumbnail: videoMeta?.thumbnail ?? null,
          videoPlatform: videoMeta?.platform ?? null,
          deliveryMethod,
          recipientEmail: recipientEmail || null,
          recipientPhone: recipientPhone || null,
          anonymousNote: anonymousNote || null,
          senderAlias: alias,
          moodTag: moodTag,
          scheduledAt: null,
        },
      },
      {
        onSuccess: (whisp) => {
          setSentWhispId(whisp.id);
          setSent(true);
          queryClient.invalidateQueries({ queryKey: getGetWhispStatsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListWhispsQueryKey() });
        },
        onError: () => {
          toast({ title: "Failed to send whisp", variant: "destructive" });
        },
      }
    );
  }

  const steps = ["Video", "Mood", "Note", "Delivery", "Recipient", "Send"];

  if (sent) {
    return (
      <AppLayout>
        <div className="max-w-xl mx-auto text-center py-16 space-y-6">
          <ParticleAnimation />
          <div className="w-20 h-20 rounded-full bg-primary/20 flex items-center justify-center mx-auto glow-card">
            <Check className="w-10 h-10 text-primary" />
          </div>
          <h1 className="text-4xl font-serif font-bold text-foreground">Your whisp is on its way</h1>
          <p className="text-muted-foreground text-lg">
            It's been sent. We'll let you know when it's seen.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-4">
            <Button
              variant="outline"
              className="rounded-full"
              onClick={() => sentWhispId && setLocation(`/whisps/${sentWhispId}`)}
              data-testid="button-track-whisp"
            >
              Track this whisp
            </Button>
            <Button
              className="rounded-full shadow-[0_0_15px_rgba(124,92,252,0.3)]"
              onClick={() => {
                setSent(false);
                setStep(1);
                setVideoUrl("");
                setVideoMeta(null);
                setMoodTag(null);
                setAnonymousNote("");
                setSenderAlias(SENDER_ALIASES[0]);
                setCustomAlias("");
                setDeliveryMethod("whisper_link");
                setRecipientEmail("");
                setRecipientPhone("");
                setSentWhispId(null);
                urlForm.reset();
              }}
              data-testid="button-send-another"
            >
              Send another
            </Button>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">Send a Whisp</h1>
          <p className="text-muted-foreground mt-1">Share a video anonymously with someone you care about.</p>
        </div>

        {/* Step indicators */}
        <div className="flex items-center gap-1">
          {steps.map((s, i) => (
            <div key={i} className="flex items-center gap-1">
              <div
                className={`w-2 h-2 rounded-full transition-all ${
                  i + 1 < step
                    ? "bg-primary"
                    : i + 1 === step
                    ? "w-6 bg-primary"
                    : "bg-border"
                }`}
              />
            </div>
          ))}
          <span className="ml-2 text-xs text-muted-foreground">Step {step} of {steps.length}</span>
        </div>

        <Card className="bg-card border-border/50 overflow-hidden">
          <CardContent className="p-6 space-y-5">
            {/* Step 1: Paste URL */}
            {step === 1 && (
              <div className="space-y-4">
                <h2 className="text-xl font-serif font-semibold">Paste a video link</h2>
                <p className="text-sm text-muted-foreground">YouTube, TikTok, Instagram, Facebook, Vimeo — any public video URL.</p>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      className="pl-9 bg-input/50 border-border/50 rounded-xl"
                      placeholder="https://youtube.com/watch?v=..."
                      {...urlForm.register("videoUrl")}
                      onKeyDown={(e) => e.key === "Enter" && urlForm.handleSubmit(handleUrlSubmit)()}
                      data-testid="input-video-url"
                    />
                  </div>
                  <Button
                    onClick={urlForm.handleSubmit(handleUrlSubmit)}
                    disabled={scrapeMeta.isPending}
                    className="rounded-xl"
                    data-testid="button-fetch-video"
                  >
                    {scrapeMeta.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                  </Button>
                </div>
                {urlForm.formState.errors.videoUrl && (
                  <p className="text-sm text-destructive">{urlForm.formState.errors.videoUrl.message}</p>
                )}
              </div>
            )}

            {/* Step 2: Mood Tag */}
            {step === 2 && (
              <div className="space-y-4">
                {/* Video preview */}
                {(videoMeta?.thumbnail || videoMeta?.title) && (
                  <div className="flex gap-3 p-3 bg-muted/30 rounded-xl items-center">
                    {videoMeta.thumbnail ? (
                      <img src={videoMeta.thumbnail} className="w-16 h-12 object-cover rounded-lg" alt="thumbnail" />
                    ) : (
                      <div className="w-16 h-12 bg-muted rounded-lg flex items-center justify-center">
                        <PlayCircle className="w-5 h-5 text-muted-foreground" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <PlatformIcon platform={videoMeta.platform} />
                        <span className="text-xs text-muted-foreground capitalize">{videoMeta.platform}</span>
                      </div>
                      <p className="text-sm font-medium text-foreground truncate">{videoMeta.title || "Video"}</p>
                    </div>
                  </div>
                )}

                <h2 className="text-xl font-serif font-semibold">Choose a mood tag</h2>
                <p className="text-sm text-muted-foreground">Optional — sets the emotional tone for the recipient.</p>
                <div className="grid grid-cols-2 gap-2">
                  {MOOD_TAGS.map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => setMoodTag(moodTag === m.key ? null : m.key)}
                      data-testid={`mood-tag-${m.key}`}
                      className={`flex items-center gap-2 p-3 rounded-xl border transition-all text-left text-sm font-medium ${
                        moodTag === m.key
                          ? "border-primary bg-primary/10 text-foreground"
                          : "border-border/50 hover:border-border text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: m.color }} />
                      {m.label}
                    </button>
                  ))}
                </div>
                <div className="flex justify-between pt-2">
                  <Button variant="ghost" onClick={() => setStep(1)} className="rounded-xl text-muted-foreground">
                    <ArrowLeft className="w-4 h-4 mr-1" /> Back
                  </Button>
                  <Button onClick={() => setStep(3)} className="rounded-xl" data-testid="button-next-step2">
                    Next <ArrowRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>
              </div>
            )}

            {/* Step 3: Anonymous Note */}
            {step === 3 && (
              <div className="space-y-4">
                <h2 className="text-xl font-serif font-semibold">Add an anonymous note</h2>
                <p className="text-sm text-muted-foreground">Optional — max 200 characters. The recipient won't know it's you.</p>
                <div className="relative">
                  <Textarea
                    className="bg-input/50 border-border/50 rounded-xl min-h-[100px] resize-none"
                    placeholder="Write something kind, honest, or brave..."
                    maxLength={200}
                    value={anonymousNote}
                    onChange={(e) => setAnonymousNote(e.target.value)}
                    data-testid="textarea-anonymous-note"
                  />
                  <span className="absolute bottom-2 right-3 text-xs text-muted-foreground">{anonymousNote.length}/200</span>
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">Sign as:</p>
                  <div className="grid grid-cols-2 gap-2">
                    {SENDER_ALIASES.map((alias) => (
                      <button
                        key={alias}
                        type="button"
                        onClick={() => { setSenderAlias(alias); setCustomAlias(""); }}
                        data-testid={`alias-${alias.replace(/\s+/g, "-").toLowerCase()}`}
                        className={`p-2 rounded-xl text-xs text-left border transition-all ${
                          senderAlias === alias && !customAlias
                            ? "border-primary bg-primary/10 text-foreground"
                            : "border-border/50 text-muted-foreground hover:border-border"
                        }`}
                      >
                        {alias}
                      </button>
                    ))}
                  </div>
                  <Input
                    placeholder="Or type a custom alias..."
                    className="bg-input/50 border-border/50 rounded-xl text-sm"
                    value={customAlias}
                    onChange={(e) => setCustomAlias(e.target.value)}
                    data-testid="input-custom-alias"
                  />
                </div>
                <div className="flex justify-between pt-2">
                  <Button variant="ghost" onClick={() => setStep(2)} className="rounded-xl text-muted-foreground">
                    <ArrowLeft className="w-4 h-4 mr-1" /> Back
                  </Button>
                  <Button onClick={() => setStep(4)} className="rounded-xl" data-testid="button-next-step3">
                    Next <ArrowRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>
              </div>
            )}

            {/* Step 4: Delivery Method */}
            {step === 4 && (
              <div className="space-y-4">
                <h2 className="text-xl font-serif font-semibold">How should it be delivered?</h2>
                <div className="grid grid-cols-1 gap-3">
                  <button
                    type="button"
                    onClick={() => setDeliveryMethod("whisper_link")}
                    data-testid="delivery-whisper-link"
                    className={`p-4 rounded-xl border text-left transition-all ${
                      deliveryMethod === "whisper_link"
                        ? "border-primary bg-primary/10"
                        : "border-border/50 hover:border-border"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`p-2 rounded-xl ${deliveryMethod === "whisper_link" ? "bg-primary/20" : "bg-muted/40"}`}>
                        <Mail className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <p className="font-semibold text-foreground">Whisper Link</p>
                        <p className="text-sm text-muted-foreground mt-0.5">Send via SMS or email — direct, instant delivery</p>
                        <p className="text-xs text-primary mt-1 font-medium">Free (3/month)</p>
                      </div>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeliveryMethod("ghost_boost")}
                    data-testid="delivery-ghost-boost"
                    className={`p-4 rounded-xl border text-left transition-all ${
                      deliveryMethod === "ghost_boost"
                        ? "border-primary bg-primary/10"
                        : "border-border/50 hover:border-border"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`p-2 rounded-xl ${deliveryMethod === "ghost_boost" ? "bg-primary/20" : "bg-muted/40"}`}>
                        <Ghost className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <p className="font-semibold text-foreground">Ghost Boost</p>
                        <p className="text-sm text-muted-foreground mt-0.5">Feed injection — queued for placement in their social feed, feels completely organic</p>
                        <p className="text-xs text-secondary mt-1 font-medium">1 Credit ($6.99)</p>
                      </div>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeliveryMethod("circle_drop")}
                    data-testid="delivery-circle-drop"
                    className={`p-4 rounded-xl border text-left transition-all ${
                      deliveryMethod === "circle_drop"
                        ? "border-primary bg-primary/10"
                        : "border-border/50 hover:border-border"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`p-2 rounded-xl ${deliveryMethod === "circle_drop" ? "bg-primary/20" : "bg-muted/40"}`}>
                        <Users className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <p className="font-semibold text-foreground">Circle Drop</p>
                        <p className="text-sm text-muted-foreground mt-0.5">Post it to the community feed — no specific recipient, organic discovery</p>
                        <p className="text-xs text-primary mt-1 font-medium">Free</p>
                      </div>
                    </div>
                  </button>
                </div>
                <div className="flex justify-between pt-2">
                  <Button variant="ghost" onClick={() => setStep(3)} className="rounded-xl text-muted-foreground">
                    <ArrowLeft className="w-4 h-4 mr-1" /> Back
                  </Button>
                  <Button
                    onClick={() => setStep(deliveryMethod === "circle_drop" ? 6 : 5)}
                    className="rounded-xl"
                    data-testid="button-next-step4"
                  >
                    {deliveryMethod === "circle_drop" ? "Review" : "Next"} <ArrowRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>
              </div>
            )}

            {/* Step 5: Recipient Info (skipped for Circle Drop) */}
            {step === 5 && deliveryMethod !== "circle_drop" && (
              <div className="space-y-4">
                <h2 className="text-xl font-serif font-semibold">Who should receive it?</h2>
                <p className="text-sm text-muted-foreground">
                  {deliveryMethod === "whisper_link"
                    ? "Enter their email or phone number."
                    : "Enter their contact info to build a targeted audience. It's hashed and never stored in plaintext."}
                </p>
                <div className="space-y-3">
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      className="pl-9 bg-input/50 border-border/50 rounded-xl"
                      placeholder="Email address"
                      type="email"
                      value={recipientEmail}
                      onChange={(e) => setRecipientEmail(e.target.value)}
                      data-testid="input-recipient-email"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-px bg-border/50" />
                    <span className="text-xs text-muted-foreground">or</span>
                    <div className="flex-1 h-px bg-border/50" />
                  </div>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      className="pl-9 bg-input/50 border-border/50 rounded-xl"
                      placeholder="Phone number"
                      type="tel"
                      value={recipientPhone}
                      onChange={(e) => setRecipientPhone(e.target.value)}
                      data-testid="input-recipient-phone"
                    />
                  </div>
                </div>
                <div className="flex justify-between pt-2">
                  <Button variant="ghost" onClick={() => setStep(4)} className="rounded-xl text-muted-foreground">
                    <ArrowLeft className="w-4 h-4 mr-1" /> Back
                  </Button>
                  <Button
                    onClick={() => setStep(6)}
                    disabled={!recipientEmail && !recipientPhone}
                    className="rounded-xl"
                    data-testid="button-next-step5"
                  >
                    Review <ArrowRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>
              </div>
            )}

            {/* Step 6: Confirm + Send */}
            {step === 6 && (
              <div className="space-y-4">
                <h2 className="text-xl font-serif font-semibold">Ready to send?</h2>
                <div className="space-y-2 text-sm">
                  {videoMeta?.thumbnail && (
                    <img src={videoMeta.thumbnail} className="w-full h-32 object-cover rounded-xl" alt="Video thumbnail" />
                  )}
                  <div className="p-3 bg-muted/30 rounded-xl space-y-2">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Video</span>
                      <span className="text-foreground font-medium truncate max-w-[60%] text-right">{videoMeta?.title || videoUrl}</span>
                    </div>
                    {moodTag && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Mood</span>
                        <MoodTag mood={moodTag} />
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Signed as</span>
                      <span className="text-foreground">{customAlias || senderAlias}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Delivery</span>
                      <span className="text-foreground capitalize">{deliveryMethod.replace("_", " ")}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">To</span>
                      <span className="text-foreground">
                        {deliveryMethod === "circle_drop" ? "Anyone in the Circle feed" : recipientEmail || recipientPhone}
                      </span>
                    </div>
                    {anonymousNote && (
                      <div className="border-t border-border/50 pt-2">
                        <span className="text-muted-foreground block mb-1">Your note</span>
                        <span className="text-foreground italic">"{anonymousNote}"</span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex justify-between pt-2">
                  <Button
                    variant="ghost"
                    onClick={() => setStep(deliveryMethod === "circle_drop" ? 4 : 5)}
                    className="rounded-xl text-muted-foreground"
                  >
                    <ArrowLeft className="w-4 h-4 mr-1" /> Back
                  </Button>
                  <Button
                    onClick={handleSend}
                    disabled={createWhisp.isPending}
                    className="rounded-full shadow-[0_0_15px_rgba(124,92,252,0.3)] px-6"
                    data-testid="button-send-whisp"
                  >
                    {createWhisp.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    ) : (
                      <Send className="w-4 h-4 mr-2" />
                    )}
                    Send Whisp
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
