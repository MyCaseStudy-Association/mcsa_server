import { User } from '../users/user.entity';

export interface TokenPayload {
  sub: string;
  email: string;
  type: 'access' | 'refresh';
  jti?: string;
}

export interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  refreshExpiresIn: number;
}
