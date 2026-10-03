/** RFC 5545 §3.3.11 TEXT escaping: backslash, semicolon, comma and newlines. CR, LF and CRLF each become an escaped newline. */
export const icsText = (value: string): string => value.replace(/\\/g, "\\\\").replace(/\r\n?|\n/g, "\\n").replace(/[;,]/g, c => `\\${c}`);
