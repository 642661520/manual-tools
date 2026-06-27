import jwt from 'jsonwebtoken'
import { config } from '../config.js'

const JWT_SECRET = config.jwtSecret
const JWT_EXPIRES = '7d'

export interface JwtPayload {
  userId: string
  username: string
  displayName: string
  role: 'admin' | 'member' | 'guest'
  tokenVersion: number
  avatarUrl?: string
  feishuName?: string
  exp?: number
  iat?: number
}

export function signToken(
  payload: Omit<JwtPayload, 'tokenVersion'> & { tokenVersion?: number },
): string {
  return jwt.sign({ ...payload, tokenVersion: payload.tokenVersion ?? 0 }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES,
  })
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload
}
