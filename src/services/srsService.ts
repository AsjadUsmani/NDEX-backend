import { aiService } from './aiService'
import { githubService } from './githubService'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GeneratedSRS {
  id: string
  repoUrl: string
  repoName: string
  generatedAt: string
  version: string
  metadata: {
    provider: 'groq'
    generationMode: 'ai' | 'fallback'
    warning?: string
  }
  document: {
    introduction: {
      purpose: string
      scope: string
      definitions: { term: string; definition: string }[]
      overview: string
    }
    overallDescription: {
      productPerspective: string
      productFunctions: string[]
      userClasses: { name: string; description: string; privileges: string }[]
      operatingEnvironment: string
      assumptions: string[]
      constraints: string[]
    }
    functionalRequirements: {
      id: string
      title: string
      description: string
      priority: 'HIGH' | 'MEDIUM' | 'LOW'
      inputs: string[]
      outputs: string[]
      dependencies: string[]
    }[]
    nonFunctionalRequirements: {
      id: string
      category: 'Performance' | 'Security' | 'Scalability' | 'Reliability' | 'Usability' | 'Maintainability'
      description: string
      metric: string
      rationale: string
    }[]
    systemArchitecture: {
      description: string
      components: { name: string; responsibility: string; technology: string }[]
      dataFlow: string
      integrations: { name: string; purpose: string; type: string }[]
    }
    dataModels: {
      name: string
      description: string
      fields: { name: string; type: string; required: boolean; description: string }[]
      relationships: string[]
    }[]
    apiEndpoints: {
      method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
      path: string
      description: string
      requestBody?: string
      responseSchema?: string
      authRequired: boolean
    }[]
    testingRequirements: {
      unitTesting: string
      integrationTesting: string
      e2eTesting: string
      performanceTesting: string
    }
    glossary: { term: string; definition: string }[]
  }
}

// ─── Retry helper ─────────────────────────────────────────────────────────────

