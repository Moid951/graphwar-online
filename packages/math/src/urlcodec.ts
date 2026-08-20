/**
 * Java-compatible URL encoding/decoding (java.net.URLEncoder / URLDecoder).
 * Java leaves [A-Za-z0-9._-*] verbatim, encodes everything else as %XX (uppercase),
 * and encodes space as '+'. JS encodeURIComponent also leaves !~'() which Java
 * encodes, so they must be re-encoded here.
 */

export function javaUrlEncode(s: string): string {
  return encodeURIComponent(s)
    .replace(/[!'()~]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%20/g, "+");
}

export function javaUrlDecode(s: string): string {
  return decodeURIComponent(s.replace(/\+/g, " "));
}

/** Build a protocol line: fields are URL-encoded, joined by '&'. */
export function buildMessage(fields: (string | number)[]): string {
  return fields.map((f) => javaUrlEncode(String(f))).join("&");
}

/** Split a protocol line into its URL-decoded fields. */
export function splitMessage(line: string): string[] {
  return line.split("&").map((f) => javaUrlDecode(f));
}