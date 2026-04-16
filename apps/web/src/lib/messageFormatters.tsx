'use client';

/**
 * Message text formatters for Slack, Telegram, and WhatsApp.
 *
 * We render the raw text that arrives from each messenger verbatim from the
 * database — so all formatting happens at display time here. No server-side
 * normalization or DB migration required.
 *
 * The rendered output is a React tree (never dangerouslySetInnerHTML), so
 * React's escaping gives us XSS protection by construction. URLs are only
 * turned into <a> elements when they match an http(s):// URL shape.
 */

import React, { type ReactNode } from 'react';
import * as emoji from 'node-emoji';
import Linkify from 'linkify-react';
import type { MessengerType } from '@/types/chat';

// ─── shared helpers ──────────────────────────────────────────────────────────

const LINKIFY_OPTIONS = {
  target: '_blank',
  rel: 'noopener noreferrer',
  className: 'underline text-accent hover:text-accent-hover',
  validate: {
    url: (value: string) => /^https?:\/\//.test(value),
  },
} as const;

/** Replace `:shortcode:` with the actual emoji. Leaves unknown codes alone. */
function emojifyString(text: string): string {
  return text.replace(/:([a-zA-Z0-9_+\-]+):/g, (match, code) => {
    const found = emoji.get(code);
    // node-emoji v2 returns the original `:code:` when not found; detect that.
    return found && found !== match ? found : match;
  });
}

/** Decode the three HTML entities Slack escapes. */
function decodeSlackEntities(text: string): string {
  return text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

/** Wrap plain text in <Linkify> so bare URLs become clickable. */
function linkifyPlain(text: string, keyPrefix: string): ReactNode {
  return (
    <Linkify key={keyPrefix} options={LINKIFY_OPTIONS} as="span">
      {text}
    </Linkify>
  );
}

/**
 * Apply a set of inline markdown rules to a plain-text segment, returning a
 * ReactNode. Rules are tried in order; each rule is a (regex, renderer) pair.
 * The renderer receives the regex match and must return a ReactNode; whatever
 * text is between matches is recursively tokenized with later rules.
 *
 * The final fallback (after all rules) is linkification + emoji substitution.
 */
interface InlineRule {
  pattern: RegExp;
  render: (match: RegExpExecArray, key: string) => ReactNode;
}

function tokenize(
  input: string,
  rules: InlineRule[],
  keyPrefix: string,
): ReactNode[] {
  if (!input) return [];
  if (rules.length === 0) {
    // Base case: linkify and emojify.
    const withEmoji = emojifyString(input);
    return [linkifyPlain(withEmoji, keyPrefix)];
  }
  const [rule, ...rest] = rules;
  const re = new RegExp(rule.pattern.source, rule.pattern.flags.replace('g', '') + 'g');
  const out: ReactNode[] = [];
  let lastIndex = 0;
  let i = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(input)) !== null) {
    if (match.index > lastIndex) {
      out.push(
        ...tokenize(input.slice(lastIndex, match.index), rest, `${keyPrefix}-${i}pre`),
      );
    }
    out.push(rule.render(match, `${keyPrefix}-${i}`));
    lastIndex = match.index + match[0].length;
    i += 1;
    if (match[0].length === 0) re.lastIndex += 1; // guard zero-width matches
  }
  if (lastIndex < input.length) {
    out.push(
      ...tokenize(input.slice(lastIndex), rest, `${keyPrefix}-${i}tail`),
    );
  }
  return out;
}

// ─── Slack ──────────────────────────────────────────────────────────────────

