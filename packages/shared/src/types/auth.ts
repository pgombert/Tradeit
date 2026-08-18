export interface AuthUser {
  id: string;
  email: string;
}

export interface GoogleLoginRequest {
  /** The ID token minted by Google Identity Services in the browser. */
  idToken: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface LoginResponse extends AuthTokens {
  user: AuthUser;
}

export interface JwtPayload {
  sub: string;
  email: string;
}
