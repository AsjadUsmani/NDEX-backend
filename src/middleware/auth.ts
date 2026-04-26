import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { supabase } from '../lib/supabase'

export interface AuthRequest extends Request {
  user?: {
    id: string
    email: string
    username: string
    plan: 'free' | 'pro' | 'team'
  }
}

export interface JWTPayload {
  sub: string
  email: string
  username: string
  plan: 'free' | 'pro' | 'team'
  iat: number
  exp: number
}

export const requireAuth = async (
  req: AuthRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization
    const cookieToken = req.cookies?.ndex_token || req.cookies?.auth_token

    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : cookieToken

    if (!token) {
      res.status(401).json({ error: 'Authentication required' })
      return
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET!) as JWTPayload

    const { data: profile, error } = await supabase
      .from('profiles')
      .select('id, username, plan')
      .eq('id', payload.sub)
      .single()

    if (error || !profile) {
      res.status(401).json({ error: 'User not found or token invalid' })
      return
    }

    req.user = {
      id: profile.id,
      email: payload.email,
      username: profile.username,
      plan: profile.plan
    }

    next()
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' })
      return
    }
    if (err instanceof jwt.JsonWebTokenError) {
      res.status(401).json({ error: 'Invalid token' })
      return
    }
    res.status(500).json({ error: 'Authentication error' })
  }
}

export const optionalAuth = async (
  req: AuthRequest, res: Response, next: NextFunction
): Promise<void> => {
  try {
    const token = req.headers.authorization?.slice(7) || req.cookies?.ndex_token
    if (!token) { next(); return }
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as JWTPayload
    req.user = { id: payload.sub, email: payload.email,
                 username: payload.username, plan: payload.plan }
  } catch { /* ignore — optional */ }
  next()
}

export const requirePlan = (minPlan: 'free' | 'pro' | 'team') => (
  req: AuthRequest, res: Response, next: NextFunction
): void => {
  const order = { free: 0, pro: 1, team: 2 }
  if (!req.user || order[req.user.plan] < order[minPlan]) {
    res.status(403).json({
      error: `This feature requires a ${minPlan} plan or higher`
    })
    return
  }
  next()
}
