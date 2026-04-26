import helmet from 'helmet'
import { RequestHandler } from 'express'

export const securityHeaders: RequestHandler[] = [
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc:  ["'self'"],
        styleSrc:   ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc:    ["'self'", 'https://fonts.gstatic.com'],
        imgSrc:     ["'self'", 'data:', 'https://avatars.githubusercontent.com'],
        connectSrc: ["'self'", 'https://api.github.com', 'https://*.supabase.co'],
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
  (req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('X-Frame-Options', 'DENY')
    res.setHeader('X-XSS-Protection', '1; mode=block')
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    next()
  }
]
