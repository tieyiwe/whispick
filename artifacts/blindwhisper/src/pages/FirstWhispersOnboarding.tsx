import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import {
  useCreateWhisperGroup,
  useAddWhisperGroupMembers,
  useGetConciergeSuggestions,
  useSendGroupWhisp,
  useScrapeVideoMeta,
  useGetUserProfile,
  getGetWhispStatsQueryKey,
  getListWhispsQueryKey,
  getListWhisperGroupsQueryKey,
  type SuggestedVideo,
  type SkippedGroupMember,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Thumbnail } from "@/components/shared/Thumbnail";
import { PlatformIcon } from "@/components/shared/PlatformIcon";
import { DemographicsGateDialog } from "@/components/shared/DemographicsGateDialog";
import { needsDemographics } from "@/lib/demographics";
import { isContactPickerSupported, pickContacts } from "@/lib/contactPicker";
import {
  ArrowLeft,
  ArrowRight,
  Loader2,
  Mail,
  Phone,
  Plus,
  Trash2,
  Contact,
  Sparkles,
  PlayCircle,
  Link2,
  UsersRound,
  CheckCircle2,
  RefreshCw,
} from "lucide-react";
import { SiWhatsapp } from "react-icons/si";

const MAX_CONTACTS = 5;
const MAX_NOTE_LENGTH = 200;

type OnboardingContact = { id: string; name: string; email: string; phone: string };

function emptyContact(): OnboardingContact {
  return { id: crypto.randomUUID(), name: "", email: "", phone: "" };
}

type SelectedVideo = {
  videoUrl: string;
  videoTitle: string | null;
  videoThumbnail: string | null;
  videoEmbedUrl: string | null;
  videoPlatform: string | null;
  authorName?: string | null;
};

const CHANNEL_ICONS = { email: Mail, sms: Phone, whatsapp: SiWhatsapp } as const;

