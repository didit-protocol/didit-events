// Multi-face tracker for the v5 door: keeps a stable `id` per face across detector frames with IoU + centroid
// matching and a constant-velocity prediction, so a face that the detector misses for a few frames (or that moves
// fast) keeps its id, its recognition and its AR tag. Pure: time is passed in, no DOM.
import type { Box, FaceDetection, FaceKeypoints } from "../face/engine";
import { iou } from "../face/quality";

export interface Track {
  id: number;
  /** Last detected box (camera px). */
  box: Box;
  keypoints: FaceKeypoints;
  score: number;
  /** Centre velocity in camera px per ms. */
  vx: number;
  vy: number;
  /** Frames this track was detected in (not counting coasted frames). */
  hits: number;
  /** Consecutive detected frames up to `lastSeen`. */
  streak: number;
  firstSeen: number;
  lastSeen: number;
}

export interface TrackerConfig {
  /** A track not detected for this long is dropped; its face gets a new id when it comes back. */
  lostMs: number;
  /** At most this many faces are tracked; the largest win. */
  maxFaces: number;
  /** A detection joins a track at this IoU with its predicted box… */
  minIou: number;
  /** …or when its centre is within this × the track's box width of the predicted centre. */
  maxCenterDist: number;
}

export const DEFAULT_TRACKER_CONFIG: Readonly<TrackerConfig> = Object.freeze({ lostMs: 800, maxFaces: 6, minIou: 0.2, maxCenterDist: 0.6 });

const center = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const area = (b: Box) => b.w * b.h;

/** The box `track` is expected at, `t` ms: its last box moved by its velocity (capped at 300 ms of coasting). */
export function predictBox(track: Pick<Track, "box" | "vx" | "vy" | "lastSeen">, t: number): Box {
  const dt = Math.min(Math.max(0, t - track.lastSeen), 300);
  return { ...track.box, x: track.box.x + track.vx * dt, y: track.box.y + track.vy * dt };
}

export class FaceTracker {
  private tracks: Track[] = [];
  private nextId = 1;
  readonly config: TrackerConfig;

  constructor(config: Partial<TrackerConfig> = {}) {
    this.config = { ...DEFAULT_TRACKER_CONFIG, ...config };
  }

  /** Live tracks, including ones coasting through a short miss. */
  get current(): readonly Track[] {
    return this.tracks;
  }

  reset(): void {
    this.tracks = [];
  }

  /** Feeds one detector frame taken at `t` (ms); returns the live tracks. */
  update(detections: readonly FaceDetection[], t: number): readonly Track[] {
    const { lostMs, maxFaces, minIou, maxCenterDist } = this.config;
    // >maxFaces faces in frame: the largest ones (the people closest to the door).
    const found = [...detections].sort((a, b) => area(b.box) - area(a.box)).slice(0, maxFaces);
    const predicted = this.tracks.map((tr) => predictBox(tr, t));
    const pairs: Array<{ ti: number; di: number; score: number }> = [];
    this.tracks.forEach((tr, ti) => {
      const p = predicted[ti]!, pc = center(p);
      found.forEach((d, di) => {
        const overlap = iou(p, d.box), dc = center(d.box);
        const dist = Math.hypot(dc.x - pc.x, dc.y - pc.y) / Math.max(1, tr.box.w);
        // Faces of very different size are different people even when one sits in front of the other.
        const ratio = d.box.w / Math.max(1, tr.box.w);
        if (ratio < 0.5 || ratio > 2) return;
        if (overlap >= minIou || dist <= maxCenterDist) pairs.push({ ti, di, score: overlap + (1 - Math.min(dist, 1)) });
      });
    });
    pairs.sort((a, b) => b.score - a.score);
    const usedT = new Set<number>(), usedD = new Set<number>();
    const next: Track[] = [];
    for (const { ti, di } of pairs) {
      if (usedT.has(ti) || usedD.has(di)) continue;
      usedT.add(ti);
      usedD.add(di);
      const tr = this.tracks[ti]!, d = found[di]!;
      const dt = Math.max(1, t - tr.lastSeen);
      const oc = center(tr.box), nc = center(d.box);
      // Smoothed velocity; a long gap says little about the current speed.
      const k = dt > 250 ? 0.2 : 0.5;
      next.push({
        ...tr,
        box: d.box,
        keypoints: d.keypoints,
        score: d.score,
        vx: tr.vx * (1 - k) + ((nc.x - oc.x) / dt) * k,
        vy: tr.vy * (1 - k) + ((nc.y - oc.y) / dt) * k,
        hits: tr.hits + 1,
        streak: tr.streak + 1,
        lastSeen: t,
      });
    }
    // Missed this frame: coast until `lostMs`, with a decaying velocity.
    this.tracks.forEach((tr, ti) => {
      if (usedT.has(ti) || t - tr.lastSeen > lostMs) return;
      next.push({ ...tr, streak: 0, vx: tr.vx * 0.8, vy: tr.vy * 0.8 });
    });
    found.forEach((d, di) => {
      if (usedD.has(di)) return;
      next.push({ id: this.nextId++, box: d.box, keypoints: d.keypoints, score: d.score, vx: 0, vy: 0, hits: 1, streak: 1, firstSeen: t, lastSeen: t });
    });
    // Keep the largest `maxFaces`, preferring faces seen this frame.
    next.sort((a, b) => Number(b.lastSeen === t) - Number(a.lastSeen === t) || area(b.box) - area(a.box));
    this.tracks = next.slice(0, maxFaces).sort((a, b) => a.id - b.id);
    return this.tracks;
  }
}
