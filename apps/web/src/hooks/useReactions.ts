import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface ReactionGroup {
  emoji: string;
  count: number;
  userReacted: boolean;
}

export function useReactions(chatId: string, messageId: string) {
  const queryClient = useQueryClient();

  // Fetch reactions for a specific message
  const { data: reactions = [], isLoading } = useQuery({
    queryKey: ['reactions', messageId],
    queryFn: async () => {
      try {
        const data = await api.get<{ reactions: ReactionGroup[] }>(
          `/api/chats/${chatId}/messages/${messageId}/reactions`,
        );
        return data.reactions;
      } catch (error) {
        console.error('Failed to fetch reactions:', error);
        return [];
      }
    },
  });

  // Add/update reaction mutation
  const addReactionMutation = useMutation({
    mutationFn: async (emoji: string) => {
      return api.post(
        `/api/chats/${chatId}/messages/${messageId}/reactions`,
        { emoji },
      );
    },
    onSuccess: () => {
      // Refetch reactions
      queryClient.invalidateQueries({
        queryKey: ['reactions', messageId],
      });
    },
    onError: (error) => {
      console.error('Failed to add reaction:', error);
    },
  });

  // Remove reaction mutation
  const removeReactionMutation = useMutation({
    mutationFn: async (emoji: string) => {
      await api.delete(
        `/api/chats/${chatId}/messages/${messageId}/reactions/${emoji}`,
      );
    },
    onSuccess: () => {
      // Refetch reactions
      queryClient.invalidateQueries({
        queryKey: ['reactions', messageId],
      });
    },
    onError: (error) => {
      console.error('Failed to remove reaction:', error);
    },
  });

  return {
    reactions,
    isLoading,
    addReaction: (emoji: string) => addReactionMutation.mutate(emoji),
    removeReaction: (emoji: string) => removeReactionMutation.mutate(emoji),
    isAddingReaction: addReactionMutation.isPending,
    isRemovingReaction: removeReactionMutation.isPending,
  };
}
