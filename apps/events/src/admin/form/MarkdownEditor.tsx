"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Button, TextField, cx } from "@didit-events/ui";
import { MarkdownPreview } from "./markdown";
import { safeHttpsUrl } from "./url";
import s from "./MarkdownEditor.module.css";

export interface MarkdownEditorProps {
  label: ReactNode;
  /** Posted as a hidden field with the Markdown source. */
  name?: string;
  value: string;
  onChange: (next: string) => void;
  onBlur?: () => void;
  maxLength: number;
  placeholder?: string;
  hint?: ReactNode;
  error?: string;
  readOnly?: boolean;
  /** Emails do not load remote images (tracking): the image button is hidden. */
  allowImages?: boolean;
  rows?: number;
  /** The server's sanitized rendering when it is available; the local safe preview otherwise. */
  renderPreview?: (source: string) => ReactNode;
  /** The public page's renderer (sanitised HTML, null on failure): Preview shows its output, the local preview meanwhile. */
  render?: RenderMarkdown;
}

export type RenderMarkdown = (source: string) => Promise<string | null>;

/**
 * Preview through the public page's renderer, so staff see exactly what guests get. The local safe preview stays
 * up while the request runs and when it fails (offline, signed out), so the tab is never empty.
 */
export function RenderedPreview({ source, render, className }: { source: string; render: RenderMarkdown; className?: string }) {
  const [result, setResult] = useState<{ source: string; html: string | null } | null>(null);
  useEffect(() => {
    let live = true;
    render(source).then(
      (html) => live && setResult({ source, html }),
      () => live && setResult({ source, html: null }),
    );
    return () => {
      live = false;
    };
  }, [source, render]);
  const html = result?.source === source ? result.html : null;
  // The HTML comes from renderSafeMarkdown (the public page's sanitiser): the same string guests are served.
  if (html !== null) return <div className={className} data-preview="public" dangerouslySetInnerHTML={{ __html: html }} />;
  return (
    <div aria-busy={result?.source !== source || undefined} data-preview="local">
      <MarkdownPreview source={source} className={className} />
    </div>
  );
}

type Edit = { text: string; start: number; end: number };
type Insert = { kind: "link" | "image"; url: string; text: string; error?: string };

/** Wrap the selection (or a placeholder word) in a marker: **bold**, _italic_. */
export function wrap(v: string, start: number, end: number, marker: string, placeholder: string): Edit {
  const picked = v.slice(start, end) || placeholder;
  const text = v.slice(0, start) + marker + picked + marker + v.slice(end);
  return { text, start: start + marker.length, end: start + marker.length + picked.length };
}

