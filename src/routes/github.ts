import { Router, type Request, type Response } from 'express'
import { githubService, GitHubApiError } from '../services/githubService'

const router = Router()

function parseNumber(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function sendGitHubError(res: Response, error: unknown): Response {
  if (error instanceof GitHubApiError) {
    if (error.status === 404) {
      return res.status(404).json({ error: 'Repository not found' })
    }

    if (error.status === 401) {
      return res.status(401).json({ error: 'Invalid GitHub token' })
    }

    if (error.status === 403) {
      return res.status(403).json({ error: 'GitHub API rate limit exceeded. Add GITHUB_TOKEN.' })
    }

    return res.status(error.status).json({ error: error.message })
  }

  return res.status(500).json({ error: 'Unexpected GitHub API error' })
}

function normalizePageLimit(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 100) : fallback
}

router.get('/repo/:owner/:repo', async (req: Request, res: Response) => {
  try {
    const { owner, repo } = req.params
    const data = await githubService.getRepo(owner, repo)
    res.json(data)
  } catch (error) {
    sendGitHubError(res, error)
  }
})

router.get('/commits/:owner/:repo', async (req: Request, res: Response) => {
  try {
    const { owner, repo } = req.params
    const page = parseNumber(req.query.page, 1)
    const perPage = parseNumber(req.query.per_page, 50)
    const branch = typeof req.query.branch === 'string' ? req.query.branch : 'main'
    const data = await githubService.getCommits(owner, repo, page, perPage, branch)
    res.json(data)
  } catch (error) {
    sendGitHubError(res, error)
  }
})

router.get('/languages/:owner/:repo', async (req: Request, res: Response) => {
  try {
    const { owner, repo } = req.params
    const raw = await githubService.getLanguages(owner, repo)
    const total = Object.values(raw).reduce((sum, value) => sum + value, 0)
    const languages = Object.fromEntries(
      Object.entries(raw).map(([language, bytes]) => [language, total > 0 ? Number(((bytes / total) * 100).toFixed(1)) : 0]),
    )
    res.json({ languages, raw })
  } catch (error) {
    sendGitHubError(res, error)
  }
})

router.get('/contributors/:owner/:repo', async (req: Request, res: Response) => {
  try {
    const { owner, repo } = req.params
    const data = await githubService.getContributors(owner, repo)
    res.json(data)
  } catch (error) {
    sendGitHubError(res, error)
  }
})

router.get('/branches/:owner/:repo', async (req: Request, res: Response) => {
  try {
    const { owner, repo } = req.params
    const data = await githubService.getBranches(owner, repo)
    res.json(data)
  } catch (error) {
    sendGitHubError(res, error)
  }
})

router.get('/tree/:owner/:repo', async (req: Request, res: Response) => {
  try {
    const { owner, repo } = req.params
    const branch = typeof req.query.branch === 'string' ? req.query.branch : 'main'
    const data = await githubService.getFileTree(owner, repo, branch)
    res.json(data)
  } catch (error) {
    sendGitHubError(res, error)
  }
})

router.get('/pulls/:owner/:repo', async (req: Request, res: Response) => {
  try {
    const { owner, repo } = req.params
    const state = req.query.state === 'open' || req.query.state === 'closed' ? req.query.state : 'all'
    const perPage = normalizePageLimit(req.query.per_page, 100)
    const prs = await githubService.getPullRequests(owner, repo, state, perPage)
    const stats = githubService.calculatePRStats(prs)
    res.json({ prs, stats })
  } catch (error) {
    sendGitHubError(res, error)
  }
})

router.get('/issues/:owner/:repo', async (req: Request, res: Response) => {
  try {
    const { owner, repo } = req.params
    const state = req.query.state === 'open' || req.query.state === 'closed' ? req.query.state : 'all'
    const perPage = normalizePageLimit(req.query.per_page, 100)
    const issues = await githubService.getIssues(owner, repo, state, perPage)
    const stats = githubService.calculateIssueStats(issues)
    res.json({ issues, stats })
  } catch (error) {
    sendGitHubError(res, error)
  }
})

export default router