// The "send your first Whispers to a few friends at once" cold-start growth
// flow — a guided, three-step alternative to /send for a brand-new account's
// very first send (the NGL/Sendit "fan out to several contacts in one go"
// trick). Everything here reuses existing Whisper Group + concierge
// endpoints (POST /whisper-groups, POST /whisper-groups/:id/members, POST
// /whisps/concierge, POST /whisper-groups/:id/send) — there is no dedicated
// backend for this flow. The group it creates is a real, ordinary Whisper
// Group that persists and shows up in /whisper-groups afterward, same as
// one a returning sender builds by hand.
export function FirstWhispersOnboarding() {
  const { t } = useTranslation("firstWhispers");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: profile } = useGetUserProfile();

  const [step, setStep] = useState<1 | 2 | 3>(1);

  // --- Step 1: contacts ---
  const [contacts, setContacts] = useState<OnboardingContact[]>([emptyContact()]);

  // --- Step 2: what to send ---
  const [situation, setSituation] = useState(() => t("concierge.defaultSituation"));
  const [conciergeRan, setConciergeRan] = useState(false);
  const [videoSuggestions, setVideoSuggestions] = useState<SuggestedVideo[]>([]);
  const [noteDraft, setNoteDraft] = useState<string | null>(null);
  const [conciergeRequestId, setConciergeRequestId] = useState<string | null>(null);
  const [selectedVideo, setSelectedVideo] = useState<SelectedVideo | null>(null);
  const [note, setNote] = useState("");
  const [noteTouched, setNoteTouched] = useState(false);
  const [showCustomSituation, setShowCustomSituation] = useState(false);
  const [showCustomUrl, setShowCustomUrl] = useState(false);
  const [customUrl, setCustomUrl] = useState("");
  const [customUrlError, setCustomUrlError] = useState<string | null>(null);

  // --- Step 3: channel + send ---
  const [selectedChannel, setSelectedChannel] = useState<"email" | "sms" | "whatsapp" | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showDemographicsGate, setShowDemographicsGate] = useState(false);
  const [result, setResult] = useState<{ groupSendId: string; memberCount: number; skippedMembers: SkippedGroupMember[] } | null>(null);

  const createWhisperGroup = useCreateWhisperGroup();
  const addWhisperGroupMembers = useAddWhisperGroupMembers();
  const conciergeMutation = useGetConciergeSuggestions();
  const scrapeMeta = useScrapeVideoMeta();
  const sendGroupWhisp = useSendGroupWhisp();

  const validContacts = contacts.filter((c) => c.email.trim() || c.phone.trim());
  const hasEmail = validContacts.some((c) => c.email.trim());
  const hasPhone = validContacts.some((c) => c.phone.trim());
  const availableChannels = (["email", "sms", "whatsapp"] as const).filter((ch) =>
    ch === "email" ? hasEmail : hasPhone,
  );

  // Default to the first channel the entered contacts actually support, and
  // re-pick whenever that set changes (e.g. going back to step 1 and
  // removing the only phone contact) so a stale, now-unavailable channel is
  // never left selected.
  useEffect(() => {
    if (selectedChannel && availableChannels.includes(selectedChannel)) return;
    setSelectedChannel(availableChannels[0] ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableChannels.join(",")]);

  function updateContact(id: string, patch: Partial<OnboardingContact>) {
    setContacts((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  function addContactRow() {
    setContacts((cs) => (cs.length >= MAX_CONTACTS ? cs : [...cs, emptyContact()]));
  }

  function removeContactRow(id: string) {
    setContacts((cs) => (cs.length <= 1 ? cs : cs.filter((c) => c.id !== id)));
  }

  async function handlePickFromContacts() {
    const picked = await pickContacts();
    if (!picked.length) return;

    const withInfo = picked.filter((c) => c.email || c.tel);
    if (!withInfo.length) {
      toast({ title: t("step1.toast.noneHadContactInfo"), variant: "destructive" });
      return;
    }

    setContacts((cs) => {
      const nonEmpty = cs.filter((c) => c.name.trim() || c.email.trim() || c.phone.trim());
      const merged = [
        ...nonEmpty,
        ...withInfo.map((c) => ({ id: crypto.randomUUID(), name: c.name ?? "", email: c.email ?? "", phone: c.tel ?? "" })),
      ];
      return merged.slice(0, MAX_CONTACTS);
    });
  }

  function goToStep2() {
    if (validContacts.length === 0) {
      toast({ title: t("step1.toast.needAtLeastOne"), variant: "destructive" });
      return;
    }
    setContacts(validContacts.length ? validContacts : contacts);
    setStep(2);
  }

  function runConcierge(situationText: string) {
    const trimmed = situationText.trim();
    if (!trimmed) return;
    conciergeMutation.mutate(
      { data: { situation: trimmed } },
      {
        onSuccess: (res) => {
          setVideoSuggestions(res.videoSuggestions);
          setNoteDraft(res.noteDraft);
          setConciergeRequestId(res.requestId);
          setConciergeRan(true);
          if (!noteTouched && res.noteDraft) setNote(res.noteDraft);
        },
        onError: () => {
          setConciergeRan(true);
        },
      },
    );
  }

  // Auto-run once, on first arrival at step 2, with the friendly default —
  // "zero typing needed" per the growth mechanic this flow is built around.
  useEffect(() => {
    if (step === 2 && !conciergeRan && !conciergeMutation.isPending) {
      runConcierge(situation);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  function handleSelectSuggestion(video: SuggestedVideo) {
    setSelectedVideo({
      videoUrl: video.videoUrl,
      videoTitle: video.videoTitle ?? null,
      videoThumbnail: video.videoThumbnail ?? null,
      videoEmbedUrl: video.videoEmbedUrl ?? null,
      videoPlatform: video.videoPlatform ?? null,
      authorName: video.authorName ?? null,
    });
    if (!noteTouched && noteDraft) setNote(noteDraft);
    setShowCustomUrl(false);
  }

  function handleCustomUrlSubmit() {
    const url = customUrl.trim();
    if (!url) return;
    try {
      new URL(url);
    } catch {
      setCustomUrlError(t("step2.customUrl.invalidUrl"));
      return;
    }
    setCustomUrlError(null);
    scrapeMeta.mutate(
      { data: { url } },
      {
        onSuccess: (meta) => {
          setSelectedVideo({
            videoUrl: url,
            videoTitle: meta.title ?? null,
            videoThumbnail: meta.thumbnail ?? null,
            videoEmbedUrl: meta.embedUrl ?? null,
            videoPlatform: meta.platform,
            authorName: meta.authorName ?? null,
          });
        },
        onError: () => {
          // Same graceful fallback as SendWhisp's own URL step: an
          // inconclusive scrape (network hiccup, an unparseable page) never
          // blocks the sender from proceeding with an unknown-metadata link.
          setSelectedVideo({ videoUrl: url, videoTitle: null, videoThumbnail: null, videoEmbedUrl: null, videoPlatform: "other" });
        },
      },
    );
  }

  async function ensureGroupWithMembers(): Promise<string> {
    if (groupId) return groupId;
    const group = await createWhisperGroup.mutateAsync({ data: { name: t("groupName") } });
    await addWhisperGroupMembers.mutateAsync({
      id: group.id,
      data: {
        members: validContacts.map((c) => ({
          name: c.name.trim() || null,
          email: c.email.trim() || null,
          phone: c.phone.trim() || null,
        })),
      },
    });
    queryClient.invalidateQueries({ queryKey: getListWhisperGroupsQueryKey() });
    setGroupId(group.id);
    return group.id;
  }

  async function attemptSend(gid: string, opts?: { skipDemographicsCheck?: boolean }) {
    if (!opts?.skipDemographicsCheck && needsDemographics(profile)) {
      setShowDemographicsGate(true);
      return;
    }
    if (!selectedVideo || !selectedChannel) {
      setIsSubmitting(false);
      return;
    }
    try {
      const res = await sendGroupWhisp.mutateAsync({
        id: gid,
        data: {
          videoUrl: selectedVideo.videoUrl,
          videoTitle: selectedVideo.videoTitle,
          videoThumbnail: selectedVideo.videoThumbnail,
          videoEmbedUrl: selectedVideo.videoEmbedUrl,
          videoPlatform: selectedVideo.videoPlatform,
          uploadedVideoId: null,
          whisperChannel: selectedChannel,
          anonymousNote: note.trim() || null,
          senderAlias: null,
          moodTag: null,
        },
      });
      setResult(res);
      queryClient.invalidateQueries({ queryKey: getGetWhispStatsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListWhispsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListWhisperGroupsQueryKey() });
      setIsSubmitting(false);
    } catch (err: any) {
      if (err?.status === 428) {
        setShowDemographicsGate(true);
        return;
      }
      toast({ title: err?.data?.error ?? t("step3.toast.sendFailed"), variant: "destructive" });
      setIsSubmitting(false);
    }
  }

  async function handleSendClick() {
    if (!selectedVideo || !selectedChannel) return;
    setIsSubmitting(true);
    try {
      const gid = await ensureGroupWithMembers();
      await attemptSend(gid);
    } catch (err: any) {
      toast({ title: err?.data?.error ?? t("step3.toast.groupSetupFailed"), variant: "destructive" });
      setIsSubmitting(false);
    }
  }

  const conciergeNoResults = conciergeRan && !conciergeMutation.isPending && videoSuggestions.length === 0;

  if (result) {
    return (
      <AppLayout>
        <div className="max-w-xl mx-auto text-center py-16 space-y-6">
          <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center pop-in">
            <CheckCircle2 className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-3xl font-serif font-bold text-foreground">{t("sent.title", { count: result.memberCount })}</h1>
          <p className="text-muted-foreground text-lg">{t("sent.description", { count: result.memberCount })}</p>

          {result.skippedMembers.length > 0 && (
            <Card className="bg-muted/20 border-border/50 text-left">
              <CardContent className="p-4 space-y-2">
                <p className="text-sm font-medium text-foreground">
                  {t("sent.skippedHeading", { count: result.skippedMembers.length })}
                </p>
                <ul className="text-sm text-muted-foreground space-y-1">
                  {result.skippedMembers.map((m) => (
                    <li key={m.id}>
                      {m.name || t("sent.skippedUnnamed")} — {m.reason}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-4">
            <Button
              variant="outline"
              className="rounded-full"
              onClick={() => setLocation(`/whisper-groups/sends/${result.groupSendId}`)}
              data-testid="button-view-group-send"
            >
              {t("sent.viewSendButton")}
            </Button>
            <Button
              className="rounded-full shadow-[0_0_15px_rgba(124,92,252,0.3)]"
              onClick={() => setLocation("/dashboard")}
              data-testid="button-go-to-dashboard"
            >
              {t("sent.dashboardButton")}
            </Button>
          </div>
        </div>
      </AppLayout>
    );
  }

  const steps = [t("steps.friends"), t("steps.whatToSend"), t("steps.send")];

  return (
    <AppLayout>
      <div className="max-w-xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">{t("header.title")}</h1>
          <p className="text-muted-foreground mt-1">{t("header.subtitle")}</p>
        </div>

        <div className="flex items-center gap-1">
          {steps.map((_, i) => (
            <div key={i} className="flex items-center gap-1">
              <div
                className={`h-2 rounded-full transition-all ${
                  i + 1 < step ? "w-2 bg-primary" : i + 1 === step ? "w-6 bg-primary" : "w-2 bg-border"
                }`}
              />
            </div>
          ))}
          <span className="ml-2 text-xs text-muted-foreground">{t("stepIndicator", { step, total: steps.length })}</span>
        </div>

        <Card className="bg-card border-border/50 overflow-hidden">
          <CardContent className="p-6 space-y-5">
            {/* Step 1: add friends */}
            {step === 1 && (
              <div className="space-y-4 step-in">
                <h2 className="text-xl font-serif font-semibold">{t("step1.heading")}</h2>
                <p className="text-sm text-muted-foreground">{t("step1.subtitle")}</p>

                <div className="space-y-3">
                  {contacts.map((c, i) => (
                    <div key={c.id} className="p-3 rounded-xl border border-border/50 bg-muted/10 space-y-2" data-testid={`contact-row-${i}`}>
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                          <span className="flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-[11px] font-semibold shrink-0">
                            {i + 1}
                          </span>
                          {t("step1.friendLabel", { number: i + 1 })}
                        </span>
                        {contacts.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeContactRow(c.id)}
                            className="text-muted-foreground hover:text-destructive transition-colors"
                            aria-label={t("step1.removeContact")}
                            data-testid={`button-remove-contact-${i}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      <Input
                        className="bg-input/50 border-border/50 rounded-xl"
                        placeholder={t("step1.namePlaceholder")}
                        value={c.name}
                        onChange={(e) => updateContact(c.id, { name: e.target.value })}
                        data-testid={`input-contact-name-${i}`}
                      />
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <Input
                          type="email"
                          className="bg-input/50 border-border/50 rounded-xl"
                          placeholder={t("step1.emailPlaceholder")}
                          value={c.email}
                          onChange={(e) => updateContact(c.id, { email: e.target.value })}
                          data-testid={`input-contact-email-${i}`}
                        />
                        <Input
                          type="tel"
                          className="bg-input/50 border-border/50 rounded-xl"
                          placeholder={t("step1.phonePlaceholder")}
                          value={c.phone}
                          onChange={(e) => updateContact(c.id, { phone: e.target.value })}
                          data-testid={`input-contact-phone-${i}`}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap gap-2">
                  {contacts.length < MAX_CONTACTS && (
                    <Button variant="outline" size="sm" className="rounded-full" onClick={addContactRow} data-testid="button-add-contact-row">
                      <Plus className="w-3.5 h-3.5 mr-1.5" /> {t("step1.addAnother")}
                    </Button>
                  )}
                  {isContactPickerSupported() && contacts.length < MAX_CONTACTS && (
                    <Button variant="outline" size="sm" className="rounded-full" onClick={handlePickFromContacts} data-testid="button-pick-from-contacts">
                      <Contact className="w-3.5 h-3.5 mr-1.5" /> {t("step1.pickFromContacts")}
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{t("step1.upToCount", { count: MAX_CONTACTS })}</p>

                <div className="flex justify-end pt-2">
                  <Button onClick={goToStep2} className="rounded-xl" data-testid="button-next-step1">
                    {t("common.next")} <ArrowRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>
              </div>
            )}

            {/* Step 2: pick something to send */}
            {step === 2 && (
              <div className="space-y-4 step-in">
                <h2 className="text-xl font-serif font-semibold flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-primary" /> {t("step2.heading")}
                </h2>
                <p className="text-sm text-muted-foreground">{t("step2.subtitle")}</p>

                {conciergeMutation.isPending && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                    <Loader2 className="w-4 h-4 animate-spin" /> {t("step2.loading")}
                  </div>
                )}

                {!conciergeMutation.isPending && videoSuggestions.length > 0 && !selectedVideo && (
                  <div className="grid grid-cols-1 gap-2" data-testid="concierge-suggestions">
                    {videoSuggestions.map((video) => (
                      <button
                        key={video.id}
                        type="button"
                        onClick={() => handleSelectSuggestion(video)}
                        data-testid={`button-suggestion-${video.id}`}
                        className="flex gap-3 p-2.5 rounded-xl border border-border/50 bg-muted/20 text-left hover:border-primary/50 hover:bg-primary/5 transition-colors"
                      >
                        <div className="w-16 h-12 flex-shrink-0 bg-muted rounded-lg overflow-hidden flex items-center justify-center">
                          {video.videoThumbnail ? (
                            <Thumbnail src={video.videoThumbnail} alt={video.videoTitle ?? ""} className="w-full h-full object-cover" />
                          ) : (
                            <PlayCircle className="w-5 h-5 text-muted-foreground" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <PlatformIcon platform={video.videoPlatform} className="w-3 h-3" />
                            <span className="text-[11px] text-muted-foreground capitalize">{video.videoPlatform}</span>
                          </div>
                          <p className="text-sm font-medium text-foreground truncate">{video.videoTitle || t("step2.untitledVideo")}</p>
                          {video.aiSummary && <p className="text-xs text-muted-foreground line-clamp-2">{video.aiSummary}</p>}
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {conciergeNoResults && !selectedVideo && (
                  <p className="text-sm text-muted-foreground" data-testid="text-no-suggestions">
                    {t("step2.noMatch")}
                  </p>
                )}

                {selectedVideo && (
                  <div className="flex gap-3 p-3 bg-muted/30 rounded-xl items-center" data-testid="selected-video-preview">
                    {selectedVideo.videoThumbnail ? (
                      <Thumbnail src={selectedVideo.videoThumbnail} alt="thumbnail" className="w-16 h-12 object-cover rounded-lg" />
                    ) : (
                      <div className="w-16 h-12 bg-muted rounded-lg flex items-center justify-center shrink-0">
                        <PlayCircle className="w-5 h-5 text-muted-foreground" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <PlatformIcon platform={selectedVideo.videoPlatform} />
                        <span className="text-xs text-muted-foreground capitalize">{selectedVideo.videoPlatform}</span>
                      </div>
                      <p className="text-sm font-medium text-foreground truncate">{selectedVideo.videoTitle || t("step2.videoFallback")}</p>
                    </div>
                    <Button variant="ghost" size="sm" className="rounded-full shrink-0" onClick={() => setSelectedVideo(null)} data-testid="button-change-video">
                      {t("step2.changeVideo")}
                    </Button>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setShowCustomSituation((v) => !v)}
                    className="text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                    data-testid="button-toggle-custom-situation"
                  >
                    {t("step2.tryDifferentSituation")}
                  </button>
                  <span className="text-xs text-muted-foreground">·</span>
                  <button
                    type="button"
                    onClick={() => setShowCustomUrl((v) => !v)}
                    className="text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                    data-testid="button-toggle-custom-url"
                  >
                    {t("step2.pasteOwnLink")}
                  </button>
                </div>

                {showCustomSituation && (
                  <div className="space-y-2 pt-1">
                    <Textarea
                      className="bg-input/50 border-border/50 rounded-xl min-h-[70px] resize-none"
                      placeholder={t("step2.situationPlaceholder")}
                      maxLength={500}
                      value={situation}
                      onChange={(e) => setSituation(e.target.value)}
                      data-testid="textarea-custom-situation"
                    />
                    <Button
                      size="sm"
                      className="rounded-xl"
                      disabled={conciergeMutation.isPending || !situation.trim()}
                      onClick={() => runConcierge(situation)}
                      data-testid="button-rerun-concierge"
                    >
                      {conciergeMutation.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1.5" />}
                      {t("step2.getNewSuggestions")}
                    </Button>
                  </div>
                )}

                {showCustomUrl && (
                  <div className="space-y-2 pt-1">
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                          className="pl-9 bg-input/50 border-border/50 rounded-xl"
                          placeholder={t("step2.customUrl.placeholder")}
                          value={customUrl}
                          onChange={(e) => setCustomUrl(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && handleCustomUrlSubmit()}
                          data-testid="input-custom-video-url"
                        />
                      </div>
                      <Button onClick={handleCustomUrlSubmit} disabled={scrapeMeta.isPending} className="rounded-xl" data-testid="button-fetch-custom-video">
                        {scrapeMeta.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                      </Button>
                    </div>
                    {customUrlError && <p className="text-sm text-destructive">{customUrlError}</p>}
                  </div>
                )}

                {selectedVideo && (
                  <div className="space-y-1.5 pt-1">
                    <p className="text-sm font-medium text-foreground">{t("step2.noteLabel")}</p>
                    <div className="relative">
                      <Textarea
                        className="bg-input/50 border-border/50 rounded-xl min-h-[80px] resize-none"
                        placeholder={t("step2.notePlaceholder")}
                        maxLength={MAX_NOTE_LENGTH}
                        value={note}
                        onChange={(e) => {
                          setNote(e.target.value);
                          setNoteTouched(true);
                        }}
                        data-testid="textarea-note"
                      />
                      <span className="absolute bottom-2 right-3 text-xs text-muted-foreground">{note.length}/{MAX_NOTE_LENGTH}</span>
                    </div>
                  </div>
                )}

                <div className="flex justify-between pt-2">
                  <Button variant="ghost" onClick={() => setStep(1)} className="rounded-xl text-muted-foreground">
                    <ArrowLeft className="w-4 h-4 mr-1" /> {t("common.back")}
                  </Button>
                  <Button onClick={() => setStep(3)} disabled={!selectedVideo} className="rounded-xl" data-testid="button-next-step2">
                    {t("common.next")} <ArrowRight className="w-4 h-4 ml-1" />
                  </Button>
                </div>
              </div>
            )}

            {/* Step 3: channel + send */}
            {step === 3 && (
              <div className="space-y-4 step-in">
                <h2 className="text-xl font-serif font-semibold">{t("step3.heading")}</h2>
                <p className="text-sm text-muted-foreground">
                  {t("step3.subtitle", { count: validContacts.length })}
                </p>

                <div className="flex items-center gap-2 p-3 rounded-xl bg-muted/20 border border-border/50">
                  <UsersRound className="w-4 h-4 text-primary shrink-0" />
                  <p className="text-sm text-foreground truncate">
                    {validContacts.map((c) => c.name.trim() || c.email || c.phone).join(", ")}
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {availableChannels.map((ch) => {
                    const Icon = CHANNEL_ICONS[ch];
                    return (
                      <button
                        key={ch}
                        type="button"
                        onClick={() => setSelectedChannel(ch)}
                        data-testid={`channel-${ch}`}
                        className={`flex flex-col items-center gap-1 py-2.5 rounded-xl border text-xs font-medium transition-all ${
                          selectedChannel === ch
                            ? "border-primary bg-primary/10 text-foreground"
                            : "border-border/50 text-muted-foreground hover:border-border"
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                        {t(`step3.channels.${ch}`)}
                      </button>
                    );
                  })}
                </div>

                {selectedVideo && (
                  <div className="flex gap-3 p-3 bg-muted/30 rounded-xl items-center">
                    {selectedVideo.videoThumbnail ? (
                      <Thumbnail src={selectedVideo.videoThumbnail} alt="thumbnail" className="w-16 h-12 object-cover rounded-lg" />
                    ) : (
                      <div className="w-16 h-12 bg-muted rounded-lg flex items-center justify-center shrink-0">
                        <PlayCircle className="w-5 h-5 text-muted-foreground" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{selectedVideo.videoTitle || t("step2.videoFallback")}</p>
                      {note && <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">"{note}"</p>}
                    </div>
                  </div>
                )}

                <div className="flex justify-between pt-2">
                  <Button variant="ghost" onClick={() => setStep(2)} className="rounded-xl text-muted-foreground" disabled={isSubmitting}>
                    <ArrowLeft className="w-4 h-4 mr-1" /> {t("common.back")}
                  </Button>
                  <Button
                    onClick={handleSendClick}
                    disabled={isSubmitting || !selectedChannel || !selectedVideo}
                    className="rounded-xl shadow-[0_0_15px_rgba(124,92,252,0.3)]"
                    data-testid="button-send-first-whispers"
                  >
                    {isSubmitting ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : null}
                    {t("step3.sendButton", { count: validContacts.length })}
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
          if (groupId) void attemptSend(groupId, { skipDemographicsCheck: true });
        }}
      />
    </AppLayout>
  );
}
