'use client';

interface TypingUser {
  userId: string;
  userName: string;
  timestamp: number;
}

interface TypingIndicatorProps {
  typingUsers: TypingUser[];
}

export default function TypingIndicator({ typingUsers }: TypingIndicatorProps) {
  if (typingUsers.length === 0) return null;

  const names = typingUsers.map((u) => u.userName);
  const text =
    names.length === 1
      ? `${names[0]} is typing`
      : names.length === 2
        ? `${names[0]} and ${names[1]} are typing`
        : `${names[0]} and ${names.length - 1} others are typing`;

  return (
    <div className="px-4 py-1 text-xs text-gray-400 animate-pulse">
      {text}
      <span className="inline-block w-1 h-1 bg-gray-400 rounded-full mx-0.5 animate-bounce" style={{ animationDelay: '0ms' }} />
      <span className="inline-block w-1 h-1 bg-gray-400 rounded-full mx-0.5 animate-bounce" style={{ animationDelay: '200ms' }} />
      <span className="inline-block w-1 h-1 bg-gray-400 rounded-full mx-0.5 animate-bounce" style={{ animationDelay: '400ms' }} />
    </div>
  );
}
