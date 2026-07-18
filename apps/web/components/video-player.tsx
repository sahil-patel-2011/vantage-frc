"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";
import {
  FORWARD_SECONDS,
  nextPlaybackRate,
  PLAYBACK_RATES,
  REWIND_SECONDS,
  seekSeconds,
  type PlaybackRate,
} from "../lib/video-rescout";
import { fmtTimestamp } from "../lib/video-review";

declare global {
  interface Window {
    YT?: {
      Player: new (
        element: HTMLElement | string,
        config: {
          videoId: string;
          playerVars?: Record<string, string | number>;
          events?: {
            onReady?: (event: { target: YtPlayer }) => void;
            onStateChange?: (event: { data: number; target: YtPlayer }) => void;
          };
        },
      ) => YtPlayer;
      PlayerState: { PLAYING: number; PAUSED: number; ENDED: number };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

type YtPlayer = {
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState: () => number;
  setPlaybackRate: (rate: number) => void;
  getPlaybackRate: () => number;
  destroy: () => void;
};

export type VideoPlayerHandle = {
  seekTo: (seconds: number) => void;
  getCurrentTime: () => number;
  play: () => void;
  pause: () => void;
};

type VideoPlayerProps = {
  videoId: string;
  title?: string;
  onTimeUpdate?: (seconds: number) => void;
};

let apiPromise: Promise<void> | null = null;

function loadYouTubeApi(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.YT?.Player) return Promise.resolve();
  if (!apiPromise) {
    apiPromise = new Promise((resolve) => {
      const previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        previous?.();
        resolve();
      };
      if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
        const tag = document.createElement("script");
        tag.src = "https://www.youtube.com/iframe_api";
        tag.async = true;
        document.head.appendChild(tag);
      }
    });
  }
  return apiPromise;
}

function VideoPlayerInner(
  { videoId, title, onTimeUpdate }: VideoPlayerProps,
  ref: Ref<VideoPlayerHandle>,
) {
  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YtPlayer | null>(null);
  const tickRef = useRef<number | null>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentSeconds, setCurrentSeconds] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [rate, setRate] = useState<PlaybackRate>(1);

  const syncClock = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    const next = Math.floor(player.getCurrentTime());
    setCurrentSeconds(next);
    onTimeUpdate?.(next);
  }, [onTimeUpdate]);

  const stopTick = useCallback(() => {
    if (tickRef.current != null) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  const startTick = useCallback(() => {
    stopTick();
    tickRef.current = window.setInterval(syncClock, 250);
  }, [stopTick, syncClock]);

  useImperativeHandle(
    ref,
    () => ({
      seekTo(seconds: number) {
        const player = playerRef.current;
        if (!player) return;
        const max = durationSeconds > 0 ? durationSeconds : undefined;
        const next = seekSeconds(0, Math.floor(seconds), max);
        player.seekTo(next, true);
        setCurrentSeconds(next);
        onTimeUpdate?.(next);
      },
      getCurrentTime() {
        return playerRef.current ? Math.floor(playerRef.current.getCurrentTime()) : currentSeconds;
      },
      play() {
        playerRef.current?.playVideo();
      },
      pause() {
        playerRef.current?.pauseVideo();
      },
    }),
    [currentSeconds, durationSeconds, onTimeUpdate],
  );

  useEffect(() => {
    let cancelled = false;
    void loadYouTubeApi().then(() => {
      if (cancelled || !mountRef.current || !window.YT?.Player) return;
      playerRef.current?.destroy();
      playerRef.current = new window.YT.Player(mountRef.current, {
        videoId,
        playerVars: {
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          origin: typeof window !== "undefined" ? window.location.origin : "",
        },
        events: {
          onReady: ({ target }) => {
            if (cancelled) return;
            playerRef.current = target;
            setReady(true);
            setDurationSeconds(Math.floor(target.getDuration() || 0));
            setRate(PLAYBACK_RATES.includes(target.getPlaybackRate() as PlaybackRate) ? (target.getPlaybackRate() as PlaybackRate) : 1);
            syncClock();
          },
          onStateChange: ({ data, target }) => {
            const playingNow = data === window.YT!.PlayerState.PLAYING;
            setPlaying(playingNow);
            if (playingNow) startTick();
            else {
              stopTick();
              syncClock();
            }
            if (data === window.YT!.PlayerState.ENDED) stopTick();
            setDurationSeconds(Math.floor(target.getDuration() || durationSeconds));
          },
        },
      });
    });
    return () => {
      cancelled = true;
      stopTick();
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [videoId, startTick, stopTick, syncClock]);

  const rewind = () => {
    const player = playerRef.current;
    if (!player) return;
    const next = seekSeconds(player.getCurrentTime(), -REWIND_SECONDS, durationSeconds || undefined);
    player.seekTo(next, true);
    setCurrentSeconds(next);
    onTimeUpdate?.(next);
  };

  const forward = () => {
    const player = playerRef.current;
    if (!player) return;
    const next = seekSeconds(player.getCurrentTime(), FORWARD_SECONDS, durationSeconds || undefined);
    player.seekTo(next, true);
    setCurrentSeconds(next);
    onTimeUpdate?.(next);
  };

  const togglePlay = () => {
    const player = playerRef.current;
    if (!player) return;
    if (playing) player.pauseVideo();
    else player.playVideo();
  };

  const cycleRate = () => {
    const player = playerRef.current;
    if (!player) return;
    const next = nextPlaybackRate(player.getPlaybackRate());
    player.setPlaybackRate(next);
    setRate(next);
  };

  return (
    <div className="vid-player">
      <div className="vid-frame" aria-label={title ?? "Match video"}>
        <div ref={mountRef} className="vid-player-mount" />
      </div>
      <div className="vid-transport" aria-label="Video transport controls">
        <button type="button" className="app-button secondary" disabled={!ready} onClick={rewind}>
          −{REWIND_SECONDS}s
        </button>
        <button type="button" className="app-button" disabled={!ready} onClick={togglePlay}>
          {playing ? "Pause" : "Play"}
        </button>
        <button type="button" className="app-button secondary" disabled={!ready} onClick={forward}>
          +{FORWARD_SECONDS}s
        </button>
        <button type="button" className="app-button secondary" disabled={!ready} onClick={cycleRate}>
          {rate}x
        </button>
        <span className="vid-clock" aria-live="polite">
          {fmtTimestamp(currentSeconds)}
          {durationSeconds > 0 ? ` / ${fmtTimestamp(durationSeconds)}` : ""}
        </span>
      </div>
    </div>
  );
}

export const VideoPlayer = forwardRef(VideoPlayerInner);
VideoPlayer.displayName = "VideoPlayer";
