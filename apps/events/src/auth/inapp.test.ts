import { describe, expect, it } from "vitest";
import { androidIntentUrl, inAppBrowser, inAppInfo, inAppOs, openInBrowserUrl, safariUrl } from "./inapp";

const IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)";
const ANDROID_WV = "Mozilla/5.0 (Linux; Android 15; Pixel 9 Build/AP4A.250105.002; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.7339.51 Mobile Safari/537.36";

const UA = {
  xIos: `${IOS} Mobile/15E148 Twitter for iPhone/11.14`,
  xAndroid: `${ANDROID_WV} TwitterAndroid`,
  linkedInIos: `${IOS} Mobile/15E148 [LinkedInApp]/9.31.1210`,
  linkedInAndroid: `${ANDROID_WV} LinkedInApp`,
  instagramIos: `${IOS} Mobile/22F76 Instagram 385.0.0.26.80 (iPhone16,2; iOS 18_5; en_US; en; scale=3.00; 1290x2796; 748363927)`,
  instagramAndroid: `${ANDROID_WV} Instagram 385.0.0.47.74 Android (35/15; 420dpi; 1080x2424; Google/google; Pixel 9; tokay; tokay; en_US; 748363930)`,
  facebookIos: `${IOS} Mobile/22F76 [FBAN/FBIOS;FBAV/520.0.0.38.101;FBBV/748363927;FBDV/iPhone16,2;FBMD/iPhone;FBSN/iOS;FBSV/18.5;FBSS/3;FBID/phone;FBLC/en_US;FBOP/5;FBRV/0]`,
  facebookAndroid: `${ANDROID_WV} [FB_IAB/FB4A;FBAV/520.0.0.44.72;]`,
  messengerIos: `${IOS} Mobile/22F76 [FBAN/MessengerForiOS;FBAV/512.0.0.27.107;FBBV/748363927;FBDV/iPhone16,2]`,
  tiktokIos: `${IOS} Mobile/15E148 musical_ly_40.6.0 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/en Region/ES BytedanceWebview/d8a21c6`,
  tiktokAndroid: `${ANDROID_WV} trill_400603 JsSdk/1.0 NetType/WIFI Channel/googleplay AppName/trill app_version/40.6.3 ByteLocale/en BytedanceWebview/d8a21c6`,
  threadsIos: `${IOS} Mobile/22F76 Barcelona 385.0.0.26.80 (iPhone16,2; iOS 18_5; en_US; en; scale=3.00; 1290x2796; 748363927)`,
  threadsAndroid: `${ANDROID_WV} Barcelona 385.0.0.47.74 Android (35/15; 420dpi; 1080x2424; Google/google; Pixel 9; tokay; tokay; en_US; 748363930)`,
  snapchatIos: `${IOS} Mobile/15E148 Snapchat/13.48.0.52 (like Safari/8621.2.5.10.10, panda)`,
  lineIos: `${IOS} Mobile/15E148 Safari Line/15.12.1`,
  wechatAndroid: `${ANDROID_WV} MicroMessenger/8.0.61.2880(0x28003D36) WeChat/arm64 Weixin NetType/WIFI Language/en ABI/arm64`,
  telegramAndroid: `${ANDROID_WV} Telegram-Android/11.14.1 (Google Pixel 9; Android 15; SDK 35; HIGH)`,
  gmailIos: `${IOS} Mobile/15E148 Gmail/6.0.250804`,
  androidWebview: ANDROID_WV,
  iosWebview: `${IOS} Mobile/15E148`,
  // Real browsers.
  safariIos: `${IOS} Version/18.5 Mobile/15E148 Safari/604.1`,
  safariMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15",
  chromeIos: `${IOS} CriOS/140.0.7339.101 Mobile/15E148 Safari/604.1`,
  firefoxIos: `${IOS} FxiOS/142.0 Mobile/15E148 Safari/605.1.15`,
  edgeIos: `${IOS} Version/18.0 EdgiOS/140.0.3485.54 Mobile/15E148 Safari/605.1.15`,
  samsung: "Mozilla/5.0 (Linux; Android 15; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36",
  chromeAndroid: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
  firefoxAndroid: "Mozilla/5.0 (Android 15; Mobile; rv:142.0) Gecko/142.0 Firefox/142.0",
  edgeAndroid: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36 EdgA/140.0.0.0",
  edgeDesktop: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
  chromeDesktop: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  // The Google app: a webview Google allows.
  gsaIos: `${IOS} GSA/384.0.799237837 Mobile/15E148 Safari/604.1`,
  gsaAndroid: `${ANDROID_WV} GSA/16.35.38.sa.arm64`,
} as const;

