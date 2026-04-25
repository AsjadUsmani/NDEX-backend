import { Router, type Request, type Response } from 'express'
import { codeService, type AnalysisResult } from '../services/codeService'
import { githubService } from '../services/githubService'

const router = Router()

const CACHE_TTL_MS = 30 * 60 * 1000
const analysisCache = new Map<string, { value: AnalysisResult; expiresAt: number }>()

function cacheKey(owner: string, repo: string, filePath: string): string {
  return `${owner}/${repo}/${filePath}`
}

function pruneExpired(): void {
  const now = Date.now()
  for (const [key, entry] of analysisCache.entries()) {
    if (entry.expiresAt <= now) {
      analysisCache.delete(key)
    }
  }
}

function getCached(owner: string, repo: string, filePath: string): AnalysisResult | null {
  pruneExpired()
  const key = cacheKey(owner, repo, filePath)
  const entry = analysisCache.get(key)
  if (!entry) {
    return null
  }
  if (entry.expiresAt <= Date.now()) {
    analysisCache.delete(key)
    return null
  }
  return entry.value
}

function setCached(owner: string, repo: string, filePath: string, result: AnalysisResult): void {
  const key = cacheKey(owner, repo, filePath)
  analysisCache.set(key, { value: result, expiresAt: Date.now() + CACHE_TTL_MS })
}

function getParam(payload: Request['query'] | Request['body'], name: string): string {
  const value = payload[name]
  return typeof value === 'string' ? value.trim() : ''
}

function initSSE(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.flushHeaders()
}

function sendSSE(res: Response, payload: Record<string, unknown>): void {
  // Pad with extra newlines and a comment to force TCP buffer flush in some environments
  res.write(`data: ${JSON.stringify(payload)}\n\n:\n\n`)
  if (typeof (res as any).flush === 'function') {
    (res as any).flush()
  }
}

async function streamAnalysis(owner: string, repo: string, filePath: string, branch: string, res: Response): Promise<void> {
  initSSE(res)

  sendSSE(res, {
    step: 'init',
    progress: 2,
    label: 'Initializing analysis...',
  })

  const cached = getCached(owner, repo, filePath)
  if (cached) {
    sendSSE(res, {
      step: 'complete',
      progress: 100,
      label: 'Analysis complete! (cached)',
      result: cached,
      cached: true,
    })
    res.end()
    return
  }

  try {
    const result = await codeService.analyzeFile(owner, repo, filePath, branch, progressEvent => {
      if (progressEvent.step === 'complete') {
        return
      }
      sendSSE(res, {
        step: progressEvent.step,
        progress: progressEvent.progress,
        label: progressEvent.label,
      })
    })

    setCached(owner, repo, filePath, result)

    sendSSE(res, {
      step: 'complete',
      progress: 100,
      label: 'Analysis complete!',
      result,
      cached: false,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Analysis failed'
    sendSSE(res, {
      step: 'error',
      progress: 100,
      label: message,
      error: message,
    })
  }

  res.end()
}

// POST /api/code/analyze
router.post('/analyze', async (req: Request, res: Response) => {
  const owner = getParam(req.body, 'owner')
  const repo = getParam(req.body, 'repo')
  const filePath = getParam(req.body, 'filePath')
  const branch = getParam(req.body, 'branch') || 'main'

  if (!owner || !repo || !filePath) {
    res.status(400).json({ error: 'owner, repo, and filePath are required' })
    return
  }

  await streamAnalysis(owner, repo, filePath, branch, res)
})

// GET /api/code/analyze (EventSource-compatible stream)
router.get('/analyze', async (req: Request, res: Response) => {
  const owner = getParam(req.query, 'owner')
  const repo = getParam(req.query, 'repo')
  const filePath = getParam(req.query, 'filePath')
  const branch = getParam(req.query, 'branch') || 'main'

  if (!owner || !repo || !filePath) {
    res.status(400).json({ error: 'owner, repo, and filePath are required' })
    return
  }

  await streamAnalysis(owner, repo, filePath, branch, res)
})

// GET /api/code/file
router.get('/file', async (req: Request, res: Response) => {
  const owner = getParam(req.query, 'owner')
  const repo = getParam(req.query, 'repo')
  const filePath = getParam(req.query, 'path')
  const branch = getParam(req.query, 'branch') || 'main'

  if (!owner || !repo || !filePath) {
    res.status(400).json({ error: 'owner, repo, and path are required' })
    return
  }

  try {
    const content = await githubService.getFileContent(owner, repo, filePath, branch)
    if (!content) {
      res.status(404).json({ error: 'File not found' })
      return
    }

    res.json({ path: filePath, content })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch file content'
    res.status(500).json({ error: message })
  }
})

// GET /api/code/cache/:owner/:repo/:encodedPath
router.get('/cache/:owner/:repo/:encodedPath', (req: Request, res: Response) => {
  const owner = req.params.owner
  const repo = req.params.repo
  const encodedPath = req.params.encodedPath

  if (!owner || !repo || !encodedPath) {
    res.status(400).json({ error: 'owner, repo, and encodedPath are required' })
    return
  }

  const decodedPath = decodeURIComponent(encodedPath)
  const cached = getCached(owner, repo, decodedPath)

  if (!cached) {
    res.status(404).json({ error: 'No cached analysis found' })
    return
  }

  res.json(cached)
})

// POST /api/code/analyze-input  ← standalone code-paste analysis (no repo needed)
router.post('/analyze-input', async (req: Request, res: Response) => {
  const { code, language = 'Auto Detect' } = req.body as { code?: string; language?: string }

  if (!code || code.trim().length < 10) {
    res.status(400).json({ error: 'Code too short to analyze (min 10 characters)' })
    return
  }

  if (code.length > 50000) {
    res.status(400).json({ error: 'Code too long (max 50,000 characters)' })
    return
  }

  try {
    const result = await codeService.analyzeInputCode(code, language)
    res.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Analysis failed'
    res.status(500).json({ error: message })
  }
})

export default router

