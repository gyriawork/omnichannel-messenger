'use client';

// ─── EmailBody ───
// Renders a sanitized HTML email body inside a sandboxed <iframe>.
// Falls back to plain text if HTML is missing.
//
// Security & isolation:
//   - sandbox without "allow-scripts" — no JS can run inside the email
//   - <base target="_blank"> — every link opens in a new tab
//   - CSS reset injected so email styles don't leak into the app
//   - Images constrained to max-width:100% so wide emails don't overflow

import { useEffect, useMemo, useRef, useState } from 'react';

interface EmailBodyProps {
  html?: string | null;
  fallbackText?: string | null;
}

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
  const [height, setHeight] = useState<number>(MIN_HEIGHT);

  const srcDoc = useMemo(() => buildSrcDoc(html, fallbackText), [html, fallbackText]);

  const recalcHeight = () => {
    const iframe = iframeRef.current;
    if (!iframe?.contentDocument) return;
    const body = iframe.contentDocument.body;
    if (!body) return;
    const h = Math.max(body.scrollHeight, body.offsetHeight);
    setHeight(Math.max(h + EXTRA_PAD, MIN_HEIGHT));
  };

  // Recalculate when iframe content loads
  const handleLoad = () => {
    recalcHeight();
    // Some emails load images after the initial load event — recalc after a short delay.
    const timer1 = setTimeout(recalcHeight, 200);
    const timer2 = setTimeout(recalcHeight, 800);
    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
    };
  };

  // Reset height when srcDoc changes (new email opened)
  useEffect(() => {
    setHeight(MIN_HEIGHT);
  }, [srcDoc]);

  return (
    <iframe
      ref={iframeRef}
      srcDoc={srcDoc}
      sandbox="allow-popups allow-popups-to-escape-sandbox"
      onLoad={handleLoad}
      title="email-body"
      className="block w-full border-0 bg-white"
      style={{ height }}
    />
  );
}
