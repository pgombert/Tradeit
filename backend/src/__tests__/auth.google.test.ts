import { describe, expect, it } from 'vitest';
import { GoogleAuthError, resolveGoogleEmail } from '../services/auth.google.js';

const ALLOWED = 'pete@goodwellpartners.com';

describe('resolveGoogleEmail', () => {
  it('accepts the allowlisted, verified address and normalises it', () => {
    expect(
      resolveGoogleEmail({ email: 'Pete@GoodwellPartners.com', email_verified: true }, ALLOWED),
    ).toBe('pete@goodwellpartners.com');
  });

  it('accepts email_verified sent as the string "true"', () => {
    expect(resolveGoogleEmail({ email: ALLOWED, email_verified: 'true' }, ALLOWED)).toBe(ALLOWED);
  });

  it('rejects a different Google account', () => {
    expect(() =>
      resolveGoogleEmail({ email: 'someone@else.com', email_verified: true }, ALLOWED),
    ).toThrow(GoogleAuthError);
  });

  it('rejects an unverified email even when it is the allowed address', () => {
    expect(() => resolveGoogleEmail({ email: ALLOWED, email_verified: false }, ALLOWED)).toThrow(
      GoogleAuthError,
    );
  });

  it('rejects a token that carries no email', () => {
    expect(() => resolveGoogleEmail({ email_verified: true }, ALLOWED)).toThrow(GoogleAuthError);
  });

  it('compares the allowlist case-insensitively too', () => {
    expect(resolveGoogleEmail({ email: ALLOWED, email_verified: true }, 'PETE@goodwellpartners.com')).toBe(
      ALLOWED,
    );
  });
});
