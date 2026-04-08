// ─── Gmail MIME payload parser & HTML sanitizer ───
// Walks the Gmail message payload tree to extract text/html, text/plain,
// headers, and inline images. Sanitizes HTML and rewrites external image
// URLs to our own /api/image-proxy endpoint.

import type { gmail_v1 } from 'googleapis';
import { createHmac } from 'node:crypto';
import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';

/**
 * Sign an image URL with the same canonical HMAC the API verifies in
 * `apps/api/src/routes/image-proxy.ts`. Both sides must stay in sync.
 */
function signImageUrl(rawUrl: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET not set — required for image-proxy signing');
  return createHmac('sha256', secret).update(`image-proxy:v1:${rawUrl}`).digest('hex');
}

// Create a single JSDOM window + DOMPurify instance for the whole process.
const jsdomWindow = new JSDOM('').window;
// DOMPurify types expect a browser-like Window; jsdom's window is close enough.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const DOMPurify = createDOMPurify(jsdomWindow as any);

const MAX_HTML_BYTES = 1024 * 1024; // 1 MB safety cap

export interface ParsedEmail {
  subject: string | undefined;
  fromEmail: string | undefined;
  fromName: string | undefined;
  toEmails: string[];
  ccEmails: string[];
  bccEmails: string[];
  inReplyTo: string | undefined;
  plainBody: string | undefined;
  htmlBody: string | undefined; // sanitized + image URLs rewritten
}

/**
 * Decode a base64url payload string (Gmail uses URL-safe base64).
 */
function decodeBase64Url(data: string): string {
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64').toString('utf-8');
}

function decodeBase64UrlToBuffer(data: string): Buffer {
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64');
}

/**
 * Extract a header value from the payload headers list (case-insensitive).
 */
function getHeader(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const h = headers.find((x) => x.name?.toLowerCase() === name.toLowerCase());
  return h?.value ?? undefined;
}

/**
 * Parse an address list header like "Alice <a@x.com>, Bob <b@y.com>" → ["a@x.com", "b@y.com"].
 * Keeps the raw address if no angle brackets are present.
 */
function parseAddressList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .map((s) => {
      const m = s.match(/<([^>]+)>/);
      return (m ? m[1] : s).trim();
    })
    .filter(Boolean);
}

/**
 * Parse a single "From: Name <email@x.com>" header.
 */
function parseSingleAddress(raw: string | undefined): { name?: string; email?: string } {
  if (!raw) return {};
  const m = raw.match(/^(.*?)<([^>]+)>\s*$/);
  if (m) {
    return { name: m[1]!.trim().replace(/^"|"$/g, ''), email: m[2]!.trim() };
  }
  return { email: raw.trim() };
}

/**
 * Walk the payload tree and collect parts by mimeType.
 * Also collects inline attachments (for cid: resolution).
 */
interface CollectedParts {
  html?: string;
  plain?: string;
  inlineImages: Map<string, { mimeType: string; data: Buffer }>;
}

function walkParts(
  part: gmail_v1.Schema$MessagePart | undefined,
  out: CollectedParts,
): void {
  if (!part) return;

  const mimeType = part.mimeType ?? '';
  const body = part.body;

  // Leaf part with inline content
  if (body?.data) {
    if (mimeType === 'text/html' && !out.html) {
      out.html = decodeBase64Url(body.data);
    } else if (mimeType === 'text/plain' && !out.plain) {
      out.plain = decodeBase64Url(body.data);
    } else if (mimeType.startsWith('image/')) {
      // Inline image with embedded data
      const contentId = getHeader(part.headers, 'Content-ID')?.replace(/^<|>$/g, '');
      if (contentId) {
        out.inlineImages.set(contentId, {
          mimeType,
          data: decodeBase64UrlToBuffer(body.data),
        });
      }
    }
  }

  // Recurse into sub-parts
  if (part.parts && part.parts.length > 0) {
    for (const subPart of part.parts) {
      walkParts(subPart, out);
    }
  }
}

