import axios, { AxiosError } from 'axios'
import { getGroqKey } from '../routes/settings'

const GROQ_BASE = 'https://api.groq.com/openai/v1'
const DEFAULT_MODEL = 'llama-3.3-70b-versatile'
const REQUEST_TIMEOUT_MS = 60000

function stripMarkdownFences(text: string): string {
  return text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim()
}

export class AIService {
  private warnedMissingKey = false

  private getApiKey(): string {
    const key = getGroqKey() || process.env.GROQ_API_KEY || ''
    if (!key && !this.warnedMissingKey) {
      this.warnedMissingKey = true
      console.warn('GROQ_API_KEY not set — AI features disabled')
    }
    return key
  }

  private getModel(): string {
    return process.env.GROQ_MODEL || DEFAULT_MODEL
  }

  isConfigured(): boolean {
    return Boolean(this.getApiKey())
  }

  async generate(prompt: string, systemPrompt?: string): Promise<string> {
    const apiKey = this.getApiKey()

    if (!apiKey) {
      throw new Error('GROQ_API_KEY is missing')
    }

    const messages: Array<{ role: 'system' | 'user'; content: string }> = []

    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt })
    }
    messages.push({ role: 'user', content: prompt })

    try {
      const response = await axios.post<{
        choices?: Array<{
          message?: {
            content?: string
          }
        }>
      }>(
        `${GROQ_BASE}/chat/completions`,
        {
          model: this.getModel(),
          messages,
          temperature: 0.3,
          max_tokens: 2048,
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: REQUEST_TIMEOUT_MS,
        },
      )

      const text = response.data.choices?.[0]?.message?.content
      if (!text) {
        throw new Error('Groq returned an empty response')
      }

      return text
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError<{ error?: { message?: string } }>
        const status = axiosError.response?.status
        const message = axiosError.response?.data?.error?.message || axiosError.message

        if (status === 429) {
          throw new Error('Groq rate limit exceeded. Please try again shortly.')
        }

        if (status === 401 || status === 403) {
          throw new Error('Invalid Groq API key or access denied.')
        }

        throw new Error(message)
      }

      if (error instanceof Error) {
        throw error
      }

      throw new Error('Unknown Groq API error')
    }
  }

  async generateJSON<T>(prompt: string, systemPrompt?: string): Promise<T> {
    const jsonSystemPrompt = `${systemPrompt || ''}\nRespond ONLY with valid JSON. No markdown, no backticks, no explanation.`.trim()

    try {
      const raw = await this.generate(prompt, jsonSystemPrompt)
      return JSON.parse(stripMarkdownFences(raw)) as T
    } catch {
      const retryPrompt = `${prompt}\n\nCRITICAL: Your response must be ONLY a JSON object/array. Nothing else.`
      const retryRaw = await this.generate(retryPrompt, jsonSystemPrompt)
      return JSON.parse(stripMarkdownFences(retryRaw)) as T
    }
  }

  chunkText(text: string, maxChars = 6000): string[] {
    if (text.length <= maxChars) {
      return [text]
    }

    const chunks: string[] = []
    let start = 0
    while (start < text.length) {
      chunks.push(text.slice(start, start + maxChars))
      start += maxChars
    }
    return chunks
  }

  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4)
  }
}

export const aiService = new AIService()
