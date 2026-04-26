import { aiService } from './aiService'
import { githubService } from './githubService'

export interface ComplexityMetrics {
  cyclomaticComplexity: number
  cognitiveComplexity: number
  linesOfCode: number
  linesOfComments: number
  commentRatio: number
  functionCount: number
  classCount: number
  importCount: number
  nestingDepth: number
  maintainabilityIndex: number
}

export interface CodeIssue {
  type: 'security' | 'performance' | 'style' | 'bug' | 'maintainability'
  severity: 'critical' | 'high' | 'medium' | 'low'
  line?: number
  title: string
  description: string
  suggestion: string
}

export interface RefactorSuggestion {
  title: string
  description: string
  before: string
  after: string
  impact: 'high' | 'medium' | 'low'
  effort: 'high' | 'medium' | 'low'
}

export interface DetectedPattern {
  name: string
  type: 'design' | 'anti' | 'architectural'
  description: string
  confidence: number
  location: string
}

export interface AnalysisResult {
  filePath: string
  language: string
  originalCode: string
  annotatedCode: string
  metrics: ComplexityMetrics
  issues: CodeIssue[]
  patterns: DetectedPattern[]
  suggestions: RefactorSuggestion[]
  dependencies: {
    name: string
    version?: string
    type: 'internal' | 'external' | 'builtin'
    usedIn: string[]
  }[]
  summary: string
  qualityScore: number
  analysisTime: number
}

interface AnalyzeProgress {
  step: 'fetch' | 'metrics' | 'annotate' | 'issues' | 'patterns' | 'suggestions' | 'complete'
  progress: number
  label: string
}

const JS_BUILTINS = new Set([
  'fs',
  'path',
  'http',
  'https',
  'url',
  'util',
  'crypto',
  'stream',
  'events',
  'os',
  'child_process',
  'net',
  'tls',
  'zlib',
  'buffer',
  'assert',
  'querystring',
  'timers',
])

const PY_BUILTINS = new Set([
  'os',
  'sys',
  'json',
  're',
  'math',
  'time',
  'datetime',
  'typing',
  'pathlib',
  'itertools',
  'functools',
  'collections',
  'subprocess',
  'threading',
])

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

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
        console.log(`[Code] Rate limited. Retrying in ${wait}ms...`)
        await new Promise(r => setTimeout(r, wait))
        continue
      }
      throw err
    }
  }
  throw new Error('Max retries exceeded')
}

export class CodeService {
  async analyzeFile(
    owner: string,
    repo: string,
    filePath: string,
    branch: string,
    onProgress?: (progress: AnalyzeProgress) => void,
  ): Promise<AnalysisResult> {
    const started = Date.now()

    onProgress?.({ step: 'fetch', progress: 10, label: 'Fetching file content...' })
    const code = await githubService.getFileContent(owner, repo, filePath, branch)
    if (!code) {
      throw new Error(`Unable to load file: ${filePath}`)
    }

    const language = this.detectLanguage(filePath)

    onProgress?.({ step: 'metrics', progress: 25, label: 'Calculating metrics...' })
    const metrics = this.calculateMetrics(code, language)
    const dependencies = this.parseDependencies(code, language)

    onProgress?.({ step: 'annotate', progress: 45, label: 'Generating annotations...' })
    const annotatedCode = await this.generateAnnotations(code, language, filePath)

    onProgress?.({ step: 'issues', progress: 65, label: 'Detecting issues...' })
    const issues = await this.detectIssues(code, language)

    onProgress?.({ step: 'patterns', progress: 80, label: 'Identifying patterns...' })
    const patterns = await this.detectPatterns(code, language)

    onProgress?.({ step: 'suggestions', progress: 90, label: 'Generating suggestions...' })
    const suggestions = await this.generateSuggestions(code, language, metrics)

    const baseQuality = this.calculateQualityScore(metrics, issues)
    const patternBonus = clamp(patterns.filter(pattern => pattern.type === 'design').length * 2, 0, 10)
    const qualityScore = clamp(baseQuality + patternBonus, 0, 100)

    const summary = [
      `${language} source file ${filePath} was analyzed for structure, quality, and risks.`,
      `The file has maintainability index ${metrics.maintainabilityIndex}/100 with cyclomatic complexity ${metrics.cyclomaticComplexity} and ${issues.length} identified issue(s).`,
      `Detected ${patterns.length} pattern(s) and generated ${suggestions.length} focused refactor suggestion(s).`,
    ].join(' ')

    const result: AnalysisResult = {
      filePath,
      language,
      originalCode: code,
      annotatedCode,
      metrics,
      issues,
      patterns,
      suggestions,
      dependencies,
      summary,
      qualityScore,
      analysisTime: Date.now() - started,
    }

    onProgress?.({ step: 'complete', progress: 100, label: 'Analysis complete!' })

    return result
  }

