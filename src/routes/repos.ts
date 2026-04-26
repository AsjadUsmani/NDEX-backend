import { Router, Response } from 'express'
import { requireAuth, AuthRequest } from '../middleware/auth'
import { supabase } from '../lib/supabase'

const router = Router()

// GET /api/repos — list saved repos for user
router.get('/', requireAuth, async (req: AuthRequest, res: Response) => {
  const { data, error } = await supabase
    .from('repositories')
    .select('*')
    .eq('user_id', req.user!.id)
    .order('created_at', { ascending: false })

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// POST /api/repos — upsert a repo record
router.post('/', requireAuth, async (req: AuthRequest, res: Response) => {
  const {
    github_url, owner, repo_name, description, stars, forks, language, is_private,
    file_tree, commits, branches, contributors, languages_data
  } = req.body

  const { data, error } = await supabase
    .from('repositories')
    .upsert({
      user_id: req.user!.id,
      github_url,
      owner,
      repo_name,
      description,
      stars,
      forks,
      language,
      is_private,
      file_tree: file_tree || [],
      commits: commits || [],
      branches: branches || [],
      contributors: contributors || [],
      languages_data: languages_data || {},
      last_analyzed: new Date().toISOString()
    }, { onConflict: 'user_id, github_url' })
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

export default router
