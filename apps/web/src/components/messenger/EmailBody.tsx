'use client';

// ─── EmailBody ───
// Renders a sanitized HTML email body inside a sandboxed <iframe>.
// Falls back to plain text if HTML is missing.
//
// Security & isolation:
//   - sandbox WITHOUT "allow-scripts" — no JS can run inside the email
//   - sandbox WITH "allow-same-origin" — required so the parent can read
//     `iframe.contentDocument` to measure body.scrollHeight for auto-sizing.
//     Without allow-same-origin, contentDocument is null (opaque origin)
//     and the iframe stays at INITIAL_HEIGHT forever. This combo
//     (same-origin but no scripts) is documented as safe in the MDN
//     sandbox attribute reference — no untrusted JS can exploit the
//     same-origin relationship.
//   - <base target="_blank"> — every link opens in a new tab
//   - CSS reset injected so email styles don't leak into the app
//   - Images constrained to max-width:100% so wide emails don't overflow

import { useEffect, useMemo, useRef, useState } from 'react';

interface EmailBodyProps {
  html?: string | null;
  fallbackText?: string | null;
}

// Initial height is generous so the iframe is visible *before* we get a
// chance to measure the real content. If we started at a tiny value and
// `body.scrollHeight` came back 0 on the initial `onLoad` tick (e.g. because
// images haven't loaded yet or layout hasn't settled), the user would see an
// empty sliver. A bigger initial gives us breathing room; the real height
// takes over as soon as the ResizeObserver fires.
const INITIAL_HEIGHT = 400;
const MIN_HEIGHT = 80;
const EXTRA_PAD = 24;

// The worker stores HTML with relative `/api/image-proxy?...` URLs so the
// content is environment-agnostic. At render time we rewrite them to the
// absolute API origin so the sandboxed srcDoc iframe (opaque origin,
// base URL = parent document) reaches the API instead of the web origin.
const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

function absolutizeImageProxyUrls(html: string): string {
  if (!API_BASE) return html;
  return html.replace(
    /(<img[^>]*\ssrc=["'])\/api\/image-proxy/gi,
    (_m, prefix) => `${prefix}${API_BASE}/api/image-proxy`,
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string),
  );
}

function buildSrcDoc(html: string | null | undefined, fallback: string | null | undefined): string {
  const baseStyles = `
    html, body {
      margin: 0;
      padding: 16px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      color: #1a1a1a;
      background: #ffffff;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }
    body { overflow: hidden; }
    img { max-width: 100% !important; height: auto !important; display: inline-block; }
    table { max-width: 100% !important; }
    a { color: #2563eb; text-decoration: underline; }
    blockquote {
      border-left: 3px solid #e5e7eb;
      margin: 8px 0;
      padding: 4px 12px;
      color: #6b7280;
    }
    pre { white-space: pre-wrap; word-wrap: break-word; }
  `;

  if (html && html.trim()) {
    const rewritten = absolutizeImageProxyUrls(html);
    return `<!DOCTYPE html><html><head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <base target="_blank">
      <style>${baseStyles}</style>
    </head><body>${rewritten}</body></html>`;
  }

  const text = fallback ?? '';
  return `<!DOCTYPE html><html><head>
    <meta charset="utf-8">
    <base target="_blank">
    <style>${baseStyles}</style>
  </head><body><pre>${escapeHtml(text)}</pre></body></html>`;
}

export function EmailBody({ html, fallbackText }: EmailBodyProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const [height, setHeight] = useState<number>(INITIAL_HEIGHT);

  const srcDoc = useMemo(() => buildSrcDoc(html, fallbackText), [html, fallbackText]);

  const recalcHeight = () => {
    const iframe = iframeRef.current;
    if (!iframe?.contentDocument) return;
    const doc = iframe.contentDocument;
    const body = doc.body;
    const root = doc.documentElement;
    if (!body && !root) return;
    const h = Math.max(
      body?.scrollHeight ?? 0,
      body?.offsetHeight ?? 0,
      root?.scrollHeight ?? 0,
      root?.offsetHeight ?? 0,
    );
    setHeight(Math.max(h + EXTRA_PAD, MIN_HEIGHT));
  };

  // Clean up any previous observer when srcDoc changes (new email opened).
  // We intentionally do NOT reset to MIN_HEIGHT — keep the previous (or
  // initial) height so there is no empty-sliver flash while the new iframe
  // loads. The observer will update to the correct size on load.
  useEffect(() => {
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
    };
  }, [srcDoc]);

  // Recalculate when iframe content loads. We install a ResizeObserver on
  // the iframe's internal <body> so that layout changes (images loading,
  // web fonts, lazy content) continue to re-measure after the initial
  // `load` event. Also attach per-image load/error listeners as a safety
  // net for browsers where ResizeObserver doesn't fire on img replacement.
  const handleLoad = () => {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    const body = doc?.body;
    if (!iframe || !doc || !body) return;

    recalcHeight();

    // Tear down any previous observer before installing a new one.
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => recalcHeight());
      ro.observe(body);
      if (doc.documentElement) ro.observe(doc.documentElement);
      observerRef.current = ro;
    }

    // Recalculate once each image finishes loading. Images in Gmail emails
    // are fetched through the API image-proxy and can land after `load`.
    const images = Array.from(body.querySelectorAll('img')) as HTMLImageElement[];
    images.forEach((img) => {
      if (!img.complete) {
        img.addEventListener('load', recalcHeight, { once: true });
        img.addEventListener('error', recalcHeight, { once: true });
      }
    });

    // Safety-net delayed recalculations for web fonts and slow images.
    setTimeout(recalcHeight, 300);
    setTimeout(recalcHeight, 1500);
  };

  return (
    <iframe
      ref={iframeRef}
      srcDoc={srcDoc}
      sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin"
      onLoad={handleLoad}
      title="email-body"
      className="block w-full border-0 bg-white"
      style={{ height }}
    />
  );
}
