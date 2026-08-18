/**
 * Pure decision logic for Google sign-in — kept apart from the network call to
 * Google so it can be tested without a token or an environment. Given the claims
 * Google returns for a verified ID token, decide whether this person may sign in
 * and what email to trust.
 */

/** The subset of Google ID-token claims sign-in depends on. */
export interface GoogleIdentity {
  email?: string | null;
  email_verified?: boolean | string | null;
}

export class GoogleAuthError extends Error {}

/**
 * Returns the normalised email to sign in as, or throws. The token itself must
 * already have been cryptographically verified by the caller — this only judges
 * the claims. Rules:
 *   - Google must assert the address is verified.
 *   - The address must be the single allowlisted email, compared case-folded.
 */
export function resolveGoogleEmail(identity: GoogleIdentity, allowedEmail: string): string {
  const email = identity.email?.trim().toLowerCase();
  if (!email) throw new GoogleAuthError('Google token carried no email');

  // Google sends email_verified as a real boolean, but some paths stringify it.
  const verified = identity.email_verified === true || identity.email_verified === 'true';
  if (!verified) throw new GoogleAuthError('Google has not verified this email');

  if (email !== allowedEmail.trim().toLowerCase()) {
    throw new GoogleAuthError('This Google account is not allowed to sign in');
  }

  return email;
}
