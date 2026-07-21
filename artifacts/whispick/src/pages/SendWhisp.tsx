import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  useScrapeVideoMeta,
  useCreateWhisp,
  useListMyCircles,
  useListWhisperGroups,
  useSendGroupWhisp,
  getListMyCirclesQueryKey,
  getListWhisperGroupsQueryKey,
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
import { MoodTag, MOOD_CONFIG } from "@/components/shared/MoodTag";
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
  Clock,
  CalendarClock,
  Globe,
  Contact,
  UsersRound,
  Plus,
} from "lucide-react";
import {
  SiYoutube,
  SiTiktok,
  SiInstagram,
  SiFacebook,
  SiWhatsapp,
} from "react-icons/si";
import { isContactPickerSupported, pickContact } from "@/lib/contactPicker";

const WHISPER_CHANNELS = [
  { key: "email", label: "Email", icon: Mail },
  { key: "sms", label: "Text", icon: Phone },
  { key: "whatsapp", label: "WhatsApp", icon: SiWhatsapp },
] as const;

const MOOD_TAGS = Object.entries(MOOD_CONFIG).map(([key, config]) => ({
  key,
  label: config.label,
  color: config.color,
}));

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

function parseTimestampToSeconds(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  const match = trimmed.match(/^(\d+):([0-5]?\d)$/);
  if (!match) return null;
  return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
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
    embedUrl?: string | null;
    platform?: string;
    authorName?: string | null;
  } | null>(null);
  const [moodTag, setMoodTag] = useState<string | null>(null);
  const [anonymousNote, setAnonymousNote] = useState("");
  const [senderAlias, setSenderAlias] = useState(SENDER_ALIASES[0]);
  const [customAlias, setCustomAlias] = useState("");
  const [deliveryMethod, setDeliveryMethod] = useState<"whisper_link" | "ghost_boost" | "circle_drop" | "group_whisper">("whisper_link");
  const [whisperChannel, setWhisperChannel] = useState<"email" | "sms" | "whatsapp">("email");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [startTimestamp, setStartTimestamp] = useState("");
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduledAtValue, setScheduledAtValue] = useState("");
  const [circleId, setCircleId] = useState<string | null>(null);
  const [whisperGroupId, setWhisperGroupId] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [sentWhispId, setSentWhispId] = useState<string | null>(null);
  const [sentGroupSendId, setSentGroupSendId] = useState<string | null>(null);

  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const scrapeMeta = useScrapeVideoMeta();
  const createWhisp = useCreateWhisp();
  const sendGroupWhisp = useSendGroupWhisp();
  const { data: myCircles } = useListMyCircles({
    query: { enabled: deliveryMethod === "circle_drop", queryKey: getListMyCirclesQueryKey() },
  });
  const { data: myWhisperGroups } = useListWhisperGroups({
    query: { enabled: deliveryMethod === "group_whisper", queryKey: getListWhisperGroupsQueryKey() },
  });

  // Deep link from a group's page ("Send a Whisp" there goes to /send?group=ID)
  // — preselect Group Whisper + that group so the sender doesn't have to
  // re-pick it once they reach the delivery-method step.
  useEffect(() => {
    const groupParam = new URLSearchParams(window.location.search).get("group");
    if (groupParam) {
      setDeliveryMethod("group_whisper");
      setWhisperGroupId(groupParam);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        onError: (err: any) => {
          const code = err?.data?.code;
          if (code === "video_private" || code === "video_not_found") {
            urlForm.setError("videoUrl", { type: "manual", message: err.data.error });
            return;
          }
          // Any other scrape failure is inconclusive (network hiccup, a
          // platform whose page we just couldn't parse) rather than a
          // confirmed "the recipient can't open this" — still let the
          // sender proceed with unknown metadata, same as before.
          setVideoMeta({ platform: "other" });
          setStep(2);
        },
      }
    );
  }

  async function handleSend() {
    const alias = customAlias.trim() || senderAlias;
    const isScheduling = scheduleEnabled && deliveryMethod !== "ghost_boost" && !!scheduledAtValue;

    if (deliveryMethod === "group_whisper") {
      if (!whisperGroupId) return;
      sendGroupWhisp.mutate(
        {
          id: whisperGroupId,
          data: {
            videoUrl,
            videoTitle: videoMeta?.title ?? null,
            videoThumbnail: videoMeta?.thumbnail ?? null,
            videoEmbedUrl: videoMeta?.embedUrl ?? null,
            videoPlatform: videoMeta?.platform ?? null,
            videoStartSeconds: parseTimestampToSeconds(startTimestamp),
            whisperChannel,
            anonymousNote: anonymousNote || null,
            senderAlias: alias,
            moodTag: moodTag,
            scheduledAt: isScheduling ? new Date(scheduledAtValue).toISOString() : null,
          },
        },
        {
          onSuccess: (result) => {
            setSentGroupSendId(result.groupSendId);
            setSent(true);
            if (result.skippedMembers.length) {
              toast({
                title: `${result.skippedMembers.length} member${result.skippedMembers.length > 1 ? "s" : ""} skipped`,
                description: "They didn't have the contact info this channel needs.",
              });
            }
            queryClient.invalidateQueries({ queryKey: getGetWhispStatsQueryKey() });
            queryClient.invalidateQueries({ queryKey: getListWhispsQueryKey() });
          },
          onError: (err: any) => {
            toast({ title: err?.data?.error ?? "Failed to send group whisp", variant: "destructive" });
          },
        }
      );
      return;
    }

    createWhisp.mutate(
      {
        data: {
          videoUrl,
          videoTitle: videoMeta?.title ?? null,
          videoThumbnail: videoMeta?.thumbnail ?? null,
          videoEmbedUrl: videoMeta?.embedUrl ?? null,
          videoPlatform: videoMeta?.platform ?? null,
          videoStartSeconds: parseTimestampToSeconds(startTimestamp),
          deliveryMethod,
          whisperChannel: deliveryMethod === "whisper_link" ? whisperChannel : null,
          recipientEmail: deliveryMethod === "whisper_link" && whisperChannel === "email" ? recipientEmail || null : null,
          recipientPhone: deliveryMethod === "whisper_link" && whisperChannel !== "email" ? recipientPhone || null : null,
          circleId: deliveryMethod === "circle_drop" ? circleId : null,
          anonymousNote: anonymousNote || null,
          senderAlias: alias,
          moodTag: moodTag,
          scheduledAt: isScheduling ? new Date(scheduledAtValue).toISOString() : null,
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

  async function handlePickContact() {
    const contact = await pickContact();
    if (!contact) return;

    if (whisperChannel === "email") {
      if (!contact.email) {
        toast({ title: "That contact has no email address on file", variant: "destructive" });
        return;
      }
      setRecipientEmail(contact.email);
    } else {
      if (!contact.tel) {
        toast({ title: "That contact has no phone number on file", variant: "destructive" });
        return;
      }
      setRecipientPhone(contact.tel);
    }
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
              onClick={() => {
                if (sentGroupSendId) setLocation(`/whisper-groups/sends/${sentGroupSendId}`);
                else if (sentWhispId) setLocation(`/whisps/${sentWhispId}`);
              }}
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
                setWhisperChannel("email");
                setRecipientEmail("");
                setRecipientPhone("");
                setStartTimestamp("");
                setScheduleEnabled(false);
                setScheduledAtValue("");
                setCircleId(null);
                setWhisperGroupId(null);
                setSentWhispId(null);
                setSentGroupSendId(null);
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

                <div className="space-y-1.5">
                  <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-muted-foreground" /> Start the video at (optional)
                  </p>
                  <Input
                    className="bg-input/50 border-border/50 rounded-xl w-32"
                    placeholder="mm:ss"
                    value={startTimestamp}
                    onChange={(e) => setStartTimestamp(e.target.value)}
                    data-testid="input-start-timestamp"
                  />
                  <p className="text-xs text-muted-foreground">Jump straight to the good part, e.g. 1:24</p>
                </div>

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
                        <p className="text-sm text-muted-foreground mt-0.5">Send straight to them — direct, instant, guaranteed delivery</p>
                        <p className="text-xs text-primary mt-1 font-medium">Free (3/month)</p>
                      </div>
                    </div>
                  </button>

                  {(deliveryMethod === "whisper_link" || deliveryMethod === "group_whisper") && (
                    <div className="pl-2 pr-1 -mt-1 grid grid-cols-3 gap-2">
                      {WHISPER_CHANNELS.map((ch) => {
                        const Icon = ch.icon;
                        return (
                          <button
                            key={ch.key}
                            type="button"
                            onClick={() => setWhisperChannel(ch.key)}
                            data-testid={`whisper-channel-${ch.key}`}
                            className={`flex flex-col items-center gap-1 py-2.5 rounded-xl border text-xs font-medium transition-all ${
                              whisperChannel === ch.key
                                ? "border-primary bg-primary/10 text-foreground"
                                : "border-border/50 text-muted-foreground hover:border-border"
                            }`}
                          >
                            <Icon className="w-4 h-4" />
                            {ch.label}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => setDeliveryMethod("group_whisper")}
                    data-testid="delivery-group-whisper"
                    className={`p-4 rounded-xl border text-left transition-all ${
                      deliveryMethod === "group_whisper"
                        ? "border-primary bg-primary/10"
                        : "border-border/50 hover:border-border"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`p-2 rounded-xl ${deliveryMethod === "group_whisper" ? "bg-primary/20" : "bg-muted/40"}`}>
                        <UsersRound className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <p className="font-semibold text-foreground">Group Whisper</p>
                        <p className="text-sm text-muted-foreground mt-0.5">Send the same anonymous whisp to a saved group of your contacts at once</p>
                        <p className="text-xs text-primary mt-1 font-medium">Uses Whisper Link credits, 1 per member</p>
                      </div>
                    </div>
                  </button>

                  {deliveryMethod === "group_whisper" && (
                    <div className="pl-2 pr-1 -mt-1 space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">Which group?</p>
                      {(myWhisperGroups ?? []).length === 0 ? (
                        <button
                          type="button"
                          onClick={() => setLocation("/whisper-groups")}
                          data-testid="button-create-whisper-group"
                          className="w-full flex items-center gap-2 p-3 rounded-xl border border-dashed border-border/60 text-sm text-muted-foreground hover:text-foreground hover:border-border transition-all"
                        >
                          <Plus className="w-4 h-4" /> You don't have any groups yet — create one
                        </button>
                      ) : (
                        <div className="grid grid-cols-1 gap-2">
                          {(myWhisperGroups ?? []).map((g) => (
                            <button
                              key={g.id}
                              type="button"
                              onClick={() => setWhisperGroupId(g.id)}
                              data-testid={`whisper-group-option-${g.id}`}
                              className={`flex items-center justify-between gap-2 p-2.5 rounded-xl border text-sm font-medium transition-all ${
                                whisperGroupId === g.id
                                  ? "border-primary bg-primary/10 text-foreground"
                                  : "border-border/50 text-muted-foreground hover:border-border"
                              }`}
                            >
                              <span className="flex items-center gap-2"><UsersRound className="w-4 h-4" /> {g.name}</span>
                              <span className="text-xs text-muted-foreground">{g.memberCount} member{g.memberCount === 1 ? "" : "s"}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

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
                        <p className="text-sm text-muted-foreground mt-0.5">Boosted, wider-reach delivery (beta) — no specific recipient, no guaranteed 1:1 delivery like Whisper Link</p>
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

                  {deliveryMethod === "circle_drop" && (
                    <div className="pl-2 pr-1 -mt-1 space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">Which circle?</p>
                      <div className="grid grid-cols-1 gap-2">
                        <button
                          type="button"
                          onClick={() => setCircleId(null)}
                          data-testid="circle-option-public"
                          className={`flex items-center gap-2 p-2.5 rounded-xl border text-sm font-medium transition-all ${
                            circleId === null
                              ? "border-primary bg-primary/10 text-foreground"
                              : "border-border/50 text-muted-foreground hover:border-border"
                          }`}
                        >
                          <Globe className="w-4 h-4" /> Public Circle feed
                        </button>
                        {(myCircles ?? []).map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => setCircleId(c.id)}
                            data-testid={`circle-option-${c.id}`}
                            className={`flex items-center gap-2 p-2.5 rounded-xl border text-sm font-medium transition-all ${
                              circleId === c.id
                                ? "border-primary bg-primary/10 text-foreground"
                                : "border-border/50 text-muted-foreground hover:border-border"
                            }`}
                          >
                            <Users className="w-4 h-4" /> {c.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {deliveryMethod !== "ghost_boost" && (
                  <div className="space-y-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setScheduleEnabled(!scheduleEnabled)}
                      data-testid="button-toggle-schedule"
                      className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${
                        scheduleEnabled ? "border-primary bg-primary/10" : "border-border/50 hover:border-border"
                      }`}
                    >
                      <CalendarClock className="w-5 h-5 text-primary" />
                      <div className="flex-1">
                        <p className="font-medium text-foreground text-sm">Schedule for later</p>
                        <p className="text-xs text-muted-foreground">Send now, or pick a future date and time</p>
                      </div>
                      <div className={`w-9 h-5 rounded-full transition-colors relative ${scheduleEnabled ? "bg-primary" : "bg-muted"}`}>
                        <div
                          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                            scheduleEnabled ? "translate-x-4" : "translate-x-0.5"
                          }`}
                        />
                      </div>
                    </button>
                    {scheduleEnabled && (
                      <Input
                        type="datetime-local"
                        className="bg-input/50 border-border/50 rounded-xl"
                        value={scheduledAtValue}
                        onChange={(e) => setScheduledAtValue(e.target.value)}
                        data-testid="input-scheduled-at"
                      />
                    )}
                  </div>
                )}

                <div className="flex justify-between pt-2">
                  <Button variant="ghost" onClick={() => setStep(3)} className="rounded-xl text-muted-foreground">
                    <ArrowLeft className="w-4 h-4 mr-1" /> Back
                  </Button>
                  <Button
                    onClick={() => setStep(deliveryMethod === "whisper_link" ? 5 : 6)}
                    disabled={
                      (scheduleEnabled && deliveryMethod !== "ghost_boost" && !scheduledAtValue) ||
                      (deliveryMethod === "group_whisper" && !whisperGroupId)
                    }
                    className="rounded-xl"
                    data-testid="button-next-step4"
                  >
                    {deliveryMethod === "whisper_link" ? "Next" : "Review"} <ArrowRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>
              </div>
            )}

            {/* Step 5: Recipient Info (only Whisper Link has a specific recipient) */}
            {step === 5 && deliveryMethod === "whisper_link" && (
              <div className="space-y-4">
                <h2 className="text-xl font-serif font-semibold">Who should receive it?</h2>
                <p className="text-sm text-muted-foreground">
                  {whisperChannel === "email"
                    ? "Enter their email address."
                    : whisperChannel === "sms"
                    ? "Enter their phone number, in international format (e.g. +1 555 123 4567)."
                    : "Enter their WhatsApp number, in international format (e.g. +1 555 123 4567)."}
                </p>
                <div className="space-y-3">
                  {whisperChannel === "email" ? (
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
                  ) : (
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <Input
                        className="pl-9 bg-input/50 border-border/50 rounded-xl"
                        placeholder="+1 555 123 4567"
                        type="tel"
                        value={recipientPhone}
                        onChange={(e) => setRecipientPhone(e.target.value)}
                        data-testid="input-recipient-phone"
                      />
                    </div>
                  )}
                  {isContactPickerSupported() && (
                    <>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-px bg-border/40" />
                        <span className="text-xs text-muted-foreground">or</span>
                        <div className="flex-1 h-px bg-border/40" />
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full rounded-xl border-border/50"
                        onClick={handlePickContact}
                        data-testid="button-pick-contact"
                      >
                        <Contact className="w-4 h-4 mr-2" /> Choose from Contacts
                      </Button>
                    </>
                  )}
                </div>
                <div className="flex justify-between pt-2">
                  <Button variant="ghost" onClick={() => setStep(4)} className="rounded-xl text-muted-foreground">
                    <ArrowLeft className="w-4 h-4 mr-1" /> Back
                  </Button>
                  <Button
                    onClick={() => setStep(6)}
                    disabled={whisperChannel === "email" ? !recipientEmail : !recipientPhone}
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
                      <span className="text-foreground capitalize">
                        {deliveryMethod === "whisper_link" || deliveryMethod === "group_whisper"
                          ? `${deliveryMethod === "group_whisper" ? "Group Whisper" : "Whisper Link"} (${WHISPER_CHANNELS.find((c) => c.key === whisperChannel)?.label})`
                          : deliveryMethod.replace("_", " ")}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">To</span>
                      <span className="text-foreground">
                        {deliveryMethod === "circle_drop"
                          ? circleId
                            ? myCircles?.find((c) => c.id === circleId)?.name ?? "Private circle"
                            : "Anyone in the Circle feed"
                          : deliveryMethod === "ghost_boost"
                          ? "No specific recipient (boosted reach)"
                          : deliveryMethod === "group_whisper"
                          ? (() => {
                              const g = myWhisperGroups?.find((g) => g.id === whisperGroupId);
                              return g ? `${g.name} (${g.memberCount} member${g.memberCount === 1 ? "" : "s"})` : "Group";
                            })()
                          : whisperChannel === "email"
                          ? recipientEmail
                          : recipientPhone}
                      </span>
                    </div>
                    {startTimestamp && parseTimestampToSeconds(startTimestamp) !== null && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Starts at</span>
                        <span className="text-foreground">{startTimestamp}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">When</span>
                      <span className="text-foreground">
                        {scheduleEnabled && deliveryMethod !== "ghost_boost" && scheduledAtValue
                          ? new Date(scheduledAtValue).toLocaleString(undefined, {
                              dateStyle: "medium",
                              timeStyle: "short",
                            })
                          : "Right now"}
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
                    onClick={() => setStep(deliveryMethod === "whisper_link" ? 5 : 4)}
                    className="rounded-xl text-muted-foreground"
                  >
                    <ArrowLeft className="w-4 h-4 mr-1" /> Back
                  </Button>
                  <Button
                    onClick={handleSend}
                    disabled={createWhisp.isPending || sendGroupWhisp.isPending}
                    className="rounded-full shadow-[0_0_15px_rgba(124,92,252,0.3)] px-6"
                    data-testid="button-send-whisp"
                  >
                    {createWhisp.isPending || sendGroupWhisp.isPending ? (
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