/** Prefix every line the selection touches ("## ", "- "); a second press removes it. */
export function prefixLines(v: string, start: number, end: number, prefix: string): Edit {
  const from = v.lastIndexOf("\n", start - 1) + 1;
  const toNl = v.indexOf("\n", end);
  const to = toNl === -1 ? v.length : toNl;
  const lines = v.slice(from, to).split("\n");
  const on = lines.every((l) => l.startsWith(prefix));
  const next = lines.map((l) => (on ? l.slice(prefix.length) : prefix + l.replace(/^(#{1,6}\s+|[-*+]\s+)/, ""))).join("\n");
  const text = v.slice(0, from) + next + v.slice(to);
  return { text, start: from, end: from + next.length };
}

/** A Markdown link or image at the selection. */
export function insertLink(v: string, start: number, end: number, kind: "link" | "image", url: string, label: string): Edit {
  const text0 = label.replace(/[[\]]/g, "") || (kind === "image" ? "" : "link");
  const md = kind === "image" ? `![${text0}](${url})` : `[${text0}](${url})`;
  const text = v.slice(0, start) + md + v.slice(end);
  return { text, start: start + md.length, end: start + md.length };
}

/**
 * Markdown editor of the event description (create and edit): toolbar (bold, italic, heading, list, link, image
 * URL), Write / Preview tabs, and a safe preview. Links and images accept HTTPS URLs only, as the renderer does.
 */
export function MarkdownEditor({ label, name, value, onChange, onBlur, maxLength, placeholder, hint, error, readOnly, allowImages = true, rows = 10, renderPreview, render }: MarkdownEditorProps) {
  const ids = useId();
  const area = useRef<HTMLTextAreaElement>(null);
  const [tab, setTab] = useState<"write" | "preview">("write");
  const [insert, setInsert] = useState<Insert | null>(null);
  const pendingSel = useRef<[number, number] | null>(null);
  const range = useRef<[number, number]>([0, 0]);

  useLayoutEffect(() => {
    const sel = pendingSel.current;
    if (sel && area.current && tab === "write") {
      area.current.focus();
      area.current.setSelectionRange(sel[0], sel[1]);
      pendingSel.current = null;
    }
  });

  const selection = (): [number, number] => {
    const el = area.current;
    return el ? [el.selectionStart, el.selectionEnd] : [value.length, value.length];
  };
  const apply = (e: Edit) => {
    if (readOnly) return;
    pendingSel.current = [e.start, e.end];
    onChange(e.text);
  };
  const tool = (kind: "bold" | "italic" | "heading" | "list") => {
    const [a, b] = selection();
    if (kind === "bold") apply(wrap(value, a, b, "**", "bold text"));
    else if (kind === "italic") apply(wrap(value, a, b, "_", "italic text"));
    else apply(prefixLines(value, a, b, kind === "heading" ? "## " : "- "));
  };
  const openInsert = (kind: Insert["kind"]) => {
    range.current = selection();
    const [a, b] = range.current;
    setInsert({ kind, url: "", text: value.slice(a, b) });
  };
  const confirmInsert = () => {
    if (!insert) return;
    const url = safeHttpsUrl(insert.url);
    if (!url) return setInsert({ ...insert, error: "Use a full https:// address" });
    const [a, b] = range.current;
    setInsert(null);
    apply(insertLink(value, a, b, insert.kind, url, insert.text));
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    const k = e.key.toLowerCase();
    if (k === "b" || k === "i") {
      e.preventDefault();
      tool(k === "b" ? "bold" : "italic");
    } else if (k === "k") {
      e.preventDefault();
      openInsert("link");
    }
  };

  const count = Array.from(value).length;
  const describedBy = [error ? `${ids}-err` : null, `${ids}-hint`].filter(Boolean).join(" ");
  const tools: { key: "bold" | "italic" | "heading" | "list" | "link" | "image"; label: string; glyph: ReactNode; shortcut?: string }[] = [
    { key: "bold", label: "Bold", glyph: <b>B</b>, shortcut: "Control+B" },
    { key: "italic", label: "Italic", glyph: <i>I</i>, shortcut: "Control+I" },
    { key: "heading", label: "Heading", glyph: "H" },
    { key: "list", label: "Bulleted list", glyph: "•≡" },
    { key: "link", label: "Link", glyph: "🔗", shortcut: "Control+K" },
    ...(allowImages ? [{ key: "image" as const, label: "Image from URL", glyph: "🖼" }] : []),
  ];

  return (
    <div className={s.root} data-invalid={error ? "" : undefined}>
      <div className={s.top}>
        <label className={s.label} htmlFor={`${ids}-area`} id={`${ids}-label`}>
          {label}
        </label>
        <div role="tablist" aria-label="Editor mode" className={s.tabs}>
          {(["write", "preview"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              id={`${ids}-tab-${t}`}
              aria-selected={tab === t}
              aria-controls={`${ids}-panel-${t}`}
              className={s.tab}
              onClick={() => {
                setTab(t);
                setInsert(null);
              }}
            >
              {t === "write" ? "Write" : "Preview"}
            </button>
          ))}
        </div>
      </div>
      <div className={s.box}>
        {tab === "write" ? (
          <div role="tabpanel" id={`${ids}-panel-write`} aria-labelledby={`${ids}-tab-write`} className={s.panel}>
            <div role="toolbar" aria-label="Formatting" aria-controls={`${ids}-area`} className={s.toolbar}>
              {tools.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className={s.tool}
                  aria-label={t.label}
                  title={t.shortcut ? `${t.label} (${t.shortcut.replace("Control", "Ctrl")})` : t.label}
                  aria-keyshortcuts={t.shortcut}
                  disabled={readOnly}
                  // Keep the textarea's selection: the button must not take focus on mouse down.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => (t.key === "link" || t.key === "image" ? openInsert(t.key) : tool(t.key))}
                >
                  <span aria-hidden="true">{t.glyph}</span>
                </button>
              ))}
            </div>
            {insert ? (
              <div className={s.insert} role="group" aria-label={insert.kind === "image" ? "Insert image" : "Insert link"}>
                <TextField
                  label={insert.kind === "image" ? "Image URL" : "Link URL"}
                  placeholder="https://"
                  value={insert.url}
                  autoFocus
                  inputMode="url"
                  error={insert.error}
                  onChange={(e) => setInsert({ ...insert, url: e.target.value, error: undefined })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      confirmInsert();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      setInsert(null);
                      area.current?.focus();
                    }
                  }}
                />
                <TextField
                  label={insert.kind === "image" ? "Alt text" : "Link text"}
                  value={insert.text}
                  maxLength={200}
                  onChange={(e) => setInsert({ ...insert, text: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      confirmInsert();
                    }
                  }}
                />
                <div className={s.insertActions}>
                  <Button size="sm" variant="secondary" onClick={confirmInsert}>
                    Insert
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setInsert(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}
            <textarea
              ref={area}
              id={`${ids}-area`}
              className={s.area}
              value={value}
              rows={rows}
              placeholder={placeholder}
              readOnly={readOnly}
              aria-invalid={error ? true : undefined}
              aria-describedby={describedBy}
              onChange={(e) => onChange(e.target.value)}
              onBlur={onBlur}
              onKeyDown={onKey}
            />
          </div>
        ) : (
          <div role="tabpanel" id={`${ids}-panel-preview`} aria-labelledby={`${ids}-tab-preview`} className={cx(s.panel, s.previewPanel)} tabIndex={0}>
            {value.trim() ? (
              renderPreview ? renderPreview(value) : render ? <RenderedPreview source={value} render={render} className={s.preview} /> : <MarkdownPreview source={value} className={s.preview} />
            ) : (
              <p className={s.empty}>Nothing to preview yet.</p>
            )}
          </div>
        )}
      </div>
      {name ? <input type="hidden" name={name} value={value} /> : null}
      <div className={s.foot}>
        <span id={`${ids}-hint`} className={s.hint}>
          {hint ?? "Markdown: **bold**, _italic_, ## heading, - list, [link](https://…)"}
        </span>
        <span className={s.count} data-over={count > maxLength ? "" : undefined} aria-live="polite">
          {count.toLocaleString("en-US")}/{maxLength.toLocaleString("en-US")}
        </span>
      </div>
      {error ? (
        <span id={`${ids}-err`} className={s.error} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
