"use client";
import { Button } from "../../components/ui";

import { useCallback, useEffect, useRef, useState } from "react";
import { UsageCutoffBanner, isCutoffError } from "../../components/usage-cutoff-banner";
import { queueVoiceCapture, stableClientId } from "../../lib/scout-offline";
import type { ScoutVoiceView } from "../../lib/scout-voice/compute-scout-voice";
import type { ScoutVoiceSttSource } from "../../lib/scout-voice/types";

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};

function browserSpeechAvailable(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as typeof window & {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
}

function voiceSourceLabel(source: ScoutVoiceSttSource): string {
  switch (source) {
    case "browser":
      return "This computer";
    case "cloud":
      return "Cloud";
    case "manual":
      return "Typed";
    default: {
      const _never: never = source;
      return _never;
    }
  }
}

function createSpeechRecognition(): SpeechRecognitionLike | null {
  if (typeof window === "undefined") return null;
  const w = window as typeof window & {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

type Props = {
  orgId: string;
  eventKey: string | null;
  matchKey: string;
  teamKey: string;
  entryType: "match" | "pit";
  /** Notes attach to this client id; form fill is optional via onApplyToForm. */
  pendingEntryClientId: string | null;
  /** Published custom-form fields available for optional speech → form fill. */
  formFields?: Array<{ key: string; label: string }>;
  /** Apply a reviewed transcript onto the open custom form (caller owns payload merge). */
  onApplyToForm?: (transcript: string, fieldKey: string | null) => void;
  onStatus?: (message: string) => void;
  onQueuedMedia?: () => void;
};

export default function ScoutVoiceNotesPanel({
  orgId,
  eventKey,
  matchKey,
  teamKey,
  entryType,
  pendingEntryClientId,
  formFields = [],
  onApplyToForm,
  onStatus,
  onQueuedMedia,
}: Props) {
  const [view, setView] = useState<ScoutVoiceView | null>(null);
  const [error, setError] = useState("");
  const [cutoffCode, setCutoffCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [draft, setDraft] = useState("");
  const [formFieldKey, setFormFieldKey] = useState("");
  const [sttSource, setSttSource] = useState<ScoutVoiceSttSource>("browser");
  const [consentChecked, setConsentChecked] = useState(false);
  const [browserStt, setBrowserStt] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const load = useCallback(() => {
    setError("");
    const query = new URLSearchParams({ orgId });
    if (eventKey) query.set("eventKey", eventKey);
    if (pendingEntryClientId) query.set("entryClientId", pendingEntryClientId);
    void fetch(`/api/scout-voice?${query}`)
      .then(async (response) => {
        const data = (await response.json()) as ScoutVoiceView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Could not load voice notes.");
          return;
        }
        setView(data);
      })
      .catch(() => setError("Network error loading voice notes."));
  }, [orgId, eventKey, pendingEntryClientId]);

  useEffect(() => {
    setBrowserStt(browserSpeechAvailable());
    load();
  }, [load]);

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      setBusy(true);
      setError("");
      setCutoffCode(null);
      try {
        const response = await fetch("/api/scout-voice", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            orgId,
            eventKey,
            entryClientId: pendingEntryClientId,
            ...payload,
          }),
        });
        const data = (await response.json()) as ScoutVoiceView | {
          error?: string;
          status?: string;
          code?: string;
          reason?: string;
        };
        if (!response.ok) {
          const code = "code" in data ? data.code : undefined;
          const reason = "reason" in data ? data.reason : undefined;
          const message = "error" in data && data.error ? data.error : "Request failed.";
          if (response.status === 402 || isCutoffError(code) || isCutoffError(reason) || isCutoffError(message)) {
            setCutoffCode(String(code || reason || message));
          }
          setError(message);
          return null;
        }
        if (
          "status" in data &&
          (data.status === "live" || data.status === "opt_in_required" || data.status === "setup_required")
        ) {
          setView(data as ScoutVoiceView);
        }
        return data;
      } catch {
        setError("Network error — please try again.");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [orgId, eventKey, pendingEntryClientId],
  );

  async function stopTracks() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  async function startRecording() {
    if (!eventKey || !teamKey || recording || busy) return;
    setError("");
    setDraft("");

    const hasBrowser = browserSpeechAvailable();
    const cloudOk = view && "providers" in view ? view.providers.cloudConfigured : false;

    if (!hasBrowser && !cloudOk) {
      setError("Voice notes are not set up on this computer. Type the notes, or ask a mentor.");
      onStatus?.("Needs setup");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.start();
      setRecording(true);
      setSttSource(hasBrowser ? "browser" : "cloud");

      if (hasBrowser) {
        const recognition = createSpeechRecognition();
        if (recognition) {
          recognition.continuous = true;
          recognition.interimResults = true;
          recognition.onresult = (event) => {
            const parts: string[] = [];
            for (let i = 0; i < event.results.length; i += 1) {
              const piece = event.results[i]?.[0]?.transcript;
              if (piece) parts.push(piece);
            }
            setDraft(parts.join(" ").trim());
          };
          recognition.onerror = () => {};
          recognition.onend = () => {};
          recognitionRef.current = recognition;
          recognition.start();
        }
      }

      onStatus?.("Recording voice note — review transcript before applying to the form");
    } catch {
      setError("Microphone permission denied or unavailable.");
      await stopTracks();
    }
  }

  async function stopRecording() {
    if (!recording) return;
    setBusy(true);
    try {
      recognitionRef.current?.stop();
      recognitionRef.current = null;

      const recorder = mediaRecorderRef.current;
      const blob = await new Promise<Blob | null>((resolve) => {
        if (!recorder) {
          resolve(null);
          return;
        }
        recorder.onstop = () => {
          resolve(new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" }));
        };
        recorder.stop();
      });
      mediaRecorderRef.current = null;
      setRecording(false);
      await stopTracks();

      let transcript = draft.trim();
      let source: ScoutVoiceSttSource = sttSource;

      if (!transcript && blob && view && "providers" in view && view.providers.cloudConfigured) {
        setCutoffCode(null);
        const audioBase64 = await blobToBase64(blob);
        const response = await fetch("/api/scout-voice", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            orgId,
            action: "transcribe",
            audioBase64,
            contentType: blob.type || "audio/webm",
          }),
        });
        const data = (await response.json()) as {
          status?: string;
          transcript?: string;
          message?: string;
          error?: string;
          code?: string;
          reason?: string;
        };
        if (data.status === "setup_required") {
          setError(data.message || "Cloud voice notes are not connected. Type the notes, or ask a mentor.");
          onStatus?.("Needs setup");
          return;
        }
        if (!response.ok || !data.transcript) {
          const message = data.error || data.message || "Cloud transcription failed.";
          if (response.status === 402 || isCutoffError(data.code) || isCutoffError(data.reason) || isCutoffError(message)) {
            setCutoffCode(String(data.code || data.reason || message));
          }
          setError(message);
          return;
        }
        transcript = data.transcript.trim();
        source = "cloud";
        setDraft(transcript);
        setSttSource("cloud");
      }

      if (!transcript) {
        setError("No transcript captured. Try again or type a note manually.");
        return;
      }
      if (!eventKey || !teamKey) {
        setError("Set your active event and choose which robot you are scouting before attaching a voice note.");
        return;
      }

      let mediaClientId: string | null = null;
      if (blob && blob.size > 0) {
        mediaClientId = stableClientId();
        await queueVoiceCapture({
          clientId: mediaClientId,
          orgId,
          eventKey,
          teamKey,
          blob,
          transcript,
          entryClientId: pendingEntryClientId,
        });
        onQueuedMedia?.();
      }

      await mutate({
        action: "attach-note",
        eventKey,
        matchKey: entryType === "match" ? matchKey || null : null,
        teamKey,
        entryType,
        entryClientId: pendingEntryClientId,
        mediaClientId,
        transcript,
        sttSource: source,
      });
      setDraft("");
      onStatus?.("Voice note attached (form fields unchanged)");
    } catch {
      setError("Could not finish the voice note.");
    } finally {
      setBusy(false);
      setRecording(false);
      await stopTracks();
    }
  }

  async function saveManualNote() {
    const transcript = draft.trim();
    if (!transcript || !eventKey || !teamKey) return;
    await mutate({
      action: "attach-note",
      eventKey,
      matchKey: entryType === "match" ? matchKey || null : null,
      teamKey,
      entryType,
      entryClientId: pendingEntryClientId,
      transcript,
      sttSource: "manual",
    });
    setDraft("");
    onStatus?.("Manual voice note attached");
  }

  if (!view) {
    return (
      <div className="scout-voice" id="scout-voice">
        <strong>Voice notes</strong>
        <small className="app-muted">Loading voice notes…</small>
      </div>
    );
  }

  if (view.status === "setup_required") {
    return (
      <div className="scout-voice" id="scout-voice">
        <div>
          <strong>Voice notes</strong>
          <small className="app-muted">{view.message}</small>
        </div>
        
      </div>
    );
  }

  const consent = view.consent;
  const notes = "notes" in view ? view.notes : [];

  if (view.status === "opt_in_required") {
    return (
      <div className="scout-voice scout-voice-consent" id="scout-voice">
        <div>
          <strong>{consent.title}</strong>
          <small className="app-muted">{view.message}</small>
        </div>
        <p className="scout-voice-consent-copy">{consent.summary}</p>
        <ul className="scout-voice-consent-list">
          {consent.bullets.map((bullet) => (
            <li key={bullet}>{bullet}</li>
          ))}
        </ul>
        <label className="scout-voice-consent-check">
          <input
            type="checkbox"
            checked={consentChecked}
            onChange={(event) => setConsentChecked(event.target.checked)}
          />
          <span>{consent.acceptLabel}</span>
        </label>
        <div className="scout-voice-actions">
          {view.canManageOrg && !view.orgSettings.enabled ? (
            <Button variant="primary" type="button" disabled={busy || !consentChecked} onClick={() => void mutate({ action: "set-org-opt-in", enabled: true, acceptConsent: consentChecked }) }>
              Enable for team
            </Button>
          ) : null}
          {view.orgSettings.enabled ? (
            <Button variant="primary" type="button" disabled={busy || !consentChecked} onClick={() => void mutate({ action: "set-user-opt-in", enabled: true, acceptConsent: consentChecked }) }>
              Enable for me
            </Button>
          ) : null}
        </div>
        {error ? (
          <p className="form-message" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="scout-voice" id="scout-voice">
      <div className="scout-voice-heading">
        <div>
          <strong>Voice notes</strong>
          <small className="app-muted">
            Record a note. Words appear here so you can check them, then attach the note or fill a form
            field.
            {browserStt ? " This computer can listen." : ""}
            {view.providers.cloudConfigured
              ? " Cloud voice notes are connected."
              : " Cloud voice notes are not connected."}
          </small>
        </div>
        <Button variant="secondary" type="button" disabled={busy} onClick={() => void mutate({ action: "set-user-opt-in", enabled: false, acceptConsent: false })}>
          Turn off
        </Button>
      </div>

      {cutoffCode ? <UsageCutoffBanner orgId={orgId} errorCode={cutoffCode} compact /> : null}

      {onApplyToForm && formFields.length ? (
        <label className="scout-voice-form-target">
          <span className="app-muted">Apply speech to form field</span>
          <select
            value={formFieldKey}
            onChange={(event) => setFormFieldKey(event.target.value)}
            disabled={recording || busy}
          >
            <option value="">Auto-fill labeled fields</option>
            {formFields.map((field) => (
              <option key={field.key} value={field.key}>
                {field.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <div className="scout-voice-actions">
        {!recording ? (
          <Button variant="secondary" type="button" disabled={busy || !eventKey || !teamKey} onClick={() => void startRecording()}>
            Record
          </Button>
        ) : (
          <Button variant="primary" type="button" disabled={busy} onClick={() => void stopRecording()}>
            Stop & attach
          </Button>
        )}
        <Button variant="secondary" type="button" disabled={busy || !draft.trim() || !eventKey || !teamKey} onClick={() => void saveManualNote()}>
          Attach typed note
        </Button>
        {onApplyToForm ? (
          <Button variant="secondary" type="button" disabled={busy || !draft.trim()} onClick={() => { onApplyToForm(draft.trim(), formFieldKey || null); onStatus?.("Transcript applied to the custom form — review before saving"); }}>
            Apply to form
          </Button>
        ) : null}
      </div>

      <textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder='Transcript appears here. Example: "Auto score 8, notes good defense"'
        disabled={recording && sttSource === "browser"}
      />

      {notes.length ? (
        <ul className="scout-voice-note-list">
          {notes.map((note) => (
            <li key={note.id}>
              <div>
                <strong>{voiceSourceLabel(note.sttSource)}</strong>
                <small className="app-muted"> · {new Date(note.createdAt).toLocaleString()}</small>
              </div>
              <p>{note.transcript}</p>
              <div className="scout-voice-actions">
                {onApplyToForm ? (
                  <Button variant="secondary" type="button" disabled={busy} onClick={() => { onApplyToForm(note.transcript, formFieldKey || null); onStatus?.("Voice note applied to the custom form"); }}>
                    Apply to form
                  </Button>
                ) : null}
                <Button variant="secondary" type="button" disabled={busy} onClick={() => void mutate({ action: "delete-note", noteId: note.id })}>
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <small className="app-muted">No attached voice notes for this filter yet.</small>
      )}

      {error ? (
        <p className="form-message" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
