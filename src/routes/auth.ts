import { Router, Request, Response, NextFunction } from 'express'
import { authService } from '../services/authService'
import { requireAuth, AuthRequest } from '../middleware/auth'
import {
  registerValidation, loginValidation, handleValidation
} from '../middleware/validate'
import { authLimiter } from '../middleware/rateLimit'
import { logActivity } from '../middleware/activityLog'
import { supabase } from '../lib/supabase'

const router = Router()

const COOKIE_OPTIONS = {
  httpOnly: true, secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const, maxAge: 7 * 24 * 60 * 60 * 1000
}

// GET /api/auth/check-username
router.get('/check-username', async (req: Request, res: Response): Promise<void> => {
  try {
    const { username } = req.query
    if (!username || typeof username !== 'string') {
      res.status(400).json({ error: 'Username query parameter required' })
      return
    }
    const { data } = await supabase
      .from('profiles')
      .select('id')
      .eq('username', username)
      .single()
    res.json({ available: !data })
  } catch (error) {
    // If no row is found, Supabase might throw an error or return null.
    // In our case, we consider it available if an error occurs (like PGRST116: JSON object requested, multiple (or no) rows returned).
    res.json({ available: true })
  }
})

// POST /api/auth/register
router.post('/register',
  authLimiter,
  registerValidation,
  handleValidation,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { email, password, username, display_name } = req.body
      const result = await authService.register(email, password, username, display_name)
      res.cookie('ndex_refresh', result.tokens.refresh, COOKIE_OPTIONS)
      res.status(201).json({
        user: result.user,
        accessToken: result.tokens.access,
        message: 'Account created successfully'
      })
    } catch (err) { next(err) }
  }
)

// POST /api/auth/login
router.post('/login',
  authLimiter,
  loginValidation,
  handleValidation,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { email, password } = req.body
      const result = await authService.login(email, password)
      res.cookie('ndex_refresh', result.tokens.refresh, COOKIE_OPTIONS)
      res.json({
        user: result.user,
        accessToken: result.tokens.access
      })
    } catch (err) { next(err) }
  }
)

// POST /api/auth/oauth
router.post('/oauth',
  authLimiter,
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { accessToken } = req.body
      if (!accessToken) {
        res.status(400).json({ error: 'Access token required' })
        return
      }
      const result = await authService.oauthLogin(accessToken)
      res.cookie('ndex_refresh', result.tokens.refresh, COOKIE_OPTIONS)
      res.json({
        user: result.user,
        accessToken: result.tokens.access
      })
    } catch (err) { next(err) }
  }
)

// POST /api/auth/refresh
router.post('/refresh', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const refreshToken = req.cookies?.ndex_refresh || req.body?.refreshToken
    if (!refreshToken) {
      res.status(401).json({ error: 'Refresh token required' }); return
    }
    const tokens = await authService.refreshToken(refreshToken)
    res.cookie('ndex_refresh', tokens.refresh, COOKIE_OPTIONS)
    res.json({ accessToken: tokens.access })
  } catch (err) { next(err) }
})

// POST /api/auth/logout
router.post('/logout', requireAuth,
  logActivity('user.logout'),
  async (req: AuthRequest, res: Response, next): Promise<void> => {
    try {
      await authService.logout(req.user!.id)
      res.clearCookie('ndex_refresh')
      res.json({ message: 'Logged out successfully' })
    } catch (err) { next(err) }
  }
)

// GET /api/auth/me
router.get('/me', requireAuth,
  async (req: AuthRequest, res: Response, next): Promise<void> => {
    try {
      const profile = await authService.getProfile(req.user!.id)
      res.json({ user: profile })
    } catch (err) { next(err) }
  }
)

export default router
