import { describe, it, expect } from 'vitest';
import { extractDomain } from './chat-grouping';

describe('extractDomain', () => {
  it('returns null for empty input', () => {
    expect(extractDomain('')).toBeNull();
    expect(extractDomain(null as unknown as string)).toBeNull();
    expect(extractDomain(undefined as unknown as string)).toBeNull();
  });

  it('returns null when there is no @', () => {
    expect(extractDomain('not-an-email')).toBeNull();
  });

  it('extracts a plain second-level domain', () => {
    expect(extractDomain('user@google.com')).toBe('google.com');
    expect(extractDomain('foo@allegro.pl')).toBe('allegro.pl');
  });

  it('collapses subdomains to the registrable domain', () => {
    expect(extractDomain('noreply@accounts.google.com')).toBe('google.com');
    expect(extractDomain('news@mail.notion.so')).toBe('notion.so');
    expect(extractDomain('a@b.c.d.example.com')).toBe('example.com');
  });

  it('handles multi-part TLDs (eTLD+1)', () => {
    expect(extractDomain('user@bbc.co.uk')).toBe('bbc.co.uk');
    expect(extractDomain('user@foo.bar.co.uk')).toBe('bar.co.uk');
    expect(extractDomain('user@example.com.au')).toBe('example.com.au');
    expect(extractDomain('user@a.b.example.com.au')).toBe('example.com.au');
  });

  it('lowercases the result', () => {
    expect(extractDomain('User@Google.COM')).toBe('google.com');
  });

  it('strips display name like "Google" <noreply@google.com>', () => {
    expect(extractDomain('"Google" <noreply@google.com>')).toBe('google.com');
    expect(extractDomain('Google <noreply@google.com>')).toBe('google.com');
  });

  it('handles display names containing > (anchors to final angle pair)', () => {
    expect(extractDomain('Re: A > B <user@example.com>')).toBe('example.com');
  });
});
