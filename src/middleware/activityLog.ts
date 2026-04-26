import { Response, NextFunction } from 'express'
import { AuthRequest } from './auth'
import { supabase } from '../lib/supabase'

export const logActivity = (action: string, resourceType?: string) =>
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    res.on('finish', async () => {
      if (!req.user || res.statusCode >= 400) return
      try {
        await supabase.from('activity_log').insert({
          user_id: req.user.id,
          action,
          resource_type: resourceType || null,
          resource_id: req.params?.id || null,
          metadata: { method: req.method, path: req.path, status: res.statusCode },
          ip_address: req.ip || req.socket.remoteAddress || null
        })
      } catch { /* non-blocking — never fail request for logging */ }
    })
    next()
  }
