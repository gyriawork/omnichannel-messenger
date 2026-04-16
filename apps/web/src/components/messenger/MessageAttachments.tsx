'use client';

import { Paperclip, Play, Music } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MessageAttachment } from '@/hooks/useChats';

interface MessageAttachmentsProps {
  attachments: MessageAttachment[];
  /** Styling context — changes chip background for "own" messages. */
  variant?: 'self' | 'other';
  className?: string;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

/** Rewrite a relative `/api/…` URL into an absolute one pointing at the API origin. */
function resolveUrl(url: string): string {
  if (!url) return url;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url.startsWith('/')) return `${API_BASE}${url}`;
  return url;
}

function formatSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function MessageAttachments({
  attachments,
  variant = 'other',
  className,
}: MessageAttachmentsProps) {
  if (!attachments || attachments.length === 0) return null;

  return (
    <div className={cn('mt-1.5 space-y-1.5', className)}>
      {attachments.map((att, i) => {
        const url = resolveUrl(att.url);
        const mime = att.mimeType || '';
        if (mime.startsWith('image/')) {
          return (
            <a
              key={i}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="block overflow-hidden rounded-lg"
              title={att.filename}
            >
              <img
                src={url}
                alt={att.filename}
                loading="lazy"
                className="max-h-80 w-auto max-w-full rounded-lg border border-slate-200 object-contain"
              />
            </a>
          );
        }

        if (mime.startsWith('video/')) {
          return (
            <video
              key={i}
              src={url}
              controls
              preload="metadata"
              className="max-h-80 w-full max-w-sm rounded-lg border border-slate-200"
            >
              <a href={url} target="_blank" rel="noopener noreferrer">
                {att.filename}
              </a>
            </video>
          );
        }

        if (mime.startsWith('audio/')) {
          return (
            <div
              key={i}
              className={cn(
                'flex items-center gap-2 rounded-lg p-2 text-xs',
                variant === 'self'
                  ? 'bg-white/10'
                  : 'bg-slate-50',
              )}
            >
              <Music className="h-3.5 w-3.5 flex-shrink-0" />
              <audio src={url} controls preload="metadata" className="h-8 max-w-full flex-1" />
            </div>
          );
        }

        // Default: paperclip chip linking to the file.
        return (
          <a
            key={i}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              'flex items-center gap-2 rounded-lg p-2 text-xs transition-colors',
              variant === 'self'
                ? 'bg-white/10 hover:bg-white/20'
                : 'bg-slate-50 hover:bg-slate-100',
            )}
          >
            {mime.startsWith('video/') ? (
              <Play className="h-3.5 w-3.5 flex-shrink-0" />
            ) : (
              <Paperclip className="h-3.5 w-3.5 flex-shrink-0" />
            )}
            <span className="truncate">{att.filename}</span>
            {att.size > 0 && (
              <span className="flex-shrink-0 opacity-60">{formatSize(att.size)}</span>
            )}
          </a>
        );
      })}
    </div>
  );
}
