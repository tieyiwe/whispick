import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CameraOff, SwitchCamera, CircleStop, RotateCcw, AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { uploadMedia, UploadValidationError, MAX_UPLOAD_DURATION_SECONDS, type UploadedVideoResult } from "@/lib/uploadMedia";
import {
  PHOTO_CLIP_DURATION_SECONDS,
  encodeCanvasAsClip,
  describeGetUserMediaError,
  formatMMSS,
  getCameraUnsupportedReason,
  isPhotoClipSupported,
  pickRecorderMimeType,
} from "@/lib/cameraCapture";

type CameraPhase = "idle" | "requesting" | "denied" | "live" | "reviewing" | "uploading";
type CaptureMode = "photo" | "video";

interface CameraCaptureProps {
  // Fires once the capture has actually gone through uploadMedia.ts's
  // pipeline and produced a real uploaded-media record — same shape
  // handleFileSelect/handleLibrarySelect already consume in SendWhisp.tsx.
  onUploaded: (result: UploadedVideoResult) => void;
}

// State machine: idle -> requesting -> (denied | live) -> reviewing ->
// (uploading -> onUploaded()) | back to reviewing on upload failure.
// "Retake" from reviewing goes back through requesting -> live.
export function CameraCapture({ onUploaded }: CameraCaptureProps) {
  const unsupportedReason = getCameraUnsupportedReason();
  const photoClipSupported = isPhotoClipSupported();

  const [phase, setPhase] = useState<CameraPhase>("idle");
  const [captureMode, setCaptureMode] = useState<CaptureMode>("photo");
  const [facingMode, setFacingMode] = useState<"user" | "environment">("user");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);

  const [isRecording, setIsRecording] = useState(false);
  const [recordedSeconds, setRecordedSeconds] = useState(0);

  const [reviewUrl, setReviewUrl] = useState<string | null>(null);
  const [reviewKind, setReviewKind] = useState<CaptureMode | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [isPreparingPhoto, setIsPreparingPhoto] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<BlobPart[]>([]);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Bumped on every Retake so a photo-clip encode still running in the
  // background (it takes PHOTO_CLIP_DURATION_SECONDS in realtime, see
  // cameraCapture.ts) can't land its result after the user moved on.
  const photoEncodeTokenRef = useRef(0);

  // Guards every async completion below (permission prompts, the photo
  // encode, the upload call) — the tab can be switched away from (unmounting
  // this component, see the render-time cleanup effects) while any of those
  // is still in flight, and none of them should call setState afterward.
  const isMountedRef = useRef(true);
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Camera hardware (and the OS's "in use" indicator) must never outlive
  // this component or a phase where it's actually needed.
  useEffect(() => {
    return () => {
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [stream]);

  useEffect(() => {
    return () => {
      if (reviewUrl) URL.revokeObjectURL(reviewUrl);
    };
  }, [reviewUrl]);

  useEffect(() => {
    return () => {
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  const stopStream = useCallback(() => {
    setStream((current) => {
      current?.getTracks().forEach((t) => t.stop());
      return null;
    });
  }, []);

  const requestCamera = useCallback(
    async (mode: CaptureMode, nextFacingMode: "user" | "environment") => {
      if (unsupportedReason) return;
      setPhase("requesting");
      setErrorMessage(null);

      // Release whatever camera is currently held BEFORE asking for a new
      // one — not after, which is what this used to do. Flipping from front
      // to back is really "stop this track, start a different one," and
      // most mobile browsers/OSes can't hold both open at once: a still-live
      // front-camera track makes the very next getUserMedia() call for the
      // back camera fail with NotReadableError ("already in use by another
      // app"), even though nothing else is actually using it — the previous
      // request from THIS component is. A brief pause after stopping gives
      // the OS a moment to actually release the hardware before the next
      // request comes in; skipped on the very first request, where there's
      // nothing to release yet.
      const hadPreviousStream = stream !== null;
      if (hadPreviousStream) {
        setStream((current) => {
          current?.getTracks().forEach((t) => t.stop());
          return null;
        });
        await new Promise((resolve) => setTimeout(resolve, 250));
        if (!isMountedRef.current) return;
      }

      try {
        const nextStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: nextFacingMode },
          // Only ask for the mic when it'll actually be used — fewer
          // permission prompts, and no mic indicator lit for a still photo.
          audio: mode === "video",
        });
        if (!isMountedRef.current) {
          // Tab was switched away from while the permission prompt was up —
          // don't leave a camera silently running for an unmounted component.
          nextStream.getTracks().forEach((t) => t.stop());
          return;
        }
        setStream((current) => {
          // Belt-and-suspenders: stop anything unexpectedly still set (e.g.
          // a stream acquired by an overlapping call) rather than leaking it.
          current?.getTracks().forEach((t) => t.stop());
          return nextStream;
        });
        setFacingMode(nextFacingMode);
        setPhase("live");
      } catch (err) {
        if (!isMountedRef.current) return;
        setErrorMessage(describeGetUserMediaError(err));
        setPhase("denied");
      }
    },
    [unsupportedReason, stream],
  );

  function handleModeChange(mode: CaptureMode) {
    if (mode === captureMode) return;
    setCaptureMode(mode);
    // Audio track requirement differs by mode (video wants the mic, photo
    // doesn't) — re-requesting is the only way to actually pick up that
    // constraint change while the stream is already live.
    if (phase === "live") void requestCamera(mode, facingMode);
  }

  function handleFlipCamera() {
    const next = facingMode === "user" ? "environment" : "user";
    void requestCamera(captureMode, next);
  }

  async function prepareEncodedPhoto(canvas: HTMLCanvasElement) {
    const token = ++photoEncodeTokenRef.current;
    const mime = pickRecorderMimeType();
    if (!mime) {
      setErrorMessage("This browser can't prepare a photo for sending — try Video instead.");
      return;
    }
    setIsPreparingPhoto(true);
    try {
      const clipBlob = await encodeCanvasAsClip(canvas, mime.recordType, PHOTO_CLIP_DURATION_SECONDS);
      // Stale if either retaken (token bumped) or the component unmounted
      // (tab switched away from) while this ran in the background.
      if (photoEncodeTokenRef.current !== token || !isMountedRef.current) return;
      setPendingFile(new File([clipBlob], `photo-${Date.now()}.${mime.extension}`, { type: mime.uploadMimeType }));
    } catch {
      if (photoEncodeTokenRef.current !== token || !isMountedRef.current) return;
      setErrorMessage("Couldn't prepare that photo for sending. Please retake it.");
    } finally {
      if (photoEncodeTokenRef.current === token && isMountedRef.current) setIsPreparingPhoto(false);
    }
  }

  function takePhoto() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setErrorMessage("Couldn't capture a photo from the camera.");
      return;
    }
    ctx.drawImage(video, 0, 0, width, height);

    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setErrorMessage("Couldn't capture a photo from the camera.");
          return;
        }
        setReviewUrl(URL.createObjectURL(blob));
        setReviewKind("photo");
        setPhase("reviewing");
        stopStream();

        if (!photoClipSupported) {
          setErrorMessage("Photos can't be prepared for sending in this browser — try Video instead, or Retake.");
          return;
        }
        void prepareEncodedPhoto(canvas);
      },
      "image/jpeg",
      0.9,
    );
  }

  function startRecording() {
    if (!stream) return;
    const mime = pickRecorderMimeType();
    if (!mime) {
      setErrorMessage("This browser can't record video — try Photo or Upload instead.");
      return;
    }
    recordedChunksRef.current = [];
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType: mime.recordType, videoBitsPerSecond: 2_000_000 });
    } catch {
      setErrorMessage("Couldn't start recording. Please try again.");
      return;
    }
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      if (recordTimerRef.current) {
        clearInterval(recordTimerRef.current);
        recordTimerRef.current = null;
      }
      if (!isMountedRef.current) return; // unmounted (tab switched away) mid-recording
      const blob = new Blob(recordedChunksRef.current, { type: mime.recordType });
      setPendingFile(new File([blob], `video-${Date.now()}.${mime.extension}`, { type: mime.uploadMimeType }));
      setReviewUrl(URL.createObjectURL(blob));
      setReviewKind("video");
      setPhase("reviewing");
      setIsRecording(false);
      stopStream();
    };
    mediaRecorderRef.current = recorder;
    recorder.start();
    setIsRecording(true);
    setRecordedSeconds(0);
    // Client-side enforcement of the same cap the Upload tab documents —
    // auto-stops the recording rather than only rejecting it afterward.
    recordTimerRef.current = setInterval(() => {
      setRecordedSeconds((s) => {
        const next = s + 1;
        if (next >= MAX_UPLOAD_DURATION_SECONDS) stopRecording();
        return next;
      });
    }, 1000);
  }

  function stopRecording() {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  }

  function handleRetake() {
    photoEncodeTokenRef.current++;
    if (reviewUrl) URL.revokeObjectURL(reviewUrl);
    setReviewUrl(null);
    setReviewKind(null);
    setPendingFile(null);
    setIsPreparingPhoto(false);
    setErrorMessage(null);
    void requestCamera(captureMode, facingMode);
  }

  async function handleConfirm() {
    if (!pendingFile) return;
    setPhase("uploading");
    setErrorMessage(null);
    try {
      const result = await uploadMedia(pendingFile);
      // If the sender switched away from the Camera tab mid-upload, this
      // component is already unmounted — the upload still completed and
      // landed in their Media Library, but don't reach back in and jump
      // the (now different) composer state to step 2 out from under them.
      if (!isMountedRef.current) return;
      onUploaded(result);
    } catch (err) {
      if (!isMountedRef.current) return;
      setErrorMessage(err instanceof UploadValidationError ? err.message : err instanceof Error ? err.message : "Upload failed. Please try again.");
      setPhase("reviewing");
    }
  }

  if (unsupportedReason) {
    return (
      <div
        className="flex flex-col items-center gap-2 border-2 border-dashed border-border/60 rounded-xl py-10 px-4 text-center"
        data-testid="camera-unsupported"
      >
        <CameraOff className="w-6 h-6 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{unsupportedReason}</p>
        <p className="text-xs text-muted-foreground">Use Upload or Paste a link instead.</p>
      </div>
    );
  }

  const modeToggle = (
    <div className="flex gap-1 p-0.5 bg-muted/40 rounded-lg w-fit">
      {([
        { key: "photo" as const, label: "Photo" },
        { key: "video" as const, label: "Video" },
      ]).map((m) => (
        <button
          key={m.key}
          type="button"
          onClick={() => handleModeChange(m.key)}
          disabled={isRecording || phase === "uploading"}
          data-testid={`camera-mode-${m.key}`}
          className={`px-3 py-1 rounded-md text-xs font-medium transition-colors disabled:opacity-50 ${
            captureMode === m.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
          }`}
        >
          {m.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="space-y-3">
      <canvas ref={canvasRef} className="hidden" />

      {(phase === "idle" || phase === "denied") && (
        <div className="space-y-3">
          {modeToggle}
          <div
            className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-border/60 rounded-xl py-10 px-4 text-center"
            data-testid="camera-idle"
          >
            {phase === "denied" ? (
              <>
                <AlertTriangle className="w-6 h-6 text-destructive" />
                <p className="text-sm text-destructive">{errorMessage}</p>
                <p className="text-xs text-muted-foreground">Upload and Paste a link are still available if this doesn't work.</p>
              </>
            ) : (
              <>
                <Camera className="w-6 h-6 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  {captureMode === "photo" ? "Take a photo with your camera" : "Record a short video with your camera"}
                </p>
              </>
            )}
            <Button
              type="button"
              onClick={() => void requestCamera(captureMode, facingMode)}
              className="rounded-xl mt-1"
              data-testid={phase === "denied" ? "button-camera-retry" : "button-camera-enable"}
            >
              <Camera className="w-4 h-4 mr-1.5" /> {phase === "denied" ? "Try again" : "Enable camera"}
            </Button>
          </div>
        </div>
      )}

      {phase === "requesting" && (
        <div className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-border/60 rounded-xl py-10 px-4 text-center" data-testid="camera-requesting">
          <Loader2 className="w-6 h-6 text-muted-foreground animate-spin" />
          <p className="text-sm text-muted-foreground">Requesting camera access…</p>
        </div>
      )}

      {phase === "live" && (
        <div className="space-y-3">
          {modeToggle}
          <div className="relative rounded-xl overflow-hidden bg-black aspect-video" data-testid="camera-live">
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="w-full h-full object-cover"
              style={facingMode === "user" ? { transform: "scaleX(-1)" } : undefined}
            />
            <button
              type="button"
              onClick={handleFlipCamera}
              disabled={isRecording}
              data-testid="button-camera-flip"
              className="absolute top-2 right-2 p-2 rounded-full bg-background/70 text-foreground hover:bg-background/90 transition-colors disabled:opacity-50"
              aria-label="Flip camera"
            >
              <SwitchCamera className="w-4 h-4" />
            </button>
            {captureMode === "video" && isRecording && (
              <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-1 rounded-full bg-background/70 text-xs font-medium text-foreground">
                <span className="w-2 h-2 rounded-full bg-destructive animate-pulse" />
                {formatMMSS(recordedSeconds)} / {formatMMSS(MAX_UPLOAD_DURATION_SECONDS)}
              </div>
            )}
          </div>

          {errorMessage && <p className="text-sm text-destructive">{errorMessage}</p>}

          <div className="flex justify-center">
            {captureMode === "photo" ? (
              <Button type="button" onClick={takePhoto} className="rounded-full px-6" data-testid="button-take-photo">
                <Camera className="w-4 h-4 mr-1.5" /> Take Photo
              </Button>
            ) : isRecording ? (
              <Button type="button" variant="destructive" onClick={stopRecording} className="rounded-full px-6" data-testid="button-stop-recording">
                <CircleStop className="w-4 h-4 mr-1.5" /> Stop
              </Button>
            ) : (
              <Button type="button" onClick={startRecording} className="rounded-full px-6" data-testid="button-start-recording">
                <span className="w-3 h-3 rounded-full bg-destructive-foreground mr-1.5" /> Start Recording
              </Button>
            )}
          </div>
        </div>
      )}

      {phase === "reviewing" && (
        <div className="space-y-3" data-testid="camera-reviewing">
          <div className="relative rounded-xl overflow-hidden bg-black aspect-video flex items-center justify-center">
            {reviewKind === "photo" ? (
              // eslint-disable-next-line jsx-a11y/img-redundant-alt
              <img src={reviewUrl ?? undefined} alt="Captured photo" className="w-full h-full object-cover" />
            ) : (
              <video src={reviewUrl ?? undefined} controls playsInline className="w-full h-full object-contain" />
            )}
            {isPreparingPhoto && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/70">
                <Loader2 className="w-5 h-5 text-foreground animate-spin" />
                <p className="text-xs font-medium text-foreground">Preparing your photo…</p>
              </div>
            )}
          </div>

          {errorMessage && <p className="text-sm text-destructive">{errorMessage}</p>}

          <div className="flex justify-between gap-2">
            <Button type="button" variant="outline" onClick={handleRetake} className="rounded-xl" data-testid="button-camera-retake">
              <RotateCcw className="w-4 h-4 mr-1.5" /> Retake
            </Button>
            <Button
              type="button"
              onClick={handleConfirm}
              disabled={!pendingFile || isPreparingPhoto}
              className="rounded-xl"
              data-testid="button-camera-confirm"
            >
              {isPreparingPhoto ? (
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              ) : (
                <Camera className="w-4 h-4 mr-1.5" />
              )}
              Use this {reviewKind === "photo" ? "photo" : "video"}
            </Button>
          </div>
        </div>
      )}

      {phase === "uploading" && (
        <div className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-border/60 rounded-xl py-10 px-4 text-center" data-testid="camera-uploading">
          <Loader2 className="w-6 h-6 text-muted-foreground animate-spin" />
          <p className="text-sm text-muted-foreground">Uploading…</p>
        </div>
      )}
    </div>
  );
}
