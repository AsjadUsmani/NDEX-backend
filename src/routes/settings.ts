import { Router } from 'express'
const router = Router()

// In-memory token store (session-scoped)
let githubToken = process.env.GITHUB_TOKEN || ''
let groqKey     = process.env.GROQ_API_KEY || ''

// POST /api/settings/token
// Body: { githubToken?: string, groqKey?: string }
// Updates in-memory tokens for this server session
// These override the .env values at runtime
router.post('/token', (req, res) => {
  const { githubToken: gh, groqKey: gk } = req.body
  if (gh) githubToken = gh.trim()
  if (gk) groqKey     = gk.trim()
  res.json({ success: true })
})

// GET /api/settings/status
// Returns which keys are configured (never returns actual key values)
router.get('/status', (_req, res) => {
  res.json({
    githubToken: !!githubToken,
    groqKey:     !!groqKey,
    githubTokenPreview: githubToken
      ? `${githubToken.slice(0, 8)}...`
      : null,
  })
})

// Export token getter for other services to use
export const getGithubToken  = () => githubToken
export const getGroqKey      = () => groqKey

export default router
