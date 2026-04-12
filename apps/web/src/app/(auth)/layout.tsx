export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[100dvh]">
      {/* Left panel — gradient with decorative shapes */}
      <div className="relative hidden w-1/2 overflow-hidden bg-gradient-to-br from-[#6366f1] via-[#a855f7] to-[#f97316] lg:flex lg:flex-col lg:items-start lg:justify-center lg:px-16">
        {/* Decorative elements */}
        <div className="pointer-events-none absolute inset-0">
          {/* Circle top-right */}
          <div className="absolute -right-20 -top-20 h-72 w-72 rounded-full bg-white/10" />
          <div className="absolute right-10 top-10 h-40 w-40 rounded-full bg-white/5" />
          {/* Diagonal lines */}
          <div className="absolute bottom-20 left-10 h-96 w-2 rotate-[-35deg] rounded-full bg-gradient-to-b from-yellow-400/60 to-orange-400/60" />
          <div className="absolute bottom-16 left-20 h-80 w-1.5 rotate-[-35deg] rounded-full bg-gradient-to-b from-pink-300/40 to-orange-300/40" />
          <div className="absolute bottom-24 left-32 h-72 w-1 rotate-[-35deg] rounded-full bg-gradient-to-b from-yellow-400/30 to-orange-400/30" />
          <div className="absolute bottom-10 left-44 h-64 w-1.5 rotate-[-35deg] rounded-full bg-gradient-to-b from-pink-300/30 to-yellow-300/30" />
          <div className="absolute bottom-28 left-56 h-56 w-1 rotate-[-35deg] rounded-full bg-gradient-to-b from-orange-300/40 to-yellow-300/40" />
          {/* Blob bottom-left */}
          <div className="absolute -bottom-10 -left-10 h-48 w-64 rotate-[-20deg] rounded-full bg-[#8b5cf6]/30 blur-sm" />
          {/* Blob bottom-center */}
          <div className="absolute -bottom-8 left-1/3 h-32 w-56 rotate-[-15deg] rounded-full bg-orange-400/50 blur-sm" />
        </div>

        {/* Text content */}
        <div className="relative z-10 -mt-16 max-w-lg">
          <h1 className="text-5xl font-bold leading-tight text-white">
            Welcome to<br />Messengly
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-white/80">
            Your unified inbox for Telegram, Slack, WhatsApp, and Gmail.
            Manage all conversations in one place.
          </p>
        </div>
      </div>

      {/* Right panel — login form */}
      <div className="flex w-full items-center justify-center bg-white px-4 lg:w-1/2">
        {children}
      </div>
    </div>
  );
}
