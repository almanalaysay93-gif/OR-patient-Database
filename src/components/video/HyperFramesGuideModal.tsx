import React, { useRef, useState } from "react";
import { X, Play, Pause, RotateCcw, Sparkles } from "lucide-react";
import { useApp } from "../../context/AppContext";

export const HyperFramesGuideModal: React.FC = () => {
  const { videoGuideOpen, setVideoGuideOpen } = useApp();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(true);

  if (!videoGuideOpen) return null;

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (playing) {
      videoRef.current.pause();
      setPlaying(false);
    } else {
      videoRef.current.play();
      setPlaying(true);
    }
  };

  const restart = () => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = 0;
    videoRef.current.play();
    setPlaying(true);
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(15, 23, 42, 0.75)",
        backdropFilter: "blur(12px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
      }}
      onClick={() => setVideoGuideOpen(false)}
    >
      <div
        className="glass-card"
        style={{
          width: "100%",
          maxWidth: "960px",
          background: "var(--bg-card)",
          border: "1px solid var(--border-glass-highlight)",
          borderRadius: "24px",
          overflow: "hidden",
          boxShadow: "0 25px 60px rgba(0, 0, 0, 0.35)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: "18px 24px",
            borderBottom: "1px solid var(--border-glass)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div
              style={{
                width: "32px",
                height: "32px",
                borderRadius: "8px",
                background: "var(--primary-light)",
                color: "var(--primary)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Sparkles size={18} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: "16px", color: "var(--text-main)" }}>
                OR Station Tutorial & Interactive Guide
              </div>
              <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                Offline HyperFrames Motion Synthesis • Zero Cloud Dependency
              </div>
            </div>
          </div>
          <button
            onClick={() => setVideoGuideOpen(false)}
            className="glass-btn glass-btn-secondary"
            style={{ padding: "6px", borderRadius: "50%" }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Video Canvas Container */}
        <div style={{ position: "relative", width: "100%", aspectRatio: "16 / 9", background: "#0f172a" }}>
          <video
            ref={videoRef}
            src={`${import.meta.env.BASE_URL}videos/onboarding.mp4`}
            autoPlay
            loop
            muted={false}
            playsInline
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
          />

          {/* Video Control Bar */}
          <div
            style={{
              position: "absolute",
              bottom: "16px",
              left: "50%",
              transform: "translateX(-50%)",
              display: "flex",
              alignItems: "center",
              gap: "12px",
              background: "rgba(15, 23, 42, 0.8)",
              backdropFilter: "blur(12px)",
              padding: "8px 18px",
              borderRadius: "30px",
              border: "1px solid rgba(255, 255, 255, 0.2)",
            }}
          >
            <button
              onClick={togglePlay}
              className="glass-btn glass-btn-primary"
              style={{ padding: "6px 14px", fontSize: "12px", gap: "6px" }}
            >
              {playing ? <Pause size={14} /> : <Play size={14} />}
              <span>{playing ? "Pause" : "Play"}</span>
            </button>
            <button
              onClick={restart}
              className="glass-btn glass-btn-secondary"
              style={{ padding: "6px 14px", fontSize: "12px", gap: "6px" }}
            >
              <RotateCcw size={14} />
              <span>Replay</span>
            </button>
          </div>
        </div>

        {/* Feature Highlights */}
        <div style={{ padding: "18px 24px", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px" }}>
          <div style={{ fontSize: "13px" }}>
            <span style={{ fontWeight: 600, color: "var(--primary)" }}>1. Longitudinal Tracking</span>
            <p style={{ color: "var(--text-muted)", fontSize: "12px", marginTop: "4px" }}>
              One master patient file spanning multiple admissions and surgical procedures without data duplication.
            </p>
          </div>
          <div style={{ fontSize: "13px" }}>
            <span style={{ fontWeight: 600, color: "var(--success)" }}>2. Pre-OR Readiness</span>
            <p style={{ color: "var(--text-muted)", fontSize: "12px", marginTop: "4px" }}>
              Dynamic percentage calculation ignoring non-applicable items to ensure zero surgical cancellations.
            </p>
          </div>
          <div style={{ fontSize: "13px" }}>
            <span style={{ fontWeight: 600, color: "var(--warning)" }}>3. Scheduling Guard</span>
            <p style={{ color: "var(--text-muted)", fontSize: "12px", marginTop: "4px" }}>
              4-way conflict detection preventing room collisions, patient overlap, and surgeon double-booking.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
