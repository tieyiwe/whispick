import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  useScrapeVideoMeta,
  useCreateWhisp,
  useListWhisperGroups,
  useCreateWhisperGroup,
  useAddWhisperGroupMembers,
  useSendGroupWhisp,
  useListMedia,
  useGetNoteSuggestions,
  useGetConciergeSuggestions,
  useGetUserProfile,
  useGetMyRecentRecipients,
  getListWhisperGroupsQueryKey,
  getGetWhispStatsQueryKey,
  getListWhispsQueryKey,
  getListMediaQueryKey,
  type SuggestedVideo,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { MoodTag, MOOD_CONFIG } from "@/components/shared/MoodTag";
import { Logo } from "@/components/ui/logo";
import { WhispSentConfirmation } from "@/components/shared/WhispSentConfirmation";
import {
  ArrowLeft,
  ArrowRight,
  Link2,
  Loader2,
  PlayCircle,
  Mail,
  Phone,
  Ghost,
  Send,
  Clock,
  CalendarClock,
  Contact,
  UsersRound,
  Plus,
  Upload,
  FolderOpen,
  Video,
  Camera,
  Sparkles,
  RefreshCw,
} from "lucide-react";
import { SiWhatsapp } from "react-icons/si";
import { PlatformIcon } from "@/components/shared/PlatformIcon";
import { isContactPickerSupported, pickContact } from "@/lib/contactPicker";
import { parseRecipients, tokenAtCaret, replaceTokenAt, recipientKey } from "@/lib/recipients";
import { uploadMedia, UploadValidationError, MAX_UPLOAD_DURATION_SECONDS, type UploadedVideoResult } from "@/lib/uploadMedia";
import { Thumbnail } from "@/components/shared/Thumbnail";
import { CameraCapture } from "@/components/shared/CameraCapture";
import { takePendingForward } from "@/lib/forwardVideo";
import { DemographicsGateDialog } from "@/components/shared/DemographicsGateDialog";
import { needsDemographics } from "@/lib/demographics";
import { GHOST_BOOST_ENABLED } from "@/lib/featureFlags";

const WHISPER_CHANNELS = [
  { key: "email", icon: Mail },
  { key: "sms", icon: Phone },
  { key: "whatsapp", icon: SiWhatsapp },
] as const;

const MOOD_TAGS = Object.entries(MOOD_CONFIG).map(([key, config]) => ({
  key,
  label: config.label,
  color: config.color,
}));

const SENDER_ALIAS_KEYS = ["someoneWhoCares", "aFriend", "someoneWhoLovesYou", "anAdmirer"] as const;

function parseTimestampToSeconds(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  const match = trimmed.match(/^(\d+):([0-5]?\d)$/);
  if (!match) return null;
  return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
}

function formatSecondsAsTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

// "1 minute" / "90 seconds" — whichever reads naturally for whatever
// MAX_UPLOAD_DURATION_SECONDS currently is, so this copy never goes stale
// again the way the old hardcoded "under 2 minutes" text did.
function formatMaxUploadDuration(t: (key: string, options?: Record<string, unknown>) => string): string {
  if (MAX_UPLOAD_DURATION_SECONDS % 60 === 0) {
    const minutes = MAX_UPLOAD_DURATION_SECONDS / 60;
    return t("sendWhisp.maxDurationMinutes", { count: minutes });
  }
  return t("sendWhisp.maxDurationSeconds", { count: MAX_UPLOAD_DURATION_SECONDS });
}

const step1Schema = z.object({ videoUrl: z.string().url("Please enter a valid URL") });
const step5Schema = z.object({
  recipientEmail: z.string().email().optional().or(z.literal("")),
  recipientPhone: z.string().optional(),
});

