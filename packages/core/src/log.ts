const sensitive = /image|photo|portrait|token|secret|body|raw|password|authorization|cookie|api.?key|signature|payload|url/i;
/** Structured logging only. Provider errors become names; their messages/bodies are never retained. */
export function redact(input: unknown, seen = new WeakSet<object>()): unknown {
  if (input instanceof Error) return { error: "Error" };
  if (input === null || typeof input !== "object") return input;
  if (seen.has(input)) return "[Circular]";
  seen.add(input);
  if (input instanceof Uint8Array || input instanceof Blob) return "[Binary]";
  if (Array.isArray(input)) return input.map(x => redact(x, seen));
  return Object.fromEntries(Object.entries(input).filter(([key]) => !sensitive.test(key)).map(([key, value]) => [key, redact(value, seen)]));
}
export function createLogger(sink: (line: string) => void = line => console.info(line)) {
  return (event: string, fields: Record<string, unknown> = {}): void => {
    if (!/^[a-z][a-z0-9_.-]{0,79}$/.test(event)) throw new Error("LogEventMustBeIdentifier");
    sink(JSON.stringify({ event, fields: redact(fields) }));
  };
}
export const log = createLogger();
