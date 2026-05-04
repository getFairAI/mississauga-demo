import { useEffect, useRef, useState } from "react";

type AudioPlayerProps = {
  src: string;
  autoPlay?: boolean;
  onEnded?: () => void;
  className?: string;
  style?: React.CSSProperties;
  variant?: "default" | "compact";
};

const formatTime = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

export const AudioPlayer = ({
  src,
  autoPlay = false,
  onEnded,
  className,
  style,
  variant = "default",
}: AudioPlayerProps) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => setCurrentTime(el.currentTime);
    const onMeta = () => setDuration(el.duration || 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEndedInternal = () => {
      setPlaying(false);
      onEnded?.();
    };
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("durationchange", onMeta);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onEndedInternal);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("durationchange", onMeta);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onEndedInternal);
    };
  }, [onEnded]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (autoPlay) {
      const p = el.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    }
  }, [src, autoPlay]);

  const togglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      const p = el.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    } else {
      el.pause();
    }
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = audioRef.current;
    const bar = barRef.current;
    if (!el || !bar || !duration) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    el.currentTime = ratio * duration;
    setCurrentTime(el.currentTime);
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div
      className={`msga-audio${variant === "compact" ? " msga-audio-compact" : ""}${className ? ` ${className}` : ""}`}
      style={style}
      onClick={(e) => e.stopPropagation()}
    >
      <audio ref={audioRef} src={src} preload="metadata" />
      <button
        type="button"
        className="msga-audio-play"
        onClick={togglePlay}
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
            <rect x="2" y="1.5" width="2.6" height="9" rx="0.5" />
            <rect x="7.4" y="1.5" width="2.6" height="9" rx="0.5" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
            <path d="M3 1.8v8.4c0 .5.55.8 1 .55l7-4.2a.65.65 0 0 0 0-1.1l-7-4.2A.65.65 0 0 0 3 1.8z" />
          </svg>
        )}
      </button>
      <span className="msga-audio-time msga-audio-time-current">{formatTime(currentTime)}</span>
      <div ref={barRef} className="msga-audio-bar" onClick={seek} role="slider" aria-valuemin={0} aria-valuemax={duration || 0} aria-valuenow={currentTime}>
        <div className="msga-audio-bar-fill" style={{ width: `${progress}%` }} />
      </div>
      <span className="msga-audio-time msga-audio-time-total">{formatTime(duration)}</span>
    </div>
  );
};

export default AudioPlayer;