export function SendWhisp() {
  const { t } = useTranslation("whisp");
  const senderAliasOptions = SENDER_ALIAS_KEYS.map((key) => ({ key, label: t(`sendWhisp.senderAliases.${key}`) }));
  const [step, setStep] = useState(1);
  const [videoSource, setVideoSource] = useState<"url" | "upload" | "camera" | "library" | "concierge">("url");
  const [videoUrl, setVideoUrl] = useState("");
  const [videoMeta, setVideoMeta] = useState<{
    title?: string | null;
    thumbnail?: string | null;
    embedUrl?: string | null;
    platform?: string;
    authorName?: string | null;
    noPreview?: boolean;
  } | null>(null);
  const [uploadedVideoId, setUploadedVideoId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isForwarded, setIsForwarded] = useState(false);
  const [moodTag, setMoodTag] = useState<string | null>(null);
  const [anonymousNote, setAnonymousNote] = useState("");
  const [noteSuggestions, setNoteSuggestions] = useState<string[]>([]);
  // "Not sure what to send?" concierge — a free-text situation matched
  // against the Suggestions Library (routes/whisps.ts's POST /concierge),
  // an alternate entry point above the normal manual video-source tabs.
  // conciergeRequestId is only set once the sender actually acts on a
  // concierge result (picks a suggested video, or keeps the drafted note),
  // and is carried into the final whisp so admin analytics can see whether
  // concierge suggestions led to a real send.
  const [conciergeSituation, setConciergeSituation] = useState("");
  const [conciergeVideoSuggestions, setConciergeVideoSuggestions] = useState<SuggestedVideo[]>([]);
  const [conciergeNoteDraft, setConciergeNoteDraft] = useState<string | null>(null);
  const [conciergeSearched, setConciergeSearched] = useState(false);
  // Set as soon as a concierge call succeeds — needed so a subsequent
  // "use this video"/"keep this note" tap can commit it below.
  const [conciergeResultId, setConciergeResultId] = useState<string | null>(null);
  // Only committed once the sender actually acts on a concierge result —
  // this is what's carried into the final whisp, so admin analytics can
  // tell whether concierge suggestions led to a real send.
  const [conciergeRequestId, setConciergeRequestId] = useState<string | null>(null);
  const [senderAlias, setSenderAlias] = useState(senderAliasOptions[0].label);
  const [customAlias, setCustomAlias] = useState("");
  const [deliveryMethod, setDeliveryMethod] = useState<"whisper_link" | "ghost_boost" | "group_whisper">("whisper_link");
  const [whisperChannel, setWhisperChannel] = useState<"email" | "sms" | "whatsapp">("email");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  // Whisper Link's single recipient box: emails and phone numbers together,
  // comma-separated, channel derived per entry. (whisperChannel above is
  // still used by Group Whisper, which picks one channel for the whole
  // group rather than per member.)
  const [recipientsInput, setRecipientsInput] = useState("");
  // Where the caret sits in that field, so suggestions match the entry being
  // typed rather than the whole comma-separated list.
  const [recipientCaret, setRecipientCaret] = useState(0);
  const recipientsRef = useRef<HTMLTextAreaElement>(null);
  const [preferWhatsApp, setPreferWhatsApp] = useState(false);
  const [sendingBatch, setSendingBatch] = useState(false);
  const [sentCount, setSentCount] = useState(1);
  const [startTimestamp, setStartTimestamp] = useState("");
  const [endTimestamp, setEndTimestamp] = useState("");
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduledAtValue, setScheduledAtValue] = useState("");
  const [whisperGroupId, setWhisperGroupId] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [sentWhispId, setSentWhispId] = useState<string | null>(null);
  const [sentGroupSendId, setSentGroupSendId] = useState<string | null>(null);
  const [showDemographicsGate, setShowDemographicsGate] = useState(false);

  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const { data: profile } = useGetUserProfile();
  const scrapeMeta = useScrapeVideoMeta();
  const createWhisp = useCreateWhisp();
  const sendGroupWhisp = useSendGroupWhisp();
  const createWhisperGroup = useCreateWhisperGroup();
  const addWhisperGroupMembers = useAddWhisperGroupMembers();
  const noteSuggestionsMutation = useGetNoteSuggestions();
  const conciergeMutation = useGetConciergeSuggestions();
  const { data: myWhisperGroups } = useListWhisperGroups({
    query: { enabled: deliveryMethod === "group_whisper", queryKey: getListWhisperGroupsQueryKey() },
  });
  const { data: mediaLibrary } = useListMedia({
    query: { enabled: videoSource === "library" && step === 1, queryKey: getListMediaQueryKey() },
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

  // "Pass it forward" from the public whisp page — a video someone just
  // appreciated, waiting in sessionStorage. Consumed (and cleared) once, so
  // pre-fill straight to the mood step rather than making them re-paste a
  // URL they didn't choose.
  useEffect(() => {
    const forward = takePendingForward();
    if (!forward) return;
    if (forward.uploadedVideoId) {
      // An uploaded/recorded clip forwarded from Media Library's "Whisp It"
      // button — identified by id, same as handleLibrarySelect below, not
      // by URL (there isn't a real navigable one for an upload).
      setUploadedVideoId(forward.uploadedVideoId);
      setVideoUrl("");
    } else {
      setVideoUrl(forward.videoUrl);
      setUploadedVideoId(null);
    }
    setVideoMeta({
      title: forward.videoTitle,
      thumbnail: forward.videoThumbnail,
      embedUrl: forward.videoEmbedUrl,
      platform: forward.videoPlatform ?? undefined,
    });
    if (forward.videoStartSeconds) setStartTimestamp(formatSecondsAsTimestamp(forward.videoStartSeconds));
    if (forward.videoEndSeconds) setEndTimestamp(formatSecondsAsTimestamp(forward.videoEndSeconds));
    setIsForwarded(true);
    setStep(2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const urlForm = useForm({ resolver: zodResolver(step1Schema), defaultValues: { videoUrl: "" } });

  function handleUrlSubmit() {
    const url = urlForm.getValues("videoUrl");
    if (!url) return;
    setVideoUrl(url);
    setUploadedVideoId(null);
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

  async function handleFileSelect(file: File | undefined) {
    if (!file) return;
    setUploadError(null);
    setIsUploading(true);
    try {
      const result = await uploadMedia(file);
      setUploadedVideoId(result.id);
      setVideoUrl("");
      setVideoMeta({ title: result.originalFilename, thumbnail: `/api/media/${result.id}/thumbnail`, platform: "upload" });
      setStep(2);
    } catch (err) {
      setUploadError(err instanceof UploadValidationError ? err.message : t("sendWhisp.upload.genericError"));
    } finally {
      setIsUploading(false);
    }
  }

  // Camera capture (photo or video) — CameraCapture already ran the result
  // through uploadMedia.ts's exact same pipeline a file picked via "Upload"
  // goes through, so from here on a camera capture is indistinguishable
  // from an upload: same uploadedVideoId, same retention, same playback.
  function handleCameraUploaded(result: UploadedVideoResult) {
    setUploadedVideoId(result.id);
    setVideoUrl("");
    setVideoMeta({ title: result.originalFilename, thumbnail: `/api/media/${result.id}/thumbnail`, platform: "upload" });
    setStep(2);
  }

  function handleLibrarySelect(item: { id: string; originalFilename: string; status: string }) {
    if (item.status !== "ready") return;
    setUploadedVideoId(item.id);
    setVideoUrl("");
    setVideoMeta({ title: item.originalFilename, thumbnail: `/api/media/${item.id}/thumbnail`, platform: "upload" });
    setStep(2);
  }

  function handleConciergeSubmit() {
    const situation = conciergeSituation.trim();
    if (!situation) return;
    conciergeMutation.mutate(
      { data: { situation } },
      {
        onSuccess: (result) => {
          setConciergeVideoSuggestions(result.videoSuggestions);
          setConciergeNoteDraft(result.noteDraft);
          setConciergeResultId(result.requestId);
          setConciergeSearched(true);
          if (result.videoSuggestions.length === 0 && !result.noteDraft) {
            toast({ title: t("sendWhisp.toast.conciergeNoResults"), variant: "destructive" });
          }
        },
        onError: () => toast({ title: t("sendWhisp.toast.noSuggestions"), variant: "destructive" }),
      }
    );
  }

  // Same fields a Suggestions Library pick auto-fills (see
  // SuggestionsLibrary.tsx's handleWhisper), but set directly rather than
  // via the forwardVideo.ts sessionStorage handoff — the concierge lives
  // right here on the composer, so there's no page navigation to carry
  // metadata across. Also carries the drafted note into the same
  // tap-to-fill "note suggestions" list Step 3 already renders, so picking
  // it up there needs no new UI.
  function handleUseConciergeVideo(video: SuggestedVideo) {
    setUploadedVideoId(null);
    setVideoUrl(video.videoUrl);
    setVideoMeta({
      title: video.videoTitle,
      thumbnail: video.videoThumbnail,
      embedUrl: video.videoEmbedUrl,
      platform: video.videoPlatform ?? undefined,
      authorName: video.authorName,
    });
    setNoteSuggestions(conciergeNoteDraft ? [conciergeNoteDraft] : []);
    setConciergeRequestId(conciergeResultId);
    setStep(2);
  }

  // For the "no strong video match" fallback — keep the drafted note (via
  // the same Step 3 tap-to-fill list) and let the sender pick their own
  // video the normal way.
  function handleUseConciergeNoteOnly() {
    setNoteSuggestions(conciergeNoteDraft ? [conciergeNoteDraft] : []);
    setConciergeRequestId(conciergeResultId);
    setVideoSource("url");
  }

  function handleSuggestNotes() {
    noteSuggestionsMutation.mutate(
      { data: { videoTitle: videoMeta?.title ?? null, moodTag } },
      {
        onSuccess: (result) => {
          if (result.suggestions.length === 0) {
            toast({ title: t("sendWhisp.toast.noSuggestions"), variant: "destructive" });
            return;
          }
          setNoteSuggestions(result.suggestions);
        },
        onError: () => toast({ title: t("sendWhisp.toast.noSuggestions"), variant: "destructive" }),
      }
    );
  }

  async function handleSend(opts?: { skipDemographicsCheck?: boolean }) {
    // One-time gate before a sender's very first whisp — see
    // lib/demographics.ts. Checked here so it interrupts before the send
    // even fires; the server enforces the same thing (428
    // "demographics_required") as a backstop in case this check ever gets
    // out of sync with a stale cached profile. Skipped when the gate itself
    // resumes the send: at that moment the cached profile is still the
    // pre-answer one (the gate's invalidation hasn't refetched yet), so
    // re-checking here would just re-open the gate — and the server's 428
    // backstop still catches a genuinely unanswered gate.
    if (!opts?.skipDemographicsCheck && needsDemographics(profile)) {
      setShowDemographicsGate(true);
      return;
    }

    const alias = customAlias.trim() || senderAlias;
    const isScheduling = scheduleEnabled && deliveryMethod !== "ghost_boost" && !!scheduledAtValue;

    if (deliveryMethod === "group_whisper") {
      if (!whisperGroupId) return;
      sendGroupWhisp.mutate(
        {
          id: whisperGroupId,
          data: {
            videoUrl: uploadedVideoId ? null : videoUrl,
            videoTitle: videoMeta?.title ?? null,
            // A relative /api/media/:id/thumbnail path when uploadedVideoId
            // is set — real for the frontend's own preview, but not a valid
            // http(s) URL for the API, which derives the real thumbnail
            // server-side from the upload anyway (see routes/whisps.ts).
            videoThumbnail: uploadedVideoId ? null : videoMeta?.thumbnail ?? null,
            videoEmbedUrl: uploadedVideoId ? null : videoMeta?.embedUrl ?? null,
            videoPlatform: videoMeta?.platform ?? null,
            uploadedVideoId,
            videoStartSeconds: parseTimestampToSeconds(startTimestamp),
            videoEndSeconds: parseTimestampToSeconds(endTimestamp),
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
                title: t("sendWhisp.toast.membersSkipped", { count: result.skippedMembers.length }),
                description: t("sendWhisp.toast.membersSkippedDescription"),
              });
            }
            queryClient.invalidateQueries({ queryKey: getGetWhispStatsQueryKey() });
            queryClient.invalidateQueries({ queryKey: getListWhispsQueryKey() });
          },
          onError: (err: any) => {
            if (err?.status === 428) {
              setShowDemographicsGate(true);
              return;
            }
            toast({ title: err?.data?.error ?? t("sendWhisp.toast.failedToSendGroup"), variant: "destructive" });
          },
        }
      );
      return;
    }

    const sharedPayload = {
      videoUrl: uploadedVideoId ? null : videoUrl,
      videoTitle: videoMeta?.title ?? null,
      // See the group_whisper branch above for why this is nulled for an
      // upload — a relative preview path, not a valid http(s) URL.
      videoThumbnail: uploadedVideoId ? null : videoMeta?.thumbnail ?? null,
      videoEmbedUrl: uploadedVideoId ? null : videoMeta?.embedUrl ?? null,
      videoPlatform: videoMeta?.platform ?? null,
      uploadedVideoId,
      videoStartSeconds: parseTimestampToSeconds(startTimestamp),
      videoEndSeconds: parseTimestampToSeconds(endTimestamp),
      deliveryMethod,
      // Blind Circle posts are composed on the Blind Circle page, not here.
      circleId: null,
      anonymousNote: anonymousNote || null,
      senderAlias: alias,
      moodTag: moodTag,
      scheduledAt: isScheduling ? new Date(scheduledAtValue).toISOString() : null,
      conciergeRequestId,
    };

    // For anything that isn't a Whisper Link (Blind Circle, Ghost Boost)
    // there's no per-recipient contact at all — one send, unchanged.
    if (deliveryMethod !== "whisper_link") {
      createWhisp.mutate(
        { data: { ...sharedPayload, whisperChannel: null, recipientEmail: null, recipientPhone: null } },
        {
          onSuccess: (whisp) => {
            setSentWhispId(whisp.id);
            setSent(true);
            queryClient.invalidateQueries({ queryKey: getGetWhispStatsQueryKey() });
            queryClient.invalidateQueries({ queryKey: getListWhispsQueryKey() });
          },
          onError: (err: any) => {
            if (err?.status === 428) {
              setShowDemographicsGate(true);
              return;
            }
            toast({ title: t("sendWhisp.toast.failedToSend"), variant: "destructive" });
          },
        },
      );
      return;
    }

    // One whisp per recipient, sent sequentially rather than as one request
    // carrying a list. That's deliberate: each recipient gets their own
    // publicToken (so two people never land in the same thread and see each
    // other's replies), each send debits the plan honestly, and a failure
    // part-way through — hitting the monthly cap on recipient 3 of 5 — is
    // reportable per recipient instead of silently succeeding or rolling the
    // whole batch back. Sequential, not parallel, so the server's own
    // plan-limit check sees a consistent count rather than a burst racing it.
    setSendingBatch(true);
    const succeeded: string[] = [];
    const failed: { contact: string; message: string }[] = [];
    let gated = false;

    // More than one recipient means this is a group worth keeping. Saved as a
    // real Whisper Group so the same set is reusable next time without
    // retyping it — but delivery still goes out one whisp per person (below)
    // rather than through the group-send pipeline, because a group send
    // commits to a single channel and this list can mix emails with phone
    // numbers. Best-effort: if saving the group fails, the whisps still go.
    if (parsedRecipients.recipients.length > 1) {
      try {
        const first = parsedRecipients.recipients[0].raw;
        const others = parsedRecipients.recipients.length - 1;
        const group = await createWhisperGroup.mutateAsync({
          data: { name: `${first} +${others} more` },
        });
        await addWhisperGroupMembers.mutateAsync({
          id: group.id,
          data: {
            members: parsedRecipients.recipients.map((r) => ({
              email: r.kind === "email" ? r.raw : null,
              phone: r.kind === "phone" ? r.raw : null,
            })),
          },
        });
        queryClient.invalidateQueries({ queryKey: getListWhisperGroupsQueryKey() });
      } catch {
        // Saving the group is a convenience, not the point of the send —
        // never block delivery on it.
      }
    }

    for (const recipient of parsedRecipients.recipients) {
      try {
        const whisp = await createWhisp.mutateAsync({
          data: {
            ...sharedPayload,
            // Auto-derived from what they typed — a phone number goes over
            // WhatsApp only if they explicitly asked for it, otherwise SMS.
            whisperChannel: recipient.kind === "email" ? "email" : preferWhatsApp ? "whatsapp" : "sms",
            recipientEmail: recipient.kind === "email" ? recipient.raw : null,
            recipientPhone: recipient.kind === "phone" ? recipient.raw : null,
          },
        });
        succeeded.push(whisp.id);
      } catch (err: any) {
        if (err?.status === 428) {
          gated = true;
          break;
        }
        failed.push({ contact: recipient.raw, message: err?.data?.error ?? t("sendWhisp.toast.failedToSendFallback") });
      }
    }
    setSendingBatch(false);

    queryClient.invalidateQueries({ queryKey: getGetWhispStatsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListWhispsQueryKey() });

    if (gated) {
      setShowDemographicsGate(true);
      return;
    }

    if (succeeded.length === 0) {
      toast({
        title: failed[0]?.message ?? t("sendWhisp.toast.failedToSend"),
        variant: "destructive",
      });
      return;
    }

    // Partial success is reported plainly rather than shown as a clean win —
    // a sender who thinks all five went out when two didn't has no way to
    // notice.
    if (failed.length > 0) {
      toast({
        title: t("sendWhisp.toast.partialSendTitle", { succeeded: succeeded.length, failed: failed.length }),
        description: failed.map((f) => f.contact).join(", "),
        variant: "destructive",
      });
    }

    setSentWhispId(succeeded[0]);
    setSentCount(succeeded.length);
    setSent(true);
  }

  async function handlePickContact() {
    const contact = await pickContact();
    if (!contact) return;

    // Whichever detail the contact actually has — email first, since it's the
    // channel that always works. Appends rather than replaces, so picking
    // several contacts in a row builds up the list.
    const picked = contact.email || contact.tel;
    if (!picked) {
      toast({ title: t("sendWhisp.toast.noContactInfo"), variant: "destructive" });
      return;
    }
    setRecipientsInput((current) => (current.trim() ? `${current.replace(/,\s*$/, "")}, ${picked}` : picked));
  }

  const parsedRecipients = parseRecipients(recipientsInput);

  // Contacts this sender has used before, so a returning user doesn't retype
  // an address. Server-derived from their own sending history rather than
  // held in localStorage, so it's there on a new device too.
  const { data: recentRecipients } = useGetMyRecentRecipients();
  const recipientToken = tokenAtCaret(recipientsInput, recipientCaret);
  const alreadyEntered = new Set(parsedRecipients.recipients.map((r) => recipientKey(r.raw, r.kind)));
  const recipientSuggestions = (recentRecipients?.items ?? [])
    // Never suggest someone already in the field — the whole point is to save
    // typing, and offering a duplicate wastes the one slot it has.
    .filter((c) => !alreadyEntered.has(recipientKey(c.value, c.kind as "email" | "phone")))
    .filter((c) => {
      if (!recipientToken.token) return true;
      const typed = recipientToken.token.toLowerCase();
      // Phone numbers are matched on digits so "555" finds "+1 555 123 4567"
      // despite the spaces and the country code the sender didn't type.
      const digits = typed.replace(/\D/g, "");
      return c.kind === "phone" && digits
        ? c.value.replace(/\D/g, "").includes(digits)
        : c.value.toLowerCase().includes(typed);
    })
    .slice(0, 5);

  function applyRecipientSuggestion(value: string) {
    const next = replaceTokenAt(recipientsInput, recipientToken.start, recipientToken.end, value);
    setRecipientsInput(next.value);
    setRecipientCaret(next.caret);
    // Put the caret back where the next entry goes; without this the browser
    // parks it at the end of the field on refocus.
    requestAnimationFrame(() => {
      const el = recipientsRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.caret, next.caret);
    });
  }
  const hasPhoneRecipient = parsedRecipients.recipients.some((r) => r.kind === "phone");
  const canContinueFromRecipients =
    parsedRecipients.recipients.length > 0 && parsedRecipients.invalid.length === 0;

  const steps = [
    t("sendWhisp.steps.video"),
    t("sendWhisp.steps.mood"),
    t("sendWhisp.steps.note"),
    t("sendWhisp.steps.delivery"),
    t("sendWhisp.steps.recipient"),
    t("sendWhisp.steps.send"),
  ];

  if (sent) {
    return (
      <AppLayout>
        <div className="max-w-xl mx-auto text-center py-16 space-y-6">
          <WhispSentConfirmation />
          <h1 className="text-4xl font-serif font-bold text-foreground">
            {t("sendWhisp.sent.title", { count: sentCount })}
          </h1>
          <p className="text-muted-foreground text-lg">
            {t("sendWhisp.sent.description", { count: sentCount })}
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-4">
            <Button
              variant="outline"
              className="rounded-full"
              onClick={() => {
                // A multi-recipient send is N separate whisps, each with its
                // own thread — the list is the honest destination, not one
                // arbitrary recipient's page.
                if (sentGroupSendId) setLocation(`/whisper-groups/sends/${sentGroupSendId}`);
                else if (sentCount > 1) setLocation("/whisps");
                else if (sentWhispId) setLocation(`/whisps/${sentWhispId}`);
              }}
              data-testid="button-track-whisp"
            >
              {t("sendWhisp.sent.trackButton", { count: sentCount })}
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
                setSenderAlias(senderAliasOptions[0].label);
                setCustomAlias("");
                setDeliveryMethod("whisper_link");
                setWhisperChannel("email");
                setRecipientEmail("");
                setRecipientPhone("");
                setRecipientsInput("");
                setPreferWhatsApp(false);
                setSentCount(1);
                setStartTimestamp("");
                setEndTimestamp("");
                setScheduleEnabled(false);
                setScheduledAtValue("");
                setWhisperGroupId(null);
                setSentWhispId(null);
                setSentGroupSendId(null);
                setConciergeSituation("");
                setConciergeVideoSuggestions([]);
                setConciergeNoteDraft(null);
                setConciergeSearched(false);
                setConciergeResultId(null);
                setConciergeRequestId(null);
                urlForm.reset();
              }}
              data-testid="button-send-another"
            >
              {t("sendWhisp.sent.sendAnother")}
            </Button>
          </div>
        </div>
      </AppLayout>
    );
  }

  const parsedStartSeconds = parseTimestampToSeconds(startTimestamp);
  const parsedEndSeconds = parseTimestampToSeconds(endTimestamp);
  const trimError = !endTimestamp
    ? null
    : parsedEndSeconds === null
      ? t("sendWhisp.validation.invalidTimeFormat")
      : parsedEndSeconds <= 0
        ? t("sendWhisp.validation.endTimeMustBeGreaterThanZero")
        : parsedStartSeconds !== null && parsedEndSeconds <= parsedStartSeconds
          ? t("sendWhisp.validation.endTimeAfterStart")
          : null;

  return (
    <AppLayout>
      <div className="max-w-xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">{t("sendWhisp.header.title")}</h1>
          <p className="text-muted-foreground mt-1">{t("sendWhisp.header.subtitle")}</p>
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
          <span className="ml-2 text-xs text-muted-foreground">{t("sendWhisp.stepIndicator", { step, total: steps.length })}</span>
        </div>

        <Card className="bg-card border-border/50 overflow-hidden">
          <CardContent className="p-6 space-y-5">
            {/* Step 1: choose a video */}
            {step === 1 && (
              <div className="space-y-4">
                <div className="flex gap-1.5 p-1 bg-muted/30 rounded-xl w-fit flex-wrap">
                  {([
                    { key: "concierge" as const, label: t("sendWhisp.tabs.concierge"), icon: Sparkles },
                    { key: "url" as const, label: t("sendWhisp.tabs.url"), icon: Link2 },
                    { key: "upload" as const, label: t("sendWhisp.tabs.upload"), icon: Upload },
                    { key: "camera" as const, label: t("sendWhisp.tabs.camera"), icon: Camera },
                    { key: "library" as const, label: t("sendWhisp.tabs.library"), icon: FolderOpen },
                  ]).map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setVideoSource(tab.key)}
                      data-testid={`tab-source-${tab.key}`}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                        videoSource === tab.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
                      }`}
                    >
                      <tab.icon className="w-3.5 h-3.5" /> {tab.label}
                    </button>
                  ))}
                </div>

                {videoSource === "url" && (
                  <>
                    <h2 className="text-xl font-serif font-semibold">{t("sendWhisp.url.heading")}</h2>
                    <p className="text-sm text-muted-foreground">{t("sendWhisp.url.description")}</p>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                          className="pl-9 bg-input/50 border-border/50 rounded-xl"
                          placeholder={t("sendWhisp.url.placeholder")}
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
                      <p className="text-sm text-destructive">
                        {urlForm.formState.errors.videoUrl.type === "manual"
                          ? urlForm.formState.errors.videoUrl.message
                          : t("sendWhisp.validation.invalidUrl")}
                      </p>
                    )}
                  </>
                )}

                {videoSource === "upload" && (
                  <>
                    <h2 className="text-xl font-serif font-semibold">{t("sendWhisp.upload.heading")}</h2>
                    <p className="text-sm text-muted-foreground">
                      {t("sendWhisp.upload.description", { duration: formatMaxUploadDuration(t) })}
                    </p>
                    <label
                      className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-border/60 rounded-xl py-10 cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors"
                      data-testid="label-upload-video"
                    >
                      {isUploading ? (
                        <Loader2 className="w-6 h-6 text-muted-foreground animate-spin" />
                      ) : (
                        <Upload className="w-6 h-6 text-muted-foreground" />
                      )}
                      <span className="text-sm text-muted-foreground">
                        {isUploading ? t("sendWhisp.upload.processing") : t("sendWhisp.upload.tapToChoose")}
                      </span>
                      <input
                        type="file"
                        accept="video/mp4,video/webm,video/quicktime"
                        className="hidden"
                        disabled={isUploading}
                        onChange={(e) => handleFileSelect(e.target.files?.[0])}
                        data-testid="input-upload-video"
                      />
                    </label>
                    {uploadError && <p className="text-sm text-destructive">{uploadError}</p>}
                  </>
                )}

                {videoSource === "camera" && (
                  <>
                    <h2 className="text-xl font-serif font-semibold">{t("sendWhisp.camera.heading")}</h2>
                    <p className="text-sm text-muted-foreground">
                      {t("sendWhisp.camera.description", { duration: formatMaxUploadDuration(t) })}
                    </p>
                    <CameraCapture onUploaded={handleCameraUploaded} />
                  </>
                )}

                {videoSource === "library" && (
                  <>
                    <h2 className="text-xl font-serif font-semibold">{t("sendWhisp.library.heading")}</h2>
                    <p className="text-sm text-muted-foreground">{t("sendWhisp.library.description")}</p>
                    {!mediaLibrary?.length ? (
                      <p className="text-sm text-muted-foreground py-6 text-center">
                        {t("sendWhisp.library.empty")}
                      </p>
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        {mediaLibrary.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => handleLibrarySelect(item)}
                            disabled={item.status !== "ready"}
                            data-testid={`button-library-item-${item.id}`}
                            className="relative flex flex-col gap-1.5 p-2 rounded-xl border border-border/50 bg-muted/20 text-left hover:border-primary/50 hover:bg-primary/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <div className="aspect-video bg-muted rounded-lg overflow-hidden flex items-center justify-center">
                              <Thumbnail src={`/api/media/${item.id}/thumbnail`} className="w-full h-full object-cover" />
                            </div>
                            <p className="text-xs font-medium text-foreground truncate">{item.originalFilename}</p>
                            {item.status !== "ready" && (
                              <span className="absolute top-2 right-2 text-[10px] px-1.5 py-0.5 rounded-full bg-background/90 text-muted-foreground">
                                {t("sendWhisp.library.notAvailable")}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}

                {videoSource === "concierge" && (
                  <>
                    <h2 className="text-xl font-serif font-semibold flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-primary" /> {t("sendWhisp.concierge.heading")}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      {t("sendWhisp.concierge.description")}
                    </p>
                    <div className="relative">
                      <Textarea
                        className="bg-input/50 border-border/50 rounded-xl min-h-[80px] resize-none"
                        placeholder={t("sendWhisp.concierge.placeholder")}
                        maxLength={500}
                        value={conciergeSituation}
                        onChange={(e) => setConciergeSituation(e.target.value)}
                        data-testid="textarea-concierge-situation"
                      />
                      <span className="absolute bottom-2 right-3 text-xs text-muted-foreground">{conciergeSituation.length}/500</span>
                    </div>
                    <Button
                      onClick={handleConciergeSubmit}
                      disabled={conciergeMutation.isPending || !conciergeSituation.trim()}
                      className="rounded-xl"
                      data-testid="button-concierge-submit"
                    >
                      {conciergeMutation.isPending ? (
                        <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                      ) : (
                        <Sparkles className="w-4 h-4 mr-1.5" />
                      )}
                      {conciergeSearched ? t("sendWhisp.concierge.tryAgain") : t("sendWhisp.concierge.getSuggestions")}
                    </Button>

                    {conciergeSearched && !conciergeMutation.isPending && (
                      <div className="space-y-3 pt-3 border-t border-border/30" data-testid="concierge-results">
                        {conciergeVideoSuggestions.length > 0 ? (
                          <>
                            <p className="text-sm font-medium text-foreground">{t("sendWhisp.concierge.resultsHeading")}</p>
                            <div className="grid grid-cols-1 gap-2">
                              {conciergeVideoSuggestions.map((video) => (
                                <button
                                  key={video.id}
                                  type="button"
                                  onClick={() => handleUseConciergeVideo(video)}
                                  data-testid={`button-concierge-video-${video.id}`}
                                  className="flex gap-3 p-2.5 rounded-xl border border-border/50 bg-muted/20 text-left hover:border-primary/50 hover:bg-primary/5 transition-colors"
                                >
                                  <div className="w-16 h-12 flex-shrink-0 bg-muted rounded-lg overflow-hidden flex items-center justify-center">
                                    {video.videoThumbnail ? (
                                      <Thumbnail src={video.videoThumbnail} alt={video.videoTitle ?? t("sendWhisp.concierge.videoThumbnailAlt")} className="w-full h-full object-cover" />
                                    ) : (
                                      <PlayCircle className="w-5 h-5 text-muted-foreground" />
                                    )}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5 mb-0.5">
                                      <PlatformIcon platform={video.videoPlatform} className="w-3 h-3" />
                                      <span className="text-[11px] text-muted-foreground capitalize">{video.videoPlatform}</span>
                                    </div>
                                    <p className="text-sm font-medium text-foreground truncate">{video.videoTitle || t("sendWhisp.concierge.untitledVideo")}</p>
                                    {video.aiSummary && <p className="text-xs text-muted-foreground line-clamp-2">{video.aiSummary}</p>}
                                  </div>
                                </button>
                              ))}
                            </div>
                          </>
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            {t("sendWhisp.concierge.noMatch")}
                          </p>
                        )}

                        {conciergeNoteDraft && (
                          <div className="space-y-1.5">
                            <p className="text-xs font-medium text-muted-foreground">{t("sendWhisp.concierge.draftedNote")}</p>
                            <p className="text-sm p-2.5 rounded-xl border border-border/50 bg-card text-foreground" data-testid="concierge-note-draft">
                              {conciergeNoteDraft}
                            </p>
                            {conciergeVideoSuggestions.length === 0 && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="rounded-full"
                                onClick={handleUseConciergeNoteOnly}
                                data-testid="button-concierge-note-only"
                              >
                                {t("sendWhisp.concierge.useNoteOnly")}
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Step 2: Mood Tag */}
            {step === 2 && (
              <div className="space-y-4">
                {isForwarded && (
                  <div className="flex items-center gap-1.5 text-xs text-primary bg-primary/10 rounded-full px-3 py-1.5 w-fit" data-testid="badge-passing-forward">
                    <Send className="w-3 h-3" /> {t("sendWhisp.step2.passingForward")}
                  </div>
                )}
                {!isForwarded && conciergeRequestId && (
                  <div className="flex items-center gap-1.5 text-xs text-primary bg-primary/10 rounded-full px-3 py-1.5 w-fit" data-testid="badge-concierge-suggested">
                    <Sparkles className="w-3 h-3" /> {t("sendWhisp.step2.suggestedForSituation")}
                  </div>
                )}
                {/* Video preview */}
                {videoMeta?.noPreview ? (
                  <div className="flex gap-3 p-3 bg-muted/30 rounded-xl items-center">
                    <div className="w-16 h-12 bg-muted rounded-lg flex items-center justify-center shrink-0">
                      <PlatformIcon platform={videoMeta.platform} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground capitalize">{t("sendWhisp.step2.platformLink", { platform: videoMeta.platform })}</p>
                      <p className="text-xs text-muted-foreground">
                        {t("sendWhisp.step2.noPreviewDescription", { platform: videoMeta.platform })}
                      </p>
                    </div>
                  </div>
                ) : (videoMeta?.thumbnail || videoMeta?.title) && (
                  <div className="flex gap-3 p-3 bg-muted/30 rounded-xl items-center">
                    {videoMeta.thumbnail ? (
                      <Thumbnail src={videoMeta.thumbnail} alt="thumbnail" className="w-16 h-12 object-cover rounded-lg" />
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
                      <p className="text-sm font-medium text-foreground truncate">{videoMeta.title || t("sendWhisp.step2.videoFallback")}</p>
                    </div>
                  </div>
                )}

                <div className="space-y-1.5">
                  <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-muted-foreground" /> {t("sendWhisp.step2.trimHeading")}
                  </p>
                  <div className="flex items-center gap-2">
                    <Input
                      className="bg-input/50 border-border/50 rounded-xl w-28"
                      placeholder={t("sendWhisp.step2.startPlaceholder")}
                      value={startTimestamp}
                      onChange={(e) => setStartTimestamp(e.target.value)}
                      data-testid="input-start-timestamp"
                    />
                    <span className="text-muted-foreground text-sm">{t("sendWhisp.step2.to")}</span>
                    <Input
                      className="bg-input/50 border-border/50 rounded-xl w-28"
                      placeholder={t("sendWhisp.step2.endPlaceholder")}
                      value={endTimestamp}
                      onChange={(e) => setEndTimestamp(e.target.value)}
                      data-testid="input-end-timestamp"
                    />
                  </div>
                  {trimError ? (
                    <p className="text-xs text-destructive">{trimError}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {t("sendWhisp.step2.trimHint")}
                    </p>
                  )}
                </div>

                <h2 className="text-xl font-serif font-semibold">{t("sendWhisp.step2.moodHeading")}</h2>
                <p className="text-sm text-muted-foreground">{t("sendWhisp.step2.moodSubtitle")}</p>
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
                    <ArrowLeft className="w-4 h-4 mr-1" /> {t("sendWhisp.common.back")}
                  </Button>
                  <Button onClick={() => setStep(3)} disabled={!!trimError} className="rounded-xl" data-testid="button-next-step2">
                    {t("sendWhisp.common.next")} <ArrowRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>
              </div>
            )}

            {/* Step 3: Anonymous Note */}
            {step === 3 && (
              <div className="space-y-4">
                <h2 className="text-xl font-serif font-semibold">{t("sendWhisp.step3.heading")}</h2>
                <p className="text-sm text-muted-foreground">{t("sendWhisp.step3.subtitle")}</p>
                <div className="relative">
                  <Textarea
                    className="bg-input/50 border-border/50 rounded-xl min-h-[100px] resize-none"
                    placeholder={t("sendWhisp.step3.placeholder")}
                    maxLength={200}
                    value={anonymousNote}
                    onChange={(e) => setAnonymousNote(e.target.value)}
                    data-testid="textarea-anonymous-note"
                  />
                  <span className="absolute bottom-2 right-3 text-xs text-muted-foreground">{anonymousNote.length}/200</span>
                </div>

                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={handleSuggestNotes}
                    disabled={noteSuggestionsMutation.isPending}
                    data-testid="button-suggest-notes"
                    className="flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors disabled:opacity-50"
                  >
                    {noteSuggestionsMutation.isPending ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5" />
                    )}
                    {noteSuggestions.length > 0 ? t("sendWhisp.step3.suggestMore") : t("sendWhisp.step3.helpFindWords")}
                  </button>

                  {noteSuggestions.length > 0 && (
                    <div className="space-y-1.5" data-testid="note-suggestions">
                      {noteSuggestions.map((suggestion, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => setAnonymousNote(suggestion.slice(0, 200))}
                          data-testid={`note-suggestion-${i}`}
                          className="w-full text-left text-sm p-2.5 rounded-xl border border-border/50 bg-card hover:border-primary/40 transition-colors text-foreground"
                        >
                          {suggestion}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={handleSuggestNotes}
                        disabled={noteSuggestionsMutation.isPending}
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                      >
                        <RefreshCw className="w-3 h-3" /> {t("sendWhisp.step3.regenerate")}
                      </button>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">{t("sendWhisp.step3.signAs")}</p>
                  <div className="grid grid-cols-2 gap-2">
                    {senderAliasOptions.map((alias) => (
                      <button
                        key={alias.key}
                        type="button"
                        onClick={() => { setSenderAlias(alias.label); setCustomAlias(""); }}
                        data-testid={`alias-${alias.key}`}
                        className={`p-2 rounded-xl text-xs text-left border transition-all ${
                          senderAlias === alias.label && !customAlias
                            ? "border-primary bg-primary/10 text-foreground"
                            : "border-border/50 text-muted-foreground hover:border-border"
                        }`}
                      >
                        {alias.label}
                      </button>
                    ))}
                  </div>
                  <Input
                    placeholder={t("sendWhisp.step3.customAliasPlaceholder")}
                    className="bg-input/50 border-border/50 rounded-xl text-sm"
                    value={customAlias}
                    onChange={(e) => setCustomAlias(e.target.value)}
                    data-testid="input-custom-alias"
                  />
                </div>
                <div className="flex justify-between pt-2">
                  <Button variant="ghost" onClick={() => setStep(2)} className="rounded-xl text-muted-foreground">
                    <ArrowLeft className="w-4 h-4 mr-1" /> {t("sendWhisp.common.back")}
                  </Button>
                  <Button onClick={() => setStep(4)} className="rounded-xl" data-testid="button-next-step3">
                    {t("sendWhisp.common.next")} <ArrowRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>
              </div>
            )}

            {/* Step 4: Delivery Method */}
            {step === 4 && (
              <div className="space-y-4">
                <h2 className="text-xl font-serif font-semibold">{t("sendWhisp.step4.heading")}</h2>
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
                        <p className="text-sm text-muted-foreground mt-0.5">{t("sendWhisp.step4.whisperLink.description")}</p>
                        <p className="text-xs text-primary mt-1 font-medium">{t("sendWhisp.step4.whisperLink.price")}</p>
                      </div>
                    </div>
                  </button>

                  {/* Group Whisper only. A Whisper Link derives its channel
                      from the recipient itself (see step 5), so asking for it
                      up front was a question the sender shouldn't have to
                      answer — and one they could get wrong, picking "Email"
                      then typing a phone number. A group send picks a single
                      channel for everyone, so the choice still belongs there. */}
                  {deliveryMethod === "group_whisper" && (
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
                            {t(`sendWhisp.channels.${ch.key}`)}
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
                        <p className="font-semibold text-foreground">{t("sendWhisp.step4.groupWhisper.title")}</p>
                        <p className="text-sm text-muted-foreground mt-0.5">{t("sendWhisp.step4.groupWhisper.description")}</p>
                        <p className="text-xs text-primary mt-1 font-medium">{t("sendWhisp.step4.groupWhisper.price")}</p>
                      </div>
                    </div>
                  </button>

                  {deliveryMethod === "group_whisper" && (
                    <div className="pl-2 pr-1 -mt-1 space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">{t("sendWhisp.step4.groupWhisper.whichGroup")}</p>
                      {(myWhisperGroups ?? []).length === 0 ? (
                        <button
                          type="button"
                          onClick={() => setLocation("/whisper-groups")}
                          data-testid="button-create-whisper-group"
                          className="w-full flex items-center gap-2 p-3 rounded-xl border border-dashed border-border/60 text-sm text-muted-foreground hover:text-foreground hover:border-border transition-all"
                        >
                          <Plus className="w-4 h-4" /> {t("sendWhisp.step4.groupWhisper.noGroupsCreate")}
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
                              <span className="text-xs text-muted-foreground">{t("shared.memberCount", { count: g.memberCount })}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {GHOST_BOOST_ENABLED && (
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
                          <p className="text-sm text-muted-foreground mt-0.5">{t("sendWhisp.step4.ghostBoost.description")}</p>
                          <p className="text-xs text-secondary mt-1 font-medium">{t("sendWhisp.step4.ghostBoost.price")}</p>
                        </div>
                      </div>
                    </button>
                  )}
                  {/* Blind Circle used to be a fourth option here. Posting to a
                      community feed has no recipient at all, so asking people to
                      start a choose-a-recipient wizard in order to do it was
                      backwards — it now lives on the Blind Circle page itself,
                      which is also where the feed it posts to is. */}
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
                        <p className="font-medium text-foreground text-sm">{t("sendWhisp.step4.scheduleTitle")}</p>
                        <p className="text-xs text-muted-foreground">{t("sendWhisp.step4.scheduleDescription")}</p>
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
                    <ArrowLeft className="w-4 h-4 mr-1" /> {t("sendWhisp.common.back")}
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
                    {deliveryMethod === "whisper_link" ? t("sendWhisp.common.next") : t("sendWhisp.common.review")} <ArrowRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>
              </div>
            )}

            {/* Step 5: Recipient Info (only Whisper Link has a specific recipient) */}
            {step === 5 && deliveryMethod === "whisper_link" && (
              <div className="space-y-4">
                <h2 className="text-xl font-serif font-semibold">{t("sendWhisp.step5.heading")}</h2>
                <p className="text-sm text-muted-foreground">
                  {t("sendWhisp.step5.description")}
                </p>
                <div className="space-y-3">
                  <Textarea
                    ref={recipientsRef}
                    className="bg-input/50 border-border/50 rounded-xl resize-none min-h-[80px]"
                    placeholder={t("sendWhisp.step5.placeholder")}
                    value={recipientsInput}
                    onChange={(e) => {
                      setRecipientsInput(e.target.value);
                      setRecipientCaret(e.target.selectionStart ?? e.target.value.length);
                    }}
                    // Clicking or arrowing into a different entry has to move
                    // the suggestions with it, not just typing.
                    onSelect={(e) => setRecipientCaret(e.currentTarget.selectionStart ?? 0)}
                    data-testid="input-recipients"
                  />

                  {/* Contacts they've sent to before. Shown as soon as the
                      field is focused-and-empty as well as while typing —
                      "who did I send that to last time" is exactly the thing
                      people can't remember, and a list they have to start
                      spelling correctly to see is no help. */}
                  {recipientSuggestions.length > 0 && (
                    <div className="space-y-1.5" data-testid="recipient-suggestions">
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        {recipientToken.token ? t("sendWhisp.step5.matchingContacts") : t("sendWhisp.step5.recentlySentTo")}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {recipientSuggestions.map((c) => (
                          <button
                            key={`${c.kind}:${c.value}`}
                            type="button"
                            onClick={() => applyRecipientSuggestion(c.value)}
                            data-testid={`suggestion-recipient-${c.value}`}
                            className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-2.5 py-1 text-xs text-foreground transition-colors hover:border-primary/50 hover:bg-primary/10"
                          >
                            {c.kind === "email" ? (
                              <Mail className="w-3 h-3 text-muted-foreground" />
                            ) : (
                              <Phone className="w-3 h-3 text-muted-foreground" />
                            )}
                            {c.value}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Live read-back of how each entry was understood. Without
                      it, auto-detection is invisible — a typo'd address just
                      fails at send time with no clue which one was wrong. */}
                  {parsedRecipients.recipients.length > 0 && (
                    <div className="flex flex-wrap gap-2" data-testid="recipient-chips">
                      {parsedRecipients.recipients.map((r) => (
                        <span
                          key={r.raw}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 border border-primary/25 text-xs text-foreground"
                        >
                          {r.kind === "email" ? <Mail className="w-3 h-3 text-primary" /> : <Phone className="w-3 h-3 text-primary" />}
                          {r.raw}
                        </span>
                      ))}
                    </div>
                  )}

                  {parsedRecipients.invalid.length > 0 && (
                    <p className="text-xs text-destructive" data-testid="text-invalid-recipients">
                      {t("sendWhisp.step5.invalidRecipients", { list: parsedRecipients.invalid.join(", ") })}
                    </p>
                  )}

                  {/* Says plainly what more than one recipient causes, before
                      they commit to it — a group appearing in their account
                      unannounced, or each person quietly costing a separate
                      Whisper Link, would both be surprises. */}
                  {parsedRecipients.recipients.length > 1 && (
                    <div
                      className="flex items-start gap-2 rounded-xl border border-gilded/25 bg-gilded/[0.07] px-3 py-2.5"
                      data-testid="notice-becomes-group"
                    >
                      <UsersRound className="w-4 h-4 text-gilded shrink-0 mt-0.5" />
                      <p className="text-xs text-muted-foreground">
                        <span className="text-foreground font-medium">
                          {t("sendWhisp.step5.groupNoticeBold", { count: parsedRecipients.recipients.length })}
                        </span>{" "}
                        {t("sendWhisp.step5.groupNoticeRest")}
                      </p>
                    </div>
                  )}

                  {/* Only meaningful once a phone number is actually in the
                      list — a phone number could be reached either way, and
                      that's the one thing detection genuinely can't infer. */}
                  {hasPhoneRecipient && (
                    <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                      <input
                        type="checkbox"
                        checked={preferWhatsApp}
                        onChange={(e) => setPreferWhatsApp(e.target.checked)}
                        className="rounded border-border/50"
                        data-testid="checkbox-prefer-whatsapp"
                      />
                      {t("sendWhisp.step5.preferWhatsApp")}
                    </label>
                  )}

                  {/* A2P 10DLC-required disclosure, shown at the exact point
                      a phone number is collected for SMS delivery — not just
                      buried in the Terms. Only for the SMS path; WhatsApp
                      delivery isn't carrier-regulated the same way. */}
                  {hasPhoneRecipient && !preferWhatsApp && (
                    <p className="text-xs text-muted-foreground" data-testid="text-sms-consent-disclosure">
                      {t("sendWhisp.step5.smsDisclosure")}{" "}
                      <a href="/sms-terms" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                        {t("sendWhisp.step5.smsTermsLinkText")}
                      </a>.
                    </p>
                  )}

                  {isContactPickerSupported() && (
                    <>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-px bg-border/40" />
                        <span className="text-xs text-muted-foreground">{t("sendWhisp.step5.or")}</span>
                        <div className="flex-1 h-px bg-border/40" />
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full rounded-xl border-border/50"
                        onClick={handlePickContact}
                        data-testid="button-pick-contact"
                      >
                        <Contact className="w-4 h-4 mr-2" /> {t("sendWhisp.step5.chooseFromContacts")}
                      </Button>
                    </>
                  )}
                </div>
                <div className="flex justify-between pt-2">
                  <Button variant="ghost" onClick={() => setStep(4)} className="rounded-xl text-muted-foreground">
                    <ArrowLeft className="w-4 h-4 mr-1" /> {t("sendWhisp.common.back")}
                  </Button>
                  <Button
                    onClick={() => setStep(6)}
                    disabled={!canContinueFromRecipients}
                    className="rounded-xl"
                    data-testid="button-next-step5"
                  >
                    {t("sendWhisp.common.review")} <ArrowRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>
              </div>
            )}

            {/* Step 6: Confirm + Send */}
            {step === 6 && (
              <div className="space-y-4">
                {/* The mark sits opposite the heading on the final step —
                    the last screen before something goes out anonymously is
                    the one worth signing. */}
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-xl font-serif font-semibold">{t("sendWhisp.step6.heading")}</h2>
                  <Logo className="h-8 w-auto shrink-0 text-primary" aria-hidden />
                </div>
                <div className="space-y-2 text-sm">
                  {videoMeta?.noPreview ? (
                    <div className="flex gap-3 p-3 bg-muted/30 rounded-xl items-center" data-testid="review-video-preview-card">
                      <div className="w-20 h-14 bg-muted rounded-lg flex items-center justify-center shrink-0">
                        <PlatformIcon platform={videoMeta.platform} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground capitalize">{t("sendWhisp.step2.platformLink", { platform: videoMeta.platform })}</p>
                        <p className="text-xs text-muted-foreground truncate">{videoUrl}</p>
                      </div>
                    </div>
                  ) : (videoMeta?.thumbnail || videoMeta?.title) && (
                    <div className="flex gap-3 p-3 bg-muted/30 rounded-xl items-center" data-testid="review-video-preview-card">
                      {videoMeta.thumbnail ? (
                        <Thumbnail src={videoMeta.thumbnail} alt="thumbnail" className="w-20 h-14 object-cover rounded-lg" />
                      ) : (
                        <div className="w-20 h-14 bg-muted rounded-lg flex items-center justify-center shrink-0">
                          <PlayCircle className="w-5 h-5 text-muted-foreground" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <PlatformIcon platform={videoMeta.platform} />
                          <span className="text-xs text-muted-foreground capitalize">{videoMeta.platform}</span>
                        </div>
                        <p className="text-sm font-medium text-foreground truncate">{videoMeta.title || videoUrl}</p>
                      </div>
                    </div>
                  )}
                  <div className="p-3 bg-muted/30 rounded-xl space-y-2">
                    {moodTag && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t("sendWhisp.step6.mood")}</span>
                        <MoodTag mood={moodTag} />
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("sendWhisp.step6.signedAs")}</span>
                      <span className="text-foreground">{customAlias || senderAlias}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("sendWhisp.step6.delivery")}</span>
                      <span className="text-foreground capitalize">
                        {deliveryMethod === "group_whisper"
                          ? t("sendWhisp.step6.groupWhisperChannel", { channel: t(`sendWhisp.channels.${whisperChannel}`) })
                          : deliveryMethod === "whisper_link"
                          ? `Whisper Link${hasPhoneRecipient && preferWhatsApp ? " (WhatsApp)" : ""}`
                          : deliveryMethod.replace("_", " ")}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("sendWhisp.step6.to")}</span>
                      <span className="text-foreground">
                        {deliveryMethod === "ghost_boost"
                          ? t("sendWhisp.step6.matchedSubscribers")
                          : deliveryMethod === "group_whisper"
                          ? (() => {
                              const g = myWhisperGroups?.find((g) => g.id === whisperGroupId);
                              return g
                                ? t("sendWhisp.step6.groupSummary", { name: g.name, members: t("shared.memberCount", { count: g.memberCount }) })
                                : t("sendWhisp.step6.groupFallback");
                            })()
                          : parsedRecipients.recipients.map((r) => r.raw).join(", ")}
                      </span>
                    </div>
                    {startTimestamp && parsedStartSeconds !== null && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t("sendWhisp.step6.startsAt")}</span>
                        <span className="text-foreground">{startTimestamp}</span>
                      </div>
                    )}
                    {endTimestamp && parsedEndSeconds !== null && !trimError && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t("sendWhisp.step6.endsAt")}</span>
                        <span className="text-foreground">{endTimestamp}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{t("sendWhisp.step6.when")}</span>
                      <span className="text-foreground">
                        {scheduleEnabled && deliveryMethod !== "ghost_boost" && scheduledAtValue
                          ? new Date(scheduledAtValue).toLocaleString(undefined, {
                              dateStyle: "medium",
                              timeStyle: "short",
                            })
                          : t("sendWhisp.step6.rightNow")}
                      </span>
                    </div>
                    {anonymousNote && (
                      <div className="border-t border-border/50 pt-2">
                        <span className="text-muted-foreground block mb-1">{t("sendWhisp.step6.yourNote")}</span>
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
                    <ArrowLeft className="w-4 h-4 mr-1" /> {t("sendWhisp.common.back")}
                  </Button>
                  <Button
                    onClick={() => handleSend()}
                    disabled={createWhisp.isPending || sendGroupWhisp.isPending || sendingBatch}
                    className="rounded-full shadow-[0_0_15px_rgba(124,92,252,0.3)] px-6"
                    data-testid="button-send-whisp"
                  >
                    {createWhisp.isPending || sendGroupWhisp.isPending || sendingBatch ? (
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    ) : (
                      <Send className="w-4 h-4 mr-2" />
                    )}
                    {t("sendWhisp.step6.sendButton")}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <DemographicsGateDialog
        open={showDemographicsGate}
        onConfirmed={() => {
          setShowDemographicsGate(false);
          void handleSend({ skipDemographicsCheck: true });
        }}
      />
    </AppLayout>
  );
}
