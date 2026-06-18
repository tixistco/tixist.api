export interface JwtPayload {
  sub: string;
}

export interface RefreshPayload {
  sub: string;
  jti: string;
}

export interface AuthUser {
  id: string;
  email: string | null;
  name: string | null;
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}
