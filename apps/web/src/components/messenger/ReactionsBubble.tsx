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
    <div className="flex flex-wrap gap-1.5 mt-1.5 items-center">
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
            px-2 py-1 rounded-full text-sm font-medium transition-all
            ${
              reaction.userReacted
                ? 'bg-blue-100 dark:bg-blue-900 text-blue-900 dark:text-blue-100 ring-1 ring-blue-300 dark:ring-blue-700'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600'
            }
            disabled:opacity-50 disabled:cursor-not-allowed
          `}
          title={reaction.userReacted ? 'Remove reaction' : 'Add reaction'}
        >
          <span className="mr-1">{reaction.emoji}</span>
          <span>{reaction.count}</span>
        </button>
      ))}

      {showPicker && (
        <ReactionsPicker onEmojiSelect={onAddReaction} isLoading={isLoading} />
      )}
    </div>
  );
};
