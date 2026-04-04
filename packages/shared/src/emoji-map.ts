/**
 * Telegram allows only a specific set of emoji for message reactions.
 * Source: https://core.telegram.org/bots/api#reactiontype
 */
export const TELEGRAM_ALLOWED_EMOJI: string[] = [
  '👍', '👎', '❤️', '🔥', '🥰', '👏', '😁', '🤔', '🤯', '😱',
  '🤬', '😢', '🎉', '🤩', '🤮', '💩', '🙏', '👌', '🕊', '🤡',
  '🥱', '🥴', '😍', '🐳', '❤️‍🔥', '🌚', '🌭', '💯', '🤣', '⚡',
  '🍌', '🏆', '💔', '🤨', '😐', '🍓', '🍾', '💋', '🖕', '😈',
  '😴', '😭', '🤓', '👻', '👨‍💻', '👀', '🎃', '🙈', '😇', '😨',
  '🤝', '✍️', '🤗', '🫡', '🎅', '🎄', '☃️', '💅', '🤪', '🗿',
  '🆒', '💘', '🙉', '🦄', '😘', '💊', '🙊', '😎', '👾', '🤷',
  '🤷‍♂️', '🤷‍♀️', '😡',
];

/**
 * Get reaction support level for a messenger.
 * - 'full': All standard Unicode emoji supported (Slack)
 * - 'limited': Only a subset of emoji supported (Telegram)
 * - 'none': Reactions not supported (Gmail, WhatsApp in V1)
 */
export function getReactionSupport(messenger: string): 'full' | 'limited' | 'none' {
  switch (messenger) {
    case 'telegram':
      return 'limited';
    case 'slack':
      return 'full';
    default:
      return 'none';
  }
}
