import React from 'react';
import { ReactionsPicker } from './ReactionsPicker';

interface ReactionGroup {
  emoji: string;
  count: number;
  userReacted: boolean;
}

interface ReactionsBubbleProps {
  reactions: ReactionGroup[];
  onAddReaction: (emoji: string) => void;
  onRemoveReaction: (emoji: string) => void;
  isLoading?: boolean;
  showPicker?: boolean;
}

export const ReactionsBubble: React.FC<ReactionsBubbleProps> = ({
  reactions,
  onAddReaction,
  onRemoveReaction,
  isLoading = false,
  showPicker = true,
}) => {
  if (reactions.length === 0 && !showPicker) {
    return null;
  }

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {reactions.map((reaction) => (
        <button
          key={reaction.emoji}
          onClick={() => {
            if (reaction.userReacted) {
              onRemoveReaction(reaction.emoji);
            } else {
              onAddReaction(reaction.emoji);
            }
          }}
          disabled={isLoading}
          className={`
            inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium transition-all
            ${
              reaction.userReacted
                ? 'bg-accent/10 text-accent ring-1 ring-accent/30'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }
            disabled:opacity-50 disabled:cursor-not-allowed
          `}
          title={reaction.userReacted ? 'Remove reaction' : 'Add reaction'}
        >
          <span>{reaction.emoji}</span>
          <span>{reaction.count}</span>
        </button>
      ))}

      {showPicker && (
        <ReactionsPicker onEmojiSelect={onAddReaction} isLoading={isLoading} />
      )}
    </div>
  );
};
