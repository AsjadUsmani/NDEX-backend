import { Router, Response } from 'express'
import { requireAuth, AuthRequest } from '../middleware/auth'
import { supabase } from '../lib/supabase'

const router = Router()

// GET /api/preferences — fetch user_preferences row
router.get('/', requireAuth, async (req: AuthRequest, res: Response) => {
  const { data, error } = await supabase
    .from('user_preferences')
    .select('*')
    .eq('user_id', req.user!.id)
    .single()

  if (error && error.code !== 'PGRST116') { // PGRST116 is not found
    return res.status(500).json({ error: error.message })
  }
  
  res.json(data || { theme: 'dark', sidebar_collapsed: false })
})

// PUT /api/preferences — update user_preferences
router.put('/', requireAuth, async (req: AuthRequest, res: Response) => {
  const { theme, sidebar_collapsed, default_branch, github_token_hint, notifications } = req.body

  const { data, error } = await supabase
    .from('user_preferences')
    .upsert({
      user_id: req.user!.id,
      theme,
      sidebar_collapsed,
      default_branch,
      github_token_hint,
      notifications,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' })
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

export default router
