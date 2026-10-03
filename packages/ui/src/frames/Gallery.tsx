import { listFrames, getFrame, screenLabel, type FrameApp } from "./registry";

type App = Exclude<FrameApp, "shared">;

/** /_frames index: every frame registered for the app. */
export function FrameIndex({ app }: { app: App }) {
  const frames = listFrames(app);
  return (
    <main style={{ padding: 40, fontFamily: "var(--font-sans)", display: "flex", flexDirection: "column", gap: 16 }}>
      <h1 style={{ font: "500 28px/1.2 var(--font-sans)", letterSpacing: "-0.02em" }}>Frame gallery · {app}</h1>
      <p style={{ font: "400 14px/1.5 var(--font-sans)", color: "var(--high)" }}>
        Every design frame rendered with the real components, at the design viewport.
      </p>
      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
        {frames.map((f) => (
          <li key={f.code} style={{ font: "400 14px/1.5 var(--font-sans)" }}>
            <a href={`/_frames/${encodeURIComponent(f.code)}`}>{screenLabel(f)}</a>{" "}
            <span style={{ color: "var(--mid-high)", fontFeatureSettings: "'tnum'" }}>
              {f.viewport.w}×{f.viewport.h} · {f.app}
            </span>
          </li>
        ))}
      </ul>
    </main>
  );
}

/** /_frames/<code>: one frame on the design canvas, left-top aligned at the frame's width. Null when unknown. */
export function FrameView({ app, code }: { app: App; code: string }) {
  const frame = getFrame(code, app);
  if (!frame) return null;
  return (
    <div data-frame={frame.code} style={{ background: frame.background ?? "transparent", minWidth: frame.viewport.w, minHeight: "100dvh" }}>
      <div data-frame-root="" style={{ width: frame.viewport.w }}>
        {frame.render()}
      </div>
    </div>
  );
}
