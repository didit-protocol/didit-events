/**
 * Editor preview of the event description (Markdown). Safe by construction: the source becomes React elements,
 * never an HTML string, so raw HTML is shown as text and nothing is parsed by the browser. It follows the
 * renderSafeMarkdown allowlist of docs/event-model-v2.md: p, h2–h4 (h1 demoted), lists, emphasis, blockquote,
 * code/pre, HTTPS links and HTTPS images; other URLs render as plain text. A line that is only a YouTube link is the
 * video embed the public page shows. Bounded: one pass per line, inline
 * nesting depth 3, input capped at the description limit.
 *
 * STUB until lane A's server renderer is wired: the editor can take `renderPreview` (the server's
 * `descriptionHtml`) instead, so preview and public page share one sanitizer.
 */
import type { ReactNode } from "react";
import { YOUTUBE_EMBED_ALLOW, YOUTUBE_EMBED_TITLE, youtubeEmbedSrc } from "@didit-events/core/content/youtube";
import { DESCRIPTION_MD_MAX, safeHttpsUrl } from "./url";

export { DESCRIPTION_MD_MAX, safeHttpsUrl };

const INLINE = /(\*\*([^*]+?)\*\*|__([^_]+?)__|\*([^*\s][^*]*?)\*|_([^_\s][^_]*?)_|`([^`]+)`|!\[([^\]]{0,200})\]\(([^)\s]{1,2048})\)|\[([^\]]{1,500})\]\(([^)\s]{1,2048})\))/;

function inline(text: string, key: string, depth = 0): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let i = 0;
  while (rest) {
    const m = depth < 3 ? INLINE.exec(rest) : null;
    if (!m) {
      out.push(rest);
      break;
    }
    if (m.index) out.push(rest.slice(0, m.index));
    const k = `${key}.${i++}`;
    if (m[2] !== undefined || m[3] !== undefined) out.push(<strong key={k}>{inline(m[2] ?? m[3]!, k, depth + 1)}</strong>);
    else if (m[4] !== undefined || m[5] !== undefined) out.push(<em key={k}>{inline(m[4] ?? m[5]!, k, depth + 1)}</em>);
    else if (m[6] !== undefined) out.push(<code key={k}>{m[6]}</code>);
    else if (m[8] !== undefined) {
      const src = safeHttpsUrl(m[8]);
      // eslint-disable-next-line @next/next/no-img-element
      out.push(src ? <img key={k} src={src} alt={m[7] ?? ""} loading="lazy" referrerPolicy="no-referrer" /> : m[0]);
    } else {
      const href = safeHttpsUrl(m[10]!);
      out.push(
        href ? (
          <a key={k} href={href} target="_blank" rel="noopener noreferrer nofollow">
            {inline(m[9]!, k, depth + 1)}
          </a>
        ) : (
          m[9]
        ),
      );
    }
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

type Block =
  | { t: "p"; lines: string[] }
  | { t: "h"; level: 2 | 3 | 4; text: string }
  | { t: "ul" | "ol"; items: string[] }
  | { t: "quote"; lines: string[] }
  | { t: "code"; lines: string[] }
  | { t: "video"; src: string };

export function parseBlocks(source: string): Block[] {
  const lines = source.slice(0, DESCRIPTION_MD_MAX).replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let cur = null as Block | null;
  const flush = () => {
    if (cur) blocks.push(cur);
    cur = null;
  };
  for (const line of lines) {
    if (cur?.t === "code") {
      if (/^\s*```/.test(line)) flush();
      else cur.lines.push(line);
      continue;
    }
    if (/^\s*```/.test(line)) {
      flush();
      cur = { t: "code", lines: [] };
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flush();
      // h1 is the event name on the page: demote it; anything deeper than h4 renders as h4.
      blocks.push({ t: "h", level: Math.min(4, Math.max(2, h[1]!.length)) as 2 | 3 | 4, text: h[2]!.trim() });
      continue;
    }
    const ul = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ol = /^\s*\d{1,9}[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      const t = ul ? "ul" : "ol";
      if (cur?.t !== t) {
        flush();
        cur = { t, items: [] };
      }
      (cur as { items: string[] }).items.push((ul ?? ol)![1]!);
      continue;
    }
    const video = /^ {0,3}\S/.test(line) ? youtubeEmbedSrc(line) : null;
    if (video) {
      flush();
      blocks.push({ t: "video", src: video });
      continue;
    }
    const q = /^\s*>\s?(.*)$/.exec(line);
    if (q) {
      if (cur?.t !== "quote") {
        flush();
        cur = { t: "quote", lines: [] };
      }
      cur.lines.push(q[1]!);
      continue;
    }
    if (cur?.t !== "p") {
      flush();
      cur = { t: "p", lines: [] };
    }
    cur.lines.push(line.trim());
  }
  flush();
  return blocks;
}

const withBreaks = (lines: string[], key: string) => lines.flatMap((l, i) => (i ? [<br key={`${key}br${i}`} />, ...inline(l, `${key}l${i}`)] : inline(l, `${key}l${i}`)));

/** The Markdown source as safe React elements. */
export function MarkdownPreview({ source, className }: { source: string; className?: string }) {
  const blocks = parseBlocks(source);
  return (
    <div className={className}>
      {blocks.map((b, i) => {
        const k = `b${i}`;
        switch (b.t) {
          case "h": {
            const H = `h${b.level}` as const;
            return <H key={k}>{inline(b.text, k)}</H>;
          }
          case "ul":
            return <ul key={k}>{b.items.map((it, j) => <li key={j}>{inline(it, `${k}i${j}`)}</li>)}</ul>;
          case "ol":
            return <ol key={k}>{b.items.map((it, j) => <li key={j}>{inline(it, `${k}i${j}`)}</li>)}</ol>;
          case "quote":
            return <blockquote key={k}>{withBreaks(b.lines, k)}</blockquote>;
          case "video":
            return (
              <iframe
                key={k}
                src={b.src}
                title={YOUTUBE_EMBED_TITLE}
                loading="lazy"
                allow={YOUTUBE_EMBED_ALLOW}
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
                style={{ display: "block", width: "100%", aspectRatio: "16 / 9", height: "auto", border: 0, borderRadius: 12 }}
              />
            );
          case "code":
            return (
              <pre key={k}>
                <code>{b.lines.join("\n")}</code>
              </pre>
            );
          default:
            return <p key={k}>{withBreaks(b.lines, k)}</p>;
        }
      })}
    </div>
  );
}
