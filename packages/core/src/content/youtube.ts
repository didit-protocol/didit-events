// A Markdown line that is only a YouTube link becomes a video embed on the public event page. Pure (no Node or DOM
// APIs): the server renderer (markdown.ts) and the editor's local preview share it.
const HOSTS = new Set(["youtu.be", "youtube.com", "www.youtube.com", "m.youtube.com"]);
const ID = /^[A-Za-z0-9_-]{11}$/;
/** The only iframe origin the description renderer emits and its sanitizer accepts. */
export const YOUTUBE_EMBED_SRC = /^https:\/\/www\.youtube-nocookie\.com\/embed\/[A-Za-z0-9_-]{11}(\?start=\d{1,6})?$/;
/** Inline, so the embed looks the same on the public page and in the editor preview: full width, 16:9, 12px corners. */
export const YOUTUBE_EMBED_STYLE = "display:block;width:100%;aspect-ratio:16 / 9;height:auto;border:0;border-radius:12px";
export const YOUTUBE_EMBED_ALLOW = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
export const YOUTUBE_EMBED_TITLE = "YouTube video";

/**
 * The youtube-nocookie embed URL of a line that is only a YouTube link (youtu.be/<id>, youtube.com/watch?v=<id>,
 * youtube.com/shorts/<id>), with its start time (`t=90`, `t=90s`, `start=90`) when it has one; null for anything else.
 */
export function youtubeEmbedSrc(line: string): string | null {
  const text = line.trim();
  if (!/^https:\/\/\S+$/.test(text) || text.length > 200) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || !HOSTS.has(url.hostname)) return null;
  const path = url.pathname.replace(/\/$/, "");
  const id = url.hostname === "youtu.be" ? path.slice(1) : path === "/watch" ? (url.searchParams.get("v") ?? "") : path.startsWith("/shorts/") ? path.slice("/shorts/".length) : "";
  if (!ID.test(id)) return null;
  const start = /^(\d{1,6})s?$/.exec(url.searchParams.get("t") ?? url.searchParams.get("start") ?? "")?.[1];
  return `https://www.youtube-nocookie.com/embed/${id}${start && Number(start) > 0 ? `?start=${Number(start)}` : ""}`;
}