/**
 * Sanitize HTML and rewrite <img src="..."> to go through /api/image-proxy.
 * Also resolves cid: references to inline base64 data-URLs.
 */
function sanitizeAndRewriteHtml(
  rawHtml: string,
  inlineImages: Map<string, { mimeType: string; data: Buffer }>,
): string {
  // 1. Sanitize. Allow common email tags and inline styles.
  let clean = DOMPurify.sanitize(rawHtml, {
    WHOLE_DOCUMENT: false,
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['script', 'object', 'embed', 'iframe', 'form', 'input', 'meta', 'link'],
    FORBID_ATTR: [
      'onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur',
      'onchange', 'onsubmit', 'onreset', 'onselect', 'onkeydown', 'onkeyup',
      'onkeypress', 'ondblclick', 'onmousedown', 'onmouseup', 'onmousemove',
      'onmouseout', 'onabort', 'oncanplay', 'onended', 'onpause', 'onplay',
    ],
  }) as string;

  // 2. Resolve cid: references → data-URLs (inline images).
  if (inlineImages.size > 0) {
    clean = clean.replace(
      /(<img[^>]*\ssrc=["'])cid:([^"']+)(["'])/gi,
      (match, prefix, cid, suffix) => {
        const inline = inlineImages.get(cid);
        if (!inline) return match;
        const dataUrl = `data:${inline.mimeType};base64,${inline.data.toString('base64')}`;
        return `${prefix}${dataUrl}${suffix}`;
      },
    );
  }

  // 3. Rewrite external image URLs → /api/image-proxy?url=...&sig=...
  //    Signing prevents the proxy from being used as an open relay — only
  //    URLs that were actually embedded in a sanitised email at ingest time
  //    will be fetched.
  clean = clean.replace(
    /(<img[^>]*\ssrc=["'])(https?:\/\/[^"']+)(["'])/gi,
    (_match, prefix, url, suffix) => {
      const sig = signImageUrl(url);
      const proxied = `/api/image-proxy?url=${encodeURIComponent(url)}&sig=${sig}`;
      return `${prefix}${proxied}${suffix}`;
    },
  );

  // 4. Size cap — protect frontend from pathological emails.
  if (Buffer.byteLength(clean, 'utf-8') > MAX_HTML_BYTES) {
    clean = clean.slice(0, MAX_HTML_BYTES) + '\n<!-- truncated -->';
  }

  return clean;
}

/**
 * Parse a full Gmail message into a structured email object.
 */
export function parseGmailMessage(msg: gmail_v1.Schema$Message): ParsedEmail {
  const headers = msg.payload?.headers ?? [];

  const subject = getHeader(headers, 'Subject');
  const fromRaw = getHeader(headers, 'From');
  const toRaw = getHeader(headers, 'To');
  const ccRaw = getHeader(headers, 'Cc');
  const bccRaw = getHeader(headers, 'Bcc');
  const inReplyTo = getHeader(headers, 'In-Reply-To');

  const { name: fromName, email: fromEmail } = parseSingleAddress(fromRaw);

  // Walk the MIME tree.
  const collected: CollectedParts = { inlineImages: new Map() };
  walkParts(msg.payload ?? undefined, collected);

  // If nothing collected but there's a top-level body (simple text/plain email),
  // try decoding it directly.
  if (!collected.html && !collected.plain && msg.payload?.body?.data) {
    const mimeType = msg.payload.mimeType ?? '';
    const decoded = decodeBase64Url(msg.payload.body.data);
    if (mimeType === 'text/html') {
      collected.html = decoded;
    } else {
      collected.plain = decoded;
    }
  }

  const htmlBody = collected.html
    ? sanitizeAndRewriteHtml(collected.html, collected.inlineImages)
    : undefined;

  return {
    subject,
    fromEmail,
    fromName,
    toEmails: parseAddressList(toRaw),
    ccEmails: parseAddressList(ccRaw),
    bccEmails: parseAddressList(bccRaw),
    inReplyTo,
    plainBody: collected.plain,
    htmlBody,
  };
}
