// Copy lock for every template: subject, preheader and the plain-text body are snapshotted, so any change to email
// copy (design wording) is a visible, reviewed diff. Pixel/visual fidelity is covered separately by the pixel gate.
import { describe, expect, it } from "vitest";
import { emailFixtures } from "./fixtures.ts";
import { EMAIL_CODES, renderEmail } from "./index.ts";

describe("email copy (snapshot per code)", () => {
  for (const code of EMAIL_CODES) {
    it(`${code} copy`, () => {
      const r = renderEmail(code, emailFixtures[code] as never);
      expect(r.subject.length).toBeGreaterThan(0);
      expect(r.text).not.toMatch(/undefined|NaN|\[object Object\]/);
      expect({ subject: r.subject, preheader: r.preheader, text: r.text }).toMatchSnapshot();
    });
  }
});
