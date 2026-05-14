import React from 'react';
import { cn } from '../lib/utils';

const SIZE_MAP: Record<8 | 10 | 12, string> = {
  8: 'w-8 h-8 text-xs',
  10: 'w-10 h-10 text-sm',
  12: 'w-12 h-12 text-base',
};

/** Google OAuth often stores the portrait URL in profiles; we show initials instead unless the user uploaded elsewhere. */
function isGoogleHostedProfileUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host.includes('googleusercontent.com')
      || host === 'lh3.googleusercontent.com'
      || host.endsWith('ggpht.com')
    );
  } catch {
    return /googleusercontent\.com|ggpht\.com/i.test(url);
  }
}

export type AvatarProps = {
  displayName?: string | null;
  email?: string | null;
  profilePicture?: string | null;
  size?: 8 | 10 | 12;
  className?: string;
};

function initialLetter(displayName?: string | null, email?: string | null) {
  const base = displayName?.trim() || email?.trim() || '?';
  const s = base[0] ?? '?';
  return s.toUpperCase();
}

export function Avatar({
  displayName,
  email,
  profilePicture,
  size = 10,
  className,
}: AvatarProps) {
  const raw = profilePicture?.trim();
  const pic = raw && !isGoogleHostedProfileUrl(raw) ? raw : null;

  if (pic) {
    return (
      <img
        src={pic}
        alt=""
        className={cn('rounded-full border border-border-tonal object-cover shrink-0', SIZE_MAP[size], className)}
      />
    );
  }

  const letter = initialLetter(displayName, email);
  return (
    <div
      className={cn(
        'rounded-full bg-brand-orange text-white font-black uppercase flex items-center justify-center shrink-0 border border-border-tonal',
        SIZE_MAP[size],
        className
      )}
      aria-hidden
    >
      {letter}
    </div>
  );
}
