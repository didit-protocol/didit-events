import { afterEach, describe, expect, it, vi } from "vitest";
import { CAMERA_DEVICE_STORAGE_KEY, getStoredDeviceId, mapCameraError, openCamera, setStoredDeviceId } from "./camera";

const domError = (name: string) => Object.assign(new Error(name), { name });

describe("mapCameraError", () => {
  it.each([
    ["NotAllowedError", "permission_denied"],
    ["SecurityError", "permission_denied"],
    ["NotFoundError", "not_found"],
    ["OverconstrainedError", "not_found"],
    ["NotReadableError", "in_use"],
    ["TrackStartError", "in_use"],
    ["TypeError", "unknown"],
  ])("%s → %s", (name, expected) => {
    expect(mapCameraError(domError(name))).toBe(expected);
  });

  it("works with real DOMException instances", () => {
    expect(mapCameraError(new DOMException("denied", "NotAllowedError"))).toBe("permission_denied");
    expect(mapCameraError(new DOMException("none", "NotFoundError"))).toBe("not_found");
    expect(mapCameraError(new DOMException("busy", "NotReadableError"))).toBe("in_use");
  });

  it("maps non-errors to unknown", () => {
    expect(mapCameraError("boom")).toBe("unknown");
    expect(mapCameraError(null)).toBe("unknown");
  });
});

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, v),
  };
}

describe("device persistence", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("round-trips the device id through localStorage", () => {
    vi.stubGlobal("localStorage", memoryStorage());
    expect(getStoredDeviceId()).toBeNull();
    setStoredDeviceId("cam-2");
    expect(localStorage.getItem(CAMERA_DEVICE_STORAGE_KEY)).toBe("cam-2");
    expect(getStoredDeviceId()).toBe("cam-2");
    setStoredDeviceId(null);
    expect(getStoredDeviceId()).toBeNull();
  });

  it("survives a throwing localStorage", () => {
    const broken = memoryStorage();
    broken.getItem = () => {
      throw domError("SecurityError");
    };
    broken.setItem = () => {
      throw domError("QuotaExceededError");
    };
    vi.stubGlobal("localStorage", broken);
    expect(getStoredDeviceId()).toBeNull();
    expect(() => setStoredDeviceId("x")).not.toThrow();
  });
});

describe("openCamera", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubMedia(getUserMedia: (c: MediaStreamConstraints) => Promise<MediaStream>) {
    const spy = vi.fn(getUserMedia);
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: spy } });
    vi.stubGlobal("localStorage", memoryStorage());
    return spy;
  }

  it("asks for 1280×720 from the user-facing camera", async () => {
    const stream = {} as MediaStream;
    const spy = stubMedia(async () => stream);
    expect(await openCamera(null)).toEqual({ ok: true, stream });
    expect(spy).toHaveBeenCalledWith({
      audio: false,
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
    });
  });

  it.each([
    ["NotAllowedError", "permission_denied"],
    ["NotFoundError", "not_found"],
    ["NotReadableError", "in_use"],
  ])("maps a %s rejection to %s", async (name, error) => {
    stubMedia(async () => {
      throw new DOMException(name, name);
    });
    expect(await openCamera(null)).toEqual({ ok: false, error });
  });

  it("falls back to the default camera when the stored device is gone", async () => {
    const stream = {} as MediaStream;
    const spy = stubMedia(async (c) => {
      if (typeof c.video === "object" && c.video.deviceId) throw new DOMException("gone", "OverconstrainedError");
      return stream;
    });
    setStoredDeviceId("old-cam");
    expect(await openCamera()).toEqual({ ok: true, stream });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(getStoredDeviceId()).toBeNull();
  });

  it("does not retry on permission errors", async () => {
    const spy = stubMedia(async () => {
      throw new DOMException("denied", "NotAllowedError");
    });
    expect(await openCamera("cam-1")).toEqual({ ok: false, error: "permission_denied" });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("reports unknown without mediaDevices (insecure context)", async () => {
    vi.stubGlobal("navigator", {});
    expect(await openCamera(null)).toEqual({ ok: false, error: "unknown" });
  });
});
