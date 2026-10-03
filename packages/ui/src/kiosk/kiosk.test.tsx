import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { QrCode, qrPath } from "../index";
import {
  KIOSK_SIZES,
  KioskCodeSlots,
  KioskFacePlaceholder,
  KioskMessage,
  KioskOvalStage,
  KioskScreen,
  KioskWelcome,
  OperatorActions,
  OperatorArrived,
  OperatorCamera,
  OperatorOffline,
  OperatorPanel,
  OperatorScans,
  OperatorSegmented,
} from "./index";

const html = (el: ReactElement) => renderToStaticMarkup(el);

describe("KioskScreen", () => {
  it("renders the design stage with top bar, privacy line and label", () => {
    const out = html(
      <KioskScreen orientation="landscape" camera="placeholder" event="Barcelona Office Opening" clock="19:42" counter="42 / 120 arrived" label="K-01 Idle / attract" framed>
        <p>body</p>
      </KioskScreen>,
    );
    expect(out).toContain('data-screen-label="K-01 Idle / attract"');
    expect(out).toContain("width:1920px;height:1080px");
    expect(out).toContain("Barcelona Office Opening");
    expect(out).toContain("19:42");
    expect(out).toContain("42 / 120 arrived");
    expect(out).toContain("Face check-in by Didit. Each scan is logged by Didit for this event.");
    expect(out).toContain("cameraPlaceholder");
  });

  it("portrait uses 1080×1920 and hides the meta without an event", () => {
    const out = html(<KioskScreen orientation="portrait" camera="none" />);
    expect(out).toContain(`width:${KIOSK_SIZES.portrait.w}px;height:${KIOSK_SIZES.portrait.h}px`);
    expect(out).toContain('data-orientation="portrait"');
    expect(out).not.toContain("metaRule");
  });

  it("keeps a live camera node mounted but hidden (K-02)", () => {
    const out = html(<KioskScreen orientation="landscape" camera={<video data-live="" />} cameraHidden cameraTone="dim" event="E" clock="1" />);
    expect(out).toContain("data-live");
    expect(out).toContain("cameraHidden");
    expect(out).toContain('data-tone="dim"');
  });

  it("shows the K-14 badge next to the event", () => {
    expect(html(<KioskScreen orientation="landscape" camera="none" event="E" clock="1" badge="Staffed entry" />)).toContain("Staffed entry");
  });
});

describe("KioskOvalStage", () => {
  it("announces head, hint and sub politely and draws the hold ring", () => {
    const out = html(<KioskOvalStage tone="blue" head="Welcome to" accent="Barcelona" ring={0.62} hint="Hold still…" sub="Look" />);
    expect(out).toContain('role="status"');
    expect(out).toContain('aria-live="polite"');
    expect(out).toContain('<span class="accent">Barcelona</span>');
    expect(out).toContain('stroke-dasharray="62 100"');
    expect(out).toContain("Hold still…");
  });

  it("clamps the ring and adds the scan line and the stand-in face", () => {
    const out = html(<KioskOvalStage tone="face" ring={3} scan inside={<KioskFacePlaceholder orientation="portrait" pose="off" second />} />);
    expect(out).toContain('stroke-dasharray="100 100"');
    expect(out).toContain('class="scan"');
    expect(out).toContain("translate(calc(-50% + 140px), -50%)");
    expect(out).toContain("360px 0 0 -20px");
  });
});

describe("KioskMessage + code slots", () => {
  it("renders icon, head, sub, children and the STAFF chip", () => {
    const out = html(<KioskMessage icon="!" iconTone="warn" head="Camera is busy" sub="Another app" chip="NotReadableError" />);
    expect(out).toContain('data-tone="warn"');
    expect(out).toContain("<h1");
    expect(out).toContain(">STAFF</span>NotReadableError");
  });

  it("marks the active slot, and the error state drops it", () => {
    const active = html(<KioskCodeSlots values={["4", "8", "1", "", "", ""]} active={3} />);
    expect(active.match(/data-active/g)).toHaveLength(1);
    const error = html(<KioskCodeSlots values={["4", "8", "1", "9", "0", "3"]} active={3} error />);
    expect(error).toContain("data-error");
    expect(error).not.toContain("data-active");
  });
});

describe("KioskWelcome", () => {
  it("hero and calm variants", () => {
    const hero = html(<KioskWelcome hero greeting="Welcome," name="Maria García" sub="Barcelona Office Opening" time="Checked in at 19:42" />);
    expect(hero).toContain("data-hero");
    expect(hero).toContain("Maria García");
    const calm = html(<KioskWelcome greeting="Welcome back," name="Maria" sub="You checked in at" time="19:42" />);
    expect(calm).not.toContain("data-hero");
  });
});

describe("Operator panel", () => {
  it("renders K-13 sections with native, labelled controls", () => {
    const out = html(
      <OperatorPanel kioskName="Main door" id="op">
        <OperatorArrived arrived={42} capacity={120} />
        <OperatorScans scans={[{ id: "1", time: "19:42", name: "María García", result: "Welcomed", tone: "ok" }]} />
        <OperatorSegmented title="MATCH STRICTNESS" name="s" value="80" options={[{ value: "70", label: "Relaxed 70" }, { value: "80", label: "Standard 80" }]} />
        <OperatorCamera devices={[{ value: "a", label: "FaceTime HD Camera" }]} value="a" mirror />
        <OperatorActions primary={{ label: "Pause check-in" }} secondary={{ label: "Exit full screen" }} />
      </OperatorPanel>,
    );
    expect(out).toContain('role="dialog"');
    expect(out).toContain('aria-labelledby="op-title"');
    expect(out).toContain("OPERATOR · MAIN DOOR");
    expect(out).toContain("42 <span");
    expect(out).toContain(`checked="" value="80"`);
    expect(out).toContain('role="switch"');
    expect(out).toContain("FaceTime HD Camera");
    expect(out).toContain('data-variant="primary"');
  });

  it("shows an empty scans line and the K-21 offline block", () => {
    expect(html(<OperatorScans scans={[]} />)).toContain("No scans yet");
    const out = html(<OperatorOffline status="Offline" detail="Reconnecting in 12s" logUrl="https://events.didit.me/x/log" qr={<i data-qr="" />} />);
    expect(out).toContain("Manual check-in in the admin");
    expect(out).toContain("events.didit.me/x/log");
    expect(out).toContain("data-qr");
  });
});

describe("QrCode", () => {
  it("encodes a URL as a square SVG path", () => {
    const { d, modules } = qrPath("https://events.didit.me/admin/events/evt/log");
    expect(modules).toBeGreaterThanOrEqual(21);
    expect((modules - 17) % 4).toBe(0);
    expect(d.startsWith("M0 0h1v1h-1z")).toBe(true); // finder pattern corner
    const out = html(<QrCode value="hello" size={120} label="QR" />);
    expect(out).toContain('width="120"');
    expect(out).toContain('role="img"');
    expect(out).toContain('aria-label="QR"');
  });
});
