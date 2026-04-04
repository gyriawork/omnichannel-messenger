import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useReactions(chatId: string, messageId: string) {
  const queryClient = useQueryClient();

  // Add/update reaction mutation
  const addReactionMutation = useMutation({
    mutationFn: async (emoji: string) => {
      const res = await api.post(
        `/api/chats/${chatId}/messages/${messageId}/reactions`,
        { emoji },
      );
      return res;
    },
    onSuccess: (_data) => {
      // Invalidate the messages query so reactions are refetched with messages
      queryClient.invalidateQueries({
        queryKey: ['messages', chatId],
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
      // Invalidate the messages query so reactions are refetched with messages
      queryClient.invalidateQueries({
        queryKey: ['messages', chatId],
      });
    },
    onError: (error) => {
      console.error('Failed to remove reaction:', error);
    },
  });

  return {
    addReaction: (emoji: string) => addReactionMutation.mutate(emoji),
    removeReaction: (emoji: string) => removeReactionMutation.mutate(emoji),
    isAddingReaction: addReactionMutation.isPending,
    isRemovingReaction: removeReactionMutation.isPending,
  };
}