const SLACK_RULES: InlineRule[] = [
  // Triple-backtick code block first (before single-backtick).
  {
    pattern: /```([\s\S]+?)```/,
    render: (m, key) => (
      <pre
        key={key}
        className="my-1 whitespace-pre-wrap rounded bg-slate-100 px-2 py-1 font-mono text-xs"
      >
        {m[1]}
      </pre>
    ),
  },
  {
    pattern: /`([^`\n]+)`/,
    render: (m, key) => (
      <code key={key} className="rounded bg-slate-100 px-1 font-mono text-[0.9em]">
        {m[1]}
      </code>
    ),
  },
  // Slack link: <url|label> or <url>
  {
    pattern: /<(https?:\/\/[^|\s>]+)(?:\|([^>]+))?>/,
    render: (m, key) => (
      <a
        key={key}
        href={m[1]}
        target="_blank"
        rel="noopener noreferrer"
        className="underline text-accent hover:text-accent-hover"
      >
        {m[2] || m[1]}
      </a>
    ),
  },
  // User / channel / broadcast mentions
  {
    pattern: /<@([UW][A-Z0-9]+)(?:\|([^>]+))?>/,
    render: (m, key) => (
      <span key={key} className="font-medium text-accent">
        @{m[2] || m[1]}
      </span>
    ),
  },
  {
    pattern: /<#([CG][A-Z0-9]+)(?:\|([^>]+))?>/,
    render: (m, key) => (
      <span key={key} className="font-medium text-accent">
        #{m[2] || m[1]}
      </span>
    ),
  },
  {
    pattern: /<!(channel|here|everyone)>/,
    render: (m, key) => (
      <span key={key} className="font-medium text-accent">
        @{m[1]}
      </span>
    ),
  },
  // *bold* — require at least one char and no whitespace adjacent to markers
  {
    pattern: /\*([^\s*][^*\n]*?)\*/,
    render: (m, key) => <strong key={key}>{m[1]}</strong>,
  },
  // _italic_
  {
    pattern: /(?<![A-Za-z0-9_])_([^\s_][^_\n]*?)_(?![A-Za-z0-9_])/,
    render: (m, key) => <em key={key}>{m[1]}</em>,
  },
  // ~strike~
  {
    pattern: /~([^\s~][^~\n]*?)~/,
    render: (m, key) => <del key={key}>{m[1]}</del>,
  },
];

export function renderSlackMrkdwn(raw: string): ReactNode {
  const decoded = decodeSlackEntities(raw);
  return <>{tokenize(decoded, SLACK_RULES, 's')}</>;
}

// ─── Telegram ───────────────────────────────────────────────────────────────

const TELEGRAM_RULES: InlineRule[] = [
  {
    pattern: /```([\s\S]+?)```/,
    render: (m, key) => (
      <pre
        key={key}
        className="my-1 whitespace-pre-wrap rounded bg-slate-100 px-2 py-1 font-mono text-xs"
      >
        {m[1]}
      </pre>
    ),
  },
  {
    pattern: /`([^`\n]+)`/,
    render: (m, key) => (
      <code key={key} className="rounded bg-slate-100 px-1 font-mono text-[0.9em]">
        {m[1]}
      </code>
    ),
  },
  // **bold** or __bold__ (double markers = bold)
  {
    pattern: /\*\*([^\s*][^*\n]*?)\*\*/,
    render: (m, key) => <strong key={key}>{m[1]}</strong>,
  },
  {
    pattern: /__([^\s_][^_\n]*?)__/,
    render: (m, key) => <strong key={key}>{m[1]}</strong>,
  },
  // ~~strike~~
  {
    pattern: /~~([^\s~][^~\n]*?)~~/,
    render: (m, key) => <del key={key}>{m[1]}</del>,
  },
  // *italic* / _italic_ (single markers = italic in Telegram MarkdownV2 users
  // commonly type)
  {
    pattern: /(?<![*A-Za-z0-9])\*([^\s*][^*\n]*?)\*(?![*A-Za-z0-9])/,
    render: (m, key) => <em key={key}>{m[1]}</em>,
  },
  {
    pattern: /(?<![_A-Za-z0-9])_([^\s_][^_\n]*?)_(?![_A-Za-z0-9])/,
    render: (m, key) => <em key={key}>{m[1]}</em>,
  },
];

export function renderTelegramText(raw: string): ReactNode {
  return <>{tokenize(raw, TELEGRAM_RULES, 't')}</>;
}

