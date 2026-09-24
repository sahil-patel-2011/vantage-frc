import { ImageResponse } from "next/og";

/**
 * The picture a link to Vantage shows in iMessage, Discord, Slack, X and Facebook. Those
 * apps do not render SVG previews, so shared links used to show no image at all.
 */
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Vantage — free software for FRC teams";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: "linear-gradient(135deg, #0b1f33 0%, #0e5a66 100%)",
          color: "#ffffff",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 16,
              background: "#ffffff",
              color: "#0e5a66",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 40,
              fontWeight: 800,
            }}
          >
            V
          </div>
          <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: -1 }}>Vantage</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 68, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2, maxWidth: 980 }}>
            Your season stops living in spreadsheets.
          </div>
          <div style={{ fontSize: 30, opacity: 0.85 }}>
            Free software for FRC teams: scouting, strategy, build and business in one login.
          </div>
        </div>
      </div>
    ),
    size,
  );
}