describe("inAppBrowser", () => {
  it.each([
    ["xIos", "X"],
    ["xAndroid", "X"],
    ["linkedInIos", "LinkedIn"],
    ["linkedInAndroid", "LinkedIn"],
    ["instagramIos", "Instagram"],
    ["instagramAndroid", "Instagram"],
    ["facebookIos", "Facebook"],
    ["facebookAndroid", "Facebook"],
    ["messengerIos", "Facebook"],
    ["tiktokIos", "TikTok"],
    ["tiktokAndroid", "TikTok"],
    ["threadsIos", "Threads"],
    ["threadsAndroid", "Threads"],
    ["snapchatIos", "Snapchat"],
    ["lineIos", "Line"],
    ["wechatAndroid", "WeChat"],
    ["telegramAndroid", "Telegram"],
    ["gmailIos", "Gmail"],
    ["androidWebview", "other"],
    ["iosWebview", "other"],
  ] as const)("%s is the %s in-app browser", (key, app) => {
    expect(inAppBrowser(UA[key])).toEqual({ app });
  });

  it.each(["safariIos", "safariMac", "chromeIos", "firefoxIos", "edgeIos", "samsung", "chromeAndroid", "firefoxAndroid", "edgeAndroid", "edgeDesktop", "chromeDesktop", "gsaIos", "gsaAndroid"] as const)(
    "%s is a real browser",
    (key) => {
      expect(inAppBrowser(UA[key])).toBeNull();
    },
  );

  it("no User-Agent, an empty one or a non-browser client is not flagged", () => {
    expect(inAppBrowser(null)).toBeNull();
    expect(inAppBrowser(undefined)).toBeNull();
    expect(inAppBrowser("")).toBeNull();
    expect(inAppBrowser("curl/8.7.1")).toBeNull();
  });

  it("reads the OS for the open-in-browser link", () => {
    expect(inAppOs(UA.xIos)).toBe("ios");
    expect(inAppOs(UA.xAndroid)).toBe("android");
    expect(inAppOs(UA.chromeDesktop)).toBe("other");
    expect(inAppOs(null)).toBe("other");
  });
});

describe("open-in-browser links", () => {
  const origin = "https://events.didit.me";

  it("Android: a Chrome intent that keeps the path and query, with the plain URL as fallback", () => {
    expect(androidIntentUrl("/e/ai-era?join=1", origin)).toBe(
      "intent://events.didit.me/e/ai-era?join=1#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=https%3A%2F%2Fevents.didit.me%2Fe%2Fai-era%3Fjoin%3D1;end",
    );
  });

  it("iOS: Safari's scheme keeps the path and query", () => {
    expect(safariUrl("/login?next=%2Fe%2Fai-era%3Fjoin%3D1", origin)).toBe("x-safari-https://events.didit.me/login?next=%2Fe%2Fai-era%3Fjoin%3D1");
    expect(safariUrl("https://events.didit.me/e/ai-era?join=1", origin)).toBe("x-safari-https://events.didit.me/e/ai-era?join=1");
  });

  it("another OS gets the plain URL", () => {
    expect(openInBrowserUrl("other", "/login?next=%2Fme%2Fevents", origin)).toBe("https://events.didit.me/login?next=%2Fme%2Fevents");
    expect(openInBrowserUrl("ios", "/login", origin)).toBe("x-safari-https://events.didit.me/login");
    expect(openInBrowserUrl("android", "/login", origin)).toMatch(/^intent:\/\/events\.didit\.me\/login#Intent;scheme=https;package=com\.android\.chrome;/);
  });

  it.each(["https://evil.test/e/ai-era", "//evil.test/e/ai-era", "/\\evil.test", "https://events.didit.me@evil.test/", "https://events.didit.me.evil.test/", "http://events.didit.me/login", "javascript:alert(1)", "intent://evil.test#Intent;end"])(
    "rejects the foreign target %s",
    (target) => {
      expect(androidIntentUrl(target, origin)).toBeNull();
      expect(safariUrl(target, origin)).toBeNull();
      expect(openInBrowserUrl("other", target, origin)).toBeNull();
    },
  );

  it("drops credentials and the fragment (an intent's own fragment cannot be injected)", () => {
    expect(safariUrl("https://user:pw@events.didit.me/e/ai-era?join=1#x", origin)).toBe("x-safari-https://events.didit.me/e/ai-era?join=1");
    expect(androidIntentUrl("/e/ai-era#Intent;package=evil;end", origin)).toBe(
      "intent://events.didit.me/e/ai-era#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=https%3A%2F%2Fevents.didit.me%2Fe%2Fai-era;end",
    );
  });

  it("inAppInfo: null in a real browser; the app, OS, path and link otherwise", () => {
    expect(inAppInfo(UA.safariIos, origin, "/login")).toBeNull();
    expect(inAppInfo(UA.xIos, origin, "/e/ai-era?join=1")).toEqual({ app: "X", os: "ios", path: "/e/ai-era?join=1", openHref: "x-safari-https://events.didit.me/e/ai-era?join=1" });
    expect(inAppInfo(UA.linkedInAndroid, origin, "/login")).toMatchObject({ app: "LinkedIn", os: "android", openHref: expect.stringMatching(/^intent:\/\/events\.didit\.me\/login#Intent;/) });
    // Without a known origin the note keeps Copy link and the hint.
    expect(inAppInfo(UA.xIos, null, "/login")).toEqual({ app: "X", os: "ios", path: "/login", openHref: null });
  });
});