// ─── WhatsApp ───────────────────────────────────────────────────────────────

const WHATSAPP_RULES: InlineRule[] = [
  {
    pattern: /```([\s\S]+?)```/,
    render: (m, key) => (
      <pre
        key={key}
        className="my-1 whitespace-pre-wrap rounded bg-slate-100 px-2 py-1 font-mono text-xs"
      >
        {m[1]}
      </pre>
    ),
  },
  {
    pattern: /`([^`\n]+)`/,
    render: (m, key) => (
      <code key={key} className="rounded bg-slate-100 px-1 font-mono text-[0.9em]">
        {m[1]}
      </code>
    ),
  },
  // *bold*
  {
    pattern: /(?<![*A-Za-z0-9])\*([^\s*][^*\n]*?)\*(?![*A-Za-z0-9])/,
    render: (m, key) => <strong key={key}>{m[1]}</strong>,
  },
  // _italic_
  {
    pattern: /(?<![_A-Za-z0-9])_([^\s_][^_\n]*?)_(?![_A-Za-z0-9])/,
    render: (m, key) => <em key={key}>{m[1]}</em>,
  },
  // ~strike~
  {
    pattern: /(?<![~A-Za-z0-9])~([^\s~][^~\n]*?)~(?![~A-Za-z0-9])/,
    render: (m, key) => <del key={key}>{m[1]}</del>,
  },
];

export function renderWhatsAppText(raw: string): ReactNode {
  return <>{tokenize(raw, WHATSAPP_RULES, 'w')}</>;
}

// ─── Chat-list preview ─────────────────────────────────────────────────────

/**
 * Cheap plain-text preview of a message for the chat-list last-message line.
 * Strips formatting markers, decodes Slack entities, resolves emoji shortcodes.
 */
export function previewText(
  raw: string | undefined | null,
  messenger: MessengerType,
): string {
  if (!raw) return '';
  let out = raw;
  if (messenger === 'slack') {
    out = decodeSlackEntities(out);
    // <url|label> → label; <url> → url
    out = out.replace(/<(https?:\/\/[^|\s>]+)(?:\|([^>]+))?>/g, (_m, url, label) => label || url);
    // <@U123|label> → @label or @U123
    out = out.replace(/<@([UW][A-Z0-9]+)(?:\|([^>]+))?>/g, (_m, id, label) => `@${label || id}`);
    out = out.replace(/<#([CG][A-Z0-9]+)(?:\|([^>]+))?>/g, (_m, id, label) => `#${label || id}`);
    out = out.replace(/<!(channel|here|everyone)>/g, '@$1');
    out = out.replace(/```([\s\S]+?)```/g, '$1');
    out = out.replace(/`([^`\n]+)`/g, '$1');
    out = out.replace(/\*([^\s*][^*\n]*?)\*/g, '$1');
    out = out.replace(/(?<![A-Za-z0-9_])_([^\s_][^_\n]*?)_(?![A-Za-z0-9_])/g, '$1');
    out = out.replace(/~([^\s~][^~\n]*?)~/g, '$1');
  } else if (messenger === 'telegram' || messenger === 'whatsapp') {
    out = out.replace(/```([\s\S]+?)```/g, '$1');
    out = out.replace(/`([^`\n]+)`/g, '$1');
    out = out.replace(/\*\*([^*\n]+?)\*\*/g, '$1');
    out = out.replace(/__([^_\n]+?)__/g, '$1');
    out = out.replace(/~~([^~\n]+?)~~/g, '$1');
    out = out.replace(/(?<![*A-Za-z0-9])\*([^\s*][^*\n]*?)\*(?![*A-Za-z0-9])/g, '$1');
    out = out.replace(/(?<![_A-Za-z0-9])_([^\s_][^_\n]*?)_(?![_A-Za-z0-9])/g, '$1');
    out = out.replace(/(?<![~A-Za-z0-9])~([^\s~][^~\n]*?)~(?![~A-Za-z0-9])/g, '$1');
  }
  return emojifyString(out);
}