  private detectLanguage(filePath: string): string {
    const extension = filePath.toLowerCase().split('.').pop() || ''
    const map: Record<string, string> = {
      ts: 'typescript',
      tsx: 'typescript',
      js: 'javascript',
      jsx: 'javascript',
      py: 'python',
      go: 'go',
      rs: 'rust',
      java: 'java',
      cs: 'csharp',
      cpp: 'cpp',
      c: 'c',
      css: 'css',
      scss: 'scss',
      html: 'html',
      json: 'json',
      yml: 'yaml',
      yaml: 'yaml',
      md: 'markdown',
      sh: 'bash',
    }

    return map[extension] ?? 'text'
  }

  private calculateMetrics(code: string, language: string): ComplexityMetrics {
    const lines = code.split(/\r?\n/)
    const trimmed = lines.map(line => line.trim())

    const commentStart = language === 'python' ? /^#/ : /^(\/\/|\/\*|\*)/
    const nonCommentNonEmptyLines = trimmed.filter(line => line.length > 0 && !commentStart.test(line))
    const commentLines = trimmed.filter(line => commentStart.test(line))

    const functionCount =
      (code.match(/function\s|=>\s*\{|\bdef\s/g) ?? []).length +
      (code.match(/\basync\s+[a-zA-Z_$][\w$]*\s*\(/g) ?? []).length
    const classCount = (code.match(/\bclass\s/g) ?? []).length
    const importCount = (code.match(/^(import\s|const\s+.+?=\s*require\(|from\s+.+?import\s)/gm) ?? []).length

    let depth = 0
    let maxDepth = 0
    for (const char of code) {
      if (char === '{') {
        depth += 1
        if (depth > maxDepth) {
          maxDepth = depth
        }
      } else if (char === '}') {
        depth = Math.max(0, depth - 1)
      }
    }

    const branchCount = (code.match(/\bif\b|\belse\b|\bfor\b|\bwhile\b|\bcase\b|\bcatch\b|&&|\|\|/g) ?? []).length
    const cyclomaticComplexity = clamp(1 + branchCount, 1, 50)

    // Approximate cognitive load by weighting branch decisions with current nesting depth.
    const nestingWeights = trimmed.reduce(
      (acc, line) => {
        if (/\bif\b|\bfor\b|\bwhile\b|\bcase\b|\bcatch\b/.test(line)) {
          return acc + Math.max(1, line.split('{').length - 1)
        }
        return acc
      },
      0,
    )
    const cognitiveComplexity = clamp(branchCount + nestingWeights + Math.floor(maxDepth * 1.5), 1, 50)

    const linesOfCode = nonCommentNonEmptyLines.length
    const linesOfComments = commentLines.length
    const commentRatio = linesOfCode > 0 ? Number(((linesOfComments / linesOfCode) * 100).toFixed(1)) : 0

    const maintainabilityIndex = clamp(100 - cyclomaticComplexity * 2 - maxDepth * 5, 0, 100)

    return {
      cyclomaticComplexity,
      cognitiveComplexity,
      linesOfCode,
      linesOfComments,
      commentRatio,
      functionCount,
      classCount,
      importCount,
      nestingDepth: maxDepth,
      maintainabilityIndex,
    }
  }

  private async generateAnnotations(
    code: string,
    language: string,
    filePath: string,
  ): Promise<string> {
    const systemPrompt = [
      'You are an expert code reviewer and technical writer.',
      'Add comprehensive JSDoc/docstring comments to the provided code.',
      'Rules:',
      '- Add @param, @returns, @throws, @example for every function',
      '- Add class-level JSDoc describing purpose and usage',
      '- Add inline comments for complex logic (not obvious code)',
      '- Add @deprecated warnings for any outdated patterns',
      '- Keep ALL original code intact - only ADD comments, never change code',
      '- Return ONLY the annotated code, no explanation, no markdown fences',
      '- Match the comment style to the language (// for JS/TS, # for Python, etc.)',
    ].join('\n')

    const prompt = [
      `Language: ${language}`,
      `File path: ${filePath}`,
      'Code to annotate:',
      code,
    ].join('\n\n')

    try {
      const annotated = await aiService.generate(prompt, systemPrompt)
      return annotated.trim() || code
    } catch {
      return code
    }
  }

  private async detectIssues(
    code: string,
    language: string,
  ): Promise<CodeIssue[]> {
    const systemPrompt = [
      'You are a senior code security and quality auditor.',
      `Analyze this ${language} code and find issues.`,
      'Respond ONLY with a JSON array of issues. Each issue:',
      '{',
      '  "type": "security|performance|style|bug|maintainability",',
      '  "severity": "critical|high|medium|low",',
      '  "line": <line number or null>,',
      '  "title": "<short title>",',
      '  "description": "<what is wrong>",',
      '  "suggestion": "<how to fix it>"',
      '}',
      'Focus on: SQL injection, XSS, hardcoded secrets, memory leaks, N+1 queries, missing error handling, unused variables, overly complex functions, missing input validation.',
      'Find 3-8 real issues. Be specific to THIS code.',
    ].join('\n')

    try {
      const issues = await aiService.generateJSON<CodeIssue[]>(code, systemPrompt)
      return (issues ?? [])
        .filter(issue => issue && issue.title && issue.description)
        .slice(0, 8)
        .map(issue => ({
          ...issue,
          line: issue.line && issue.line > 0 ? issue.line : undefined,
        }))
    } catch {
      return []
    }
  }

  private async detectPatterns(
    code: string,
    language: string,
  ): Promise<DetectedPattern[]> {
    const systemPrompt = [
      'You are a software architect expert in design patterns.',
      `Analyze this ${language} code and identify design patterns.`,
      'Respond ONLY with a JSON array. Each item:',
      '{',
      '  "name": "<pattern name>",',
      '  "type": "design|anti|architectural",',
      '  "description": "<how it\'s used here>",',
      '  "confidence": <0-100>,',
      '  "location": "<class or function name>"',
      '}',
      'Design patterns: Singleton, Factory, Observer, Strategy, etc.',
      'Anti-patterns: God Object, Spaghetti Code, Magic Numbers, etc.',
      'Find 2-5 patterns. Only include if confidence > 60.',
    ].join('\n')

    try {
      const patterns = await aiService.generateJSON<DetectedPattern[]>(code, systemPrompt)
      return (patterns ?? [])
        .filter(pattern => pattern.confidence > 60)
        .slice(0, 5)
        .map(pattern => ({
          ...pattern,
          confidence: clamp(pattern.confidence, 0, 100),
        }))
    } catch {
      return []
    }
  }

  private async generateSuggestions(
    code: string,
    language: string,
    metrics: ComplexityMetrics,
  ): Promise<RefactorSuggestion[]> {
    const systemPrompt = [
      'You are a senior engineer doing code review.',
      `Suggest refactoring improvements for this ${language} code.`,
      `The code has these metrics: cyclomatic complexity ${metrics.cyclomaticComplexity}, maintainability index ${metrics.maintainabilityIndex}.`,
      'Respond ONLY with a JSON array of max 4 suggestions. Each:',
      '{',
      '  "title": "<what to refactor>",',
      '  "description": "<why and how>",',
      '  "before": "<short code snippet showing the problem (max 5 lines)>",',
      '  "after": "<short code snippet showing the fix (max 5 lines)>",',
      '  "impact": "high|medium|low",',
      '  "effort": "high|medium|low"',
      '}',
      'Focus on the highest impact improvements.',
    ].join('\n')

    try {
      const suggestions = await aiService.generateJSON<RefactorSuggestion[]>(code, systemPrompt)
      return (suggestions ?? []).slice(0, 4)
    } catch {
      return []
    }
  }

  private parseDependencies(code: string, language: string): AnalysisResult['dependencies'] {
    const dependencies = new Map<string, AnalysisResult['dependencies'][number]>()

    const addDep = (name: string, usedIn: string) => {
      if (!name) {
        return
      }

      const normalizedName = name.trim()
      const type = this.detectDependencyType(normalizedName, language)
      const existing = dependencies.get(normalizedName)
      if (existing) {
        if (!existing.usedIn.includes(usedIn)) {
          existing.usedIn.push(usedIn)
        }
        return
      }

      dependencies.set(normalizedName, {
        name: normalizedName,
        type,
        usedIn: [usedIn],
      })
    }

    const lines = code.split(/\r?\n/)

    const importFromRegex = /import\s+.+?\s+from\s+['"]([^'"]+)['"]/g
    const importOnlyRegex = /import\s+['"]([^'"]+)['"]/g
    const requireRegex = /require\(\s*['"]([^'"]+)['"]\s*\)/g
    const pyImportRegex = /^(?:from\s+([\w.]+)\s+import\s+.+|import\s+([\w.]+))/

    lines.forEach((line, index) => {
      const lineNo = `L${index + 1}`

      for (const match of line.matchAll(importFromRegex)) {
        addDep(match[1], lineNo)
      }
      for (const match of line.matchAll(importOnlyRegex)) {
        addDep(match[1], lineNo)
      }
      for (const match of line.matchAll(requireRegex)) {
        addDep(match[1], lineNo)
      }

      const pyMatch = line.trim().match(pyImportRegex)
      if (pyMatch) {
        addDep(pyMatch[1] || pyMatch[2], lineNo)
      }
    })

    return Array.from(dependencies.values()).sort((a, b) => a.name.localeCompare(b.name))
  }

  private detectDependencyType(name: string, language: string): 'internal' | 'external' | 'builtin' {
    if (name.startsWith('.') || name.startsWith('/')) {
      return 'internal'
    }

    const rootName = name.split('/')[0]

    if (language === 'python') {
      if (PY_BUILTINS.has(rootName)) {
        return 'builtin'
      }
      return 'external'
    }

    if (JS_BUILTINS.has(rootName) || rootName.startsWith('node:')) {
      return 'builtin'
    }

    return 'external'
  }

  private calculateQualityScore(
    metrics: ComplexityMetrics,
    issues: CodeIssue[],
  ): number {
    let score = 100

    for (const issue of issues) {
      switch (issue.severity) {
        case 'critical':
          score -= 15
          break
        case 'high':
          score -= 8
          break
        case 'medium':
          score -= 4
          break
        case 'low':
          score -= 1
          break
      }
    }

    if (metrics.cyclomaticComplexity > 10) {
      score -= (metrics.cyclomaticComplexity - 10) * 5
    }

    if (metrics.commentRatio < 10) {
      score -= 10
    }

    if (metrics.nestingDepth > 4) {
      score -= (metrics.nestingDepth - 4) * 5
    }

    return clamp(score, 0, 100)
  }

  // ─── Standalone code-paste analysis with diagram generation ──────────────

  async analyzeInputCode(code: string, language: string): Promise<{
    language: string
    summary: string
    diagrams: { type: string; title: string; description: string; mermaidCode: string }[]
    metrics: { complexity: number; maintainability: number; linesOfCode: number; functionCount: number }
    issues: { severity: string; message: string }[]
    suggestions: string[]
  }> {
    const detectedLang = language === 'Auto Detect'
      ? this.detectLanguage('file.' + this.guessExtension(code))
      : language.toLowerCase()

    const rawMetrics = this.calculateMetrics(code, detectedLang)

    const prompt = `Analyze this ${detectedLang} code and return a JSON object.

CODE:
\`\`\`
${code.slice(0, 5500)}
\`\`\`

Return ONLY this JSON structure (no markdown, no backticks):
{
  "language": "detected language name",
  "summary": "2-3 sentence summary of what this code does",
  "issues": [
    {"severity": "critical|high|medium|low", "message": "description"}
  ],
  "suggestions": ["improvement suggestion 1", "suggestion 2"],
  "diagrams": [
    {
      "type": "uml-class",
      "title": "Class Diagram",
      "description": "Classes and relationships",
      "mermaidCode": "classDiagram\\n  class MyClass {\\n    +String myProp\\n    +myMethod()\\n  }"
    },
    {
      "type": "uml-sequence",
      "title": "Sequence Diagram",
      "description": "Main execution flow",
      "mermaidCode": "sequenceDiagram\\n  participant A\\n  participant B\\n  A->>B: Call\\n  B-->>A: Return"
    },
    {
      "type": "dependency",
      "title": "Dependency Map",
      "description": "Module and import map",
      "mermaidCode": "graph LR\\n  A[\\"Module A\\"] --> B[\\"Module B\\"]"
    },
    {
      "type": "flowchart",
      "title": "Logic Flowchart",
      "description": "Decision and branch logic",
      "mermaidCode": "flowchart TD\\n  A{\\"Start\\"} --> B[\\"Process\\"]"
    },
    {
      "type": "component",
      "title": "Component Diagram",
      "description": "Architecture overview",
      "mermaidCode": "graph TB\\n  subgraph \\"Sub\\"\\n    A[\\"Comp A\\"]\\n  end"
    }
  ]
}

CRITICAL RULES for mermaidCode:
- Use \\n for newlines inside JSON strings.
- Escape ALL quotes inside Mermaid strings (e.g. \\"Label\\").
- ALWAYS quote node labels and class names if they contain special characters or spaces.
- For graph/flowchart, ALWAYS use the syntax: NodeID[\\"Label Text\\"].
- For classDiagram, avoid using generic types like List<String> unless fully escaped or simplified.
- Keep diagrams very focused (max 12-15 nodes).
- Do NOT use 'subgraph' unless it's for the 'component' diagram.
- Ensure ALL 5 diagram types are present in the response.
- If a diagram type isn't relevant, generate a simplified "High Level Overview" for that type.`

    const systemPrompt = `You are a world-class software architect and Mermaid.js expert.
Your goal is to generate valid, syntactically correct Mermaid code for 5 different diagram types.
You must return valid JSON that can be parsed by JSON.parse().
No markdown fences. No preamble. No postamble.`

    const result = await withRetry(() =>
      aiService.generateJSON<Record<string, unknown>>(prompt, systemPrompt)
    )

    return {
      language: typeof result.language === 'string' ? result.language : detectedLang,
      summary: typeof result.summary === 'string' ? result.summary : 'Code analyzed successfully.',
      diagrams: Array.isArray(result.diagrams) ? result.diagrams as { type: string; title: string; description: string; mermaidCode: string }[] : [],
      metrics: {
        complexity: rawMetrics.cyclomaticComplexity,
        maintainability: rawMetrics.maintainabilityIndex,
        linesOfCode: rawMetrics.linesOfCode,
        functionCount: rawMetrics.functionCount,
      },
      issues: Array.isArray(result.issues) ? result.issues as { severity: string; message: string }[] : [],
      suggestions: Array.isArray(result.suggestions) ? result.suggestions as string[] : [],
    }
  }

  private guessExtension(code: string): string {
    if (/def /.test(code) && /:/.test(code)) return 'py'
    if (/interface |: string|: number/.test(code)) return 'ts'
    if (/public class |void [a-z]/.test(code)) return 'java'
    if (/fn [a-z]/.test(code) && /let mut/.test(code)) return 'rs'
    if (/func [A-Z]/.test(code) && /package /.test(code)) return 'go'
    if (/SELECT|FROM|WHERE/i.test(code)) return 'sql'
    return 'js'
  }
}

export const codeService = new CodeService()