async function withRetry<T>(fn: () => Promise<T>, retries = 3, delayMs = 2000): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      const isRateLimit =
        (err as { response?: { status?: number } })?.response?.status === 429 ||
        /rate.?limit/i.test(msg)
      if (isRateLimit && i < retries - 1) {
        const wait = delayMs * Math.pow(2, i)
        console.log(`[SRS] Rate limited. Retrying in ${wait}ms...`)
        await new Promise(r => setTimeout(r, wait))
        continue
      }
      throw err
    }
  }
  throw new Error('Max retries exceeded')
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class SRSService {

  async generateSRS(
    owner: string,
    repo: string,
    onProgress?: (step: string, progress: number, label: string) => void,
  ): Promise<GeneratedSRS> {
    const emit = (step: string, progress: number, label: string) => onProgress?.(step, progress, label)

    emit('context', 10, 'Gathering repo context...')
    const context = await this.gatherRepoContext(owner, repo)

    if (!aiService.isConfigured()) {
      return this.generateMockSRS(owner, repo, 'GROQ_API_KEY is not configured.')
    }

    try {
      // ── Call 1: Core sections (intro + FRs + NFRs) ──
      emit('intro', 25, 'Writing introduction & requirements...')
      const coreRaw = await withRetry(() =>
        aiService.generateJSON<Record<string, unknown>>(
          this.buildCorePrompt(context, owner, repo),
          this.coreSystemPrompt(),
        )
      )

      emit('functional', 50, 'Processing requirements...')
      await sleep(2000) // Respect Groq TPM between calls

      // ── Call 2: Technical sections (arch + endpoints + testing) ──
      emit('architecture', 65, 'Mapping architecture & endpoints...')
      const techRaw = await withRetry(() =>
        aiService.generateJSON<Record<string, unknown>>(
          this.buildTechPrompt(context, owner, repo),
          this.techSystemPrompt(),
        )
      )

      emit('testing', 90, 'Finalizing document...')

      const doc = this.assembleSRS(coreRaw, techRaw, owner, repo)
      emit('complete', 100, 'SRS generated successfully!')
      return doc

    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Groq unavailable'
      return this.generateMockSRS(owner, repo, `Fallback SRS generated because Groq was unavailable: ${msg}`)
    }
  }

  // ── Prompt builders ──────────────────────────────────────────────────────

  private buildCorePrompt(context: string, owner: string, repo: string): string {
    return `Analyze this GitHub repository and generate core SRS sections.
Repository: ${owner}/${repo}

CONTEXT:
${context.slice(0, 4000)}

Generate a JSON object with EXACTLY this structure (no other keys):
{
  "introduction": {
    "purpose": "string - why this software exists",
    "scope": "string - what it covers",
    "definitions": [{"term": "string", "definition": "string"}],
    "overview": "string - brief system overview"
  },
  "overallDescription": {
    "productPerspective": "string",
    "productFunctions": ["string"],
    "userClasses": [{"name":"string","description":"string","privileges":"string"}],
    "operatingEnvironment": "string",
    "assumptions": ["string"],
    "constraints": ["string"]
  },
  "functionalRequirements": [
    {
      "id": "FR-001",
      "title": "string",
      "description": "string",
      "priority": "HIGH",
      "inputs": ["string"],
      "outputs": ["string"],
      "dependencies": []
    }
  ],
  "nonFunctionalRequirements": [
    {
      "id": "NFR-001",
      "category": "Performance",
      "description": "string",
      "metric": "string",
      "rationale": "string"
    }
  ]
}

Generate 8-12 functional requirements and 6-8 NFRs.
Base everything on the ACTUAL repository — be specific, not generic.`
  }

  private buildTechPrompt(context: string, owner: string, repo: string): string {
    return `Analyze this GitHub repository technical details.
Repository: ${owner}/${repo}

CONTEXT:
${context.slice(0, 4000)}

Generate a JSON object with EXACTLY this structure (no other keys):
{
  "systemArchitecture": {
    "description": "string",
    "components": [{"name":"string","responsibility":"string","technology":"string"}],
    "dataFlow": "string",
    "integrations": [{"name":"string","purpose":"string","type":"string"}]
  },
  "dataModels": [
    {
      "name": "string",
      "description": "string",
      "fields": [{"name":"string","type":"string","required":true,"description":"string"}],
      "relationships": ["string"]
    }
  ],
  "apiEndpoints": [
    {
      "method": "GET",
      "path": "string",
      "description": "string",
      "authRequired": false
    }
  ],
  "testingRequirements": {
    "unitTesting": "string",
    "integrationTesting": "string",
    "e2eTesting": "string",
    "performanceTesting": "string"
  },
  "glossary": [{"term":"string","definition":"string"}]
}`
  }

  private coreSystemPrompt(): string {
    return `You are a senior software architect writing IEEE 830 SRS documentation.
Respond ONLY with valid JSON matching the exact structure requested.
No markdown, no backticks, no explanation text outside the JSON.
Be specific to the actual repository provided — never use generic placeholder text.`
  }

  private techSystemPrompt(): string {
    return `You are a senior software architect documenting system architecture.
Respond ONLY with valid JSON matching the exact structure requested.
No markdown, no backticks, no explanation.`
  }

  // ── Assembly ─────────────────────────────────────────────────────────────

  private assembleSRS(core: Record<string, unknown>, tech: Record<string, unknown>, owner: string, repo: string): GeneratedSRS {
    const safeArr = <T>(v: unknown): T[] => Array.isArray(v) ? v as T[] : []
    const safeStr = (v: unknown, fallback = ''): string => typeof v === 'string' ? v : fallback
    const safeObj = <T>(v: unknown, fallback: T): T => (v && typeof v === 'object' && !Array.isArray(v)) ? v as T : fallback

    const intro = safeObj<Record<string, unknown>>(core.introduction, {})
    const overall = safeObj<Record<string, unknown>>(core.overallDescription, {})
    const arch = safeObj<Record<string, unknown>>(tech.systemArchitecture, {})
    const testing = safeObj<Record<string, unknown>>(tech.testingRequirements, {})

    return {
      id: `${owner}-${repo}-${Date.now()}`,
      repoUrl: `https://github.com/${owner}/${repo}`,
      repoName: `${owner}/${repo}`,
      generatedAt: new Date().toISOString(),
      version: '1.0.0',
      metadata: { provider: 'groq', generationMode: 'ai' },
      document: {
        introduction: {
          purpose: safeStr(intro.purpose, 'Purpose not generated.'),
          scope: safeStr(intro.scope, 'Scope not generated.'),
          definitions: safeArr(intro.definitions),
          overview: safeStr(intro.overview, ''),
        },
        overallDescription: {
          productPerspective: safeStr(overall.productPerspective, ''),
          productFunctions: safeArr<string>(overall.productFunctions),
          userClasses: safeArr(overall.userClasses),
          operatingEnvironment: safeStr(overall.operatingEnvironment, ''),
          assumptions: safeArr<string>(overall.assumptions),
          constraints: safeArr<string>(overall.constraints),
        },
        functionalRequirements: safeArr(core.functionalRequirements),
        nonFunctionalRequirements: safeArr(core.nonFunctionalRequirements),
        systemArchitecture: {
          description: safeStr(arch.description, ''),
          components: safeArr(arch.components),
          dataFlow: safeStr(arch.dataFlow, ''),
          integrations: safeArr(arch.integrations),
        },
        dataModels: safeArr(tech.dataModels),
        apiEndpoints: safeArr(tech.apiEndpoints),
        testingRequirements: {
          unitTesting: safeStr(testing.unitTesting, ''),
          integrationTesting: safeStr(testing.integrationTesting, ''),
          e2eTesting: safeStr(testing.e2eTesting, ''),
          performanceTesting: safeStr(testing.performanceTesting, ''),
        },
        glossary: safeArr(tech.glossary),
      },
    }
  }

  // ── Context gathering ─────────────────────────────────────────────────────

  private async gatherRepoContext(owner: string, repo: string): Promise<string> {
    try {
      const [metadata, languages] = await Promise.all([
        githubService.getRepo(owner, repo),
        githubService.getLanguages(owner, repo),
      ])

      const langTotal = Object.values(languages).reduce((a, b) => a + b, 0)
      const langStr = Object.entries(languages)
        .map(([k, v]) => `${k} (${langTotal ? ((v / langTotal) * 100).toFixed(1) : 0}%)`)
        .join(', ')

      const defaultBranch = metadata.defaultBranch || 'main'

      // Grab readme + tree in parallel; skip commit details to save GitHub rate limit
      const [readme, tree] = await Promise.all([
        githubService.getReadmeContent(owner, repo).catch(() => null),
        githubService.getFileTree(owner, repo, defaultBranch).catch(() => []),
      ])

      // Flatten tree paths
      const flatPaths: string[] = []
      const walk = (nodes: typeof tree) => {
        for (const n of nodes) {
          flatPaths.push(n.path)
          if (n.children) walk(n.children)
        }
      }
      walk(tree)

      return [
        `REPOSITORY: ${owner}/${repo}`,
        `DESCRIPTION: ${metadata.description || 'No description'}`,
        `LANGUAGE: ${metadata.language || 'Unknown'}`,
        `ALL LANGUAGES: ${langStr}`,
        `STARS: ${metadata.stars} | FORKS: ${metadata.forks}`,
        `TOPICS: ${metadata.topics.join(', ') || 'none'}`,
        '',
        'FILE STRUCTURE (first 40 paths):',
        ...flatPaths.slice(0, 40),
        '',
        'README:',
        (readme || 'README not found.').slice(0, 800),
      ].join('\n')
    } catch {
      return `REPOSITORY: ${owner}/${repo} — context fetch partially failed`
    }
  }

  // ── Fallback (no key / all retries exhausted) ─────────────────────────────

  private generateMockSRS(owner: string, repo: string, warning?: string): GeneratedSRS {
    return {
      id: `${owner}-${repo}-${Date.now()}`,
      repoUrl: `https://github.com/${owner}/${repo}`,
      repoName: `${owner}/${repo}`,
      generatedAt: new Date().toISOString(),
      version: '0.1.0-mock',
      metadata: { provider: 'groq', generationMode: 'fallback', warning },
      document: {
        introduction: {
          purpose: `This mock SRS outlines requirements for ${owner}/${repo}. Set a valid GROQ_API_KEY to generate AI-driven content.`,
          scope: 'The system covers repository analysis workflows, visual dashboards, and generated documentation outputs.',
          definitions: [
            { term: 'SRS', definition: 'Software Requirements Specification document.' },
            { term: 'NDEX', definition: 'Neural Design Explorer platform.' },
          ],
          overview: 'This document is a fallback template generated when Groq API credentials are unavailable.',
        },
        overallDescription: {
          productPerspective: 'Web-based analysis workspace integrating GitHub data and AI-assisted documentation.',
          productFunctions: ['Connect repository metadata and activity', 'Render interactive visual analytics', 'Generate and export SRS documents'],
          userClasses: [
            { name: 'Developer', description: 'Engineers analyzing repo behavior.', privileges: 'Read and generate docs.' },
            { name: 'Tech Lead', description: 'Architecture reviewers and approvers.', privileges: 'Review and export SRS.' },
          ],
          operatingEnvironment: 'Modern browsers, Node.js backend, optional Groq API access.',
          assumptions: ['GitHub repository remains accessible during analysis.'],
          constraints: ['Rate limits from third-party APIs.'],
        },
        functionalRequirements: [
          { id: 'FR-001', title: 'Generate SRS Document', description: 'System shall generate structured SRS output for connected repositories.', priority: 'HIGH', inputs: ['owner/repo'], outputs: ['GeneratedSRS JSON document'], dependencies: [] },
          { id: 'FR-002', title: 'Export Markdown', description: 'System shall export generated SRS as markdown file.', priority: 'MEDIUM', inputs: ['SRS document'], outputs: ['Markdown file'], dependencies: ['FR-001'] },
        ],
        nonFunctionalRequirements: [
          { id: 'NFR-001', category: 'Performance', description: 'SRS generation progress updates shall be visible in near real-time.', metric: 'Progress event every major generation stage.', rationale: 'Improves user trust for long-running generation tasks.' },
          { id: 'NFR-002', category: 'Reliability', description: 'Fallback mock document shall render when AI API is unavailable.', metric: '100% successful fallback rendering without API key.', rationale: 'Prevents hard failure in development and test environments.' },
        ],
        systemArchitecture: {
          description: 'Frontend React client communicates with Express backend and external GitHub/Groq APIs.',
          components: [
            { name: 'Frontend UI', responsibility: 'Display progress and SRS document rendering.', technology: 'React + TypeScript' },
            { name: 'Backend API', responsibility: 'Aggregate context and orchestrate generation.', technology: 'Express + TypeScript' },
          ],
          dataFlow: 'User triggers generation → backend gathers context → AI sections composed → frontend receives final document.',
          integrations: [
            { name: 'GitHub API', purpose: 'Repository metadata and code context', type: 'REST API' },
            { name: 'Groq API', purpose: 'SRS content generation', type: 'REST API' },
          ],
        },
        dataModels: [
          {
            name: 'GeneratedSRS',
            description: 'Canonical generated requirements artifact.',
            fields: [
              { name: 'id', type: 'string', required: true, description: 'Document identifier.' },
              { name: 'repoName', type: 'string', required: true, description: 'Repository full name.' },
            ],
            relationships: ['Contains functional and non-functional requirement collections.'],
          },
        ],
        apiEndpoints: [
          { method: 'GET', path: '/api/srs/generate?owner={owner}&repo={repo}', description: 'Stream SRS generation progress and final document.', authRequired: false },
          { method: 'POST', path: '/api/srs/:id/export/markdown', description: 'Export generated SRS as markdown file.', authRequired: false },
        ],
        testingRequirements: {
          unitTesting: 'Validate JSON normalization for each generated section.',
          integrationTesting: 'Ensure GitHub + Groq workflow and SSE event sequence.',
          e2eTesting: 'Verify user can generate and export SRS from UI.',
          performanceTesting: 'Measure generation and render behavior on medium and large repositories.',
        },
        glossary: [
          { term: 'IEEE 830', definition: 'Standard for software requirements specifications.' },
          { term: 'SSE', definition: 'Server-Sent Events streaming protocol.' },
        ],
      },
    }
  }
}

export const srsService = new SRSService()
