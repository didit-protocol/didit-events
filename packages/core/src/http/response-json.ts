/** Provider response limit applies to decoded bytes, including chunked/compressed responses. */
export const PROVIDER_JSON_MAX_BYTES = 512 * 1024;
export class ResponseTooLarge extends Error {
  constructor() { super("ProviderResponseTooLarge"); }
}

export async function responseJson(response: Response): Promise<unknown> {
  const length = response.headers.get("content-length");
  if (length !== null && Number(length) > PROVIDER_JSON_MAX_BYTES) {
    await response.body?.cancel();
    throw new ResponseTooLarge();
  }
  const reader = response.body?.getReader();
  if (!reader) throw new SyntaxError("EmptyProviderResponse");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > PROVIDER_JSON_MAX_BYTES) {
        await reader.cancel();
        throw new ResponseTooLarge();
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
