// Framing hints of the door's screens (K-03 copy), kept apart from the face engine so the screens don't bundle it.

/** One hint at a time; listed in priority order (highest first). */
export const HINT_PRIORITY = [
  "multiple_faces",
  "no_face",
  "too_far",
  "too_close",
  "off_center",
  "not_frontal",
  "too_dark",
  "too_bright",
  "blurry",
] as const;
export type HintCode = (typeof HINT_PRIORITY)[number];

/** Kiosk copy per hint. K-03a…f are canonical (design/03 Kiosk.dc.html); the rest are placeholders for the kiosk lane. */
export const HINT_COPY: Record<HintCode, string> = {
  multiple_faces: "One person at a time",
  no_face: "Look at the screen to check in",
  too_far: "Move a little closer",
  too_close: "Step back a little",
  off_center: "Center your face",
  not_frontal: "Look at the screen",
  too_dark: "More light needed",
  too_bright: "Too much light",
  blurry: "Hold still",
};
