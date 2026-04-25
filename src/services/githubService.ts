import axios, { AxiosError } from 'axios'
import { getGithubToken } from '../routes/settings'

const GITHUB_API = 'https://api.github.com'
const REQUEST_TIMEOUT_MS = 30000

function getHeaders() {
  const token = getGithubToken() || process.env.GITHUB_TOKEN
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(token ? { Authorization: `token ${token}` } : {}),
    'User-Agent': 'NDEX-App',
  }
}

export interface RepoMetadata {
  name: string
  owner: string
  description: string | null
  stars: number
  forks: number
  language: string | null
  url: string
  defaultBranch: string
  createdAt: string
  updatedAt: string
  openIssues: number
  size: number
  topics: string[]
  license: string | null
  isPrivate: boolean
}

export interface CommitData {
  sha: string
  shortSha: string
  message: string
  author: {
    name: string
    email: string
    date: string
  }
  filesChanged: number
  changedFiles?: string[]
  additions: number
  deletions: number
  url: string
}

export interface ContributorData {
  login: string
  avatarUrl: string
  contributions: number
  name: string | null
  url: string
}

export interface BranchData {
  name: string
  sha: string
  isDefault: boolean
  lastCommitDate: string
  lastCommitMessage: string
}

export interface FileNode {
  path: string
  name: string
  type: 'blob' | 'tree'
  size: number
  children?: FileNode[]
}

interface GitHubRepoResponse {
  name: string
  owner: { login: string }
  description: string | null
  stargazers_count: number
  forks_count: number
  language: string | null
  html_url: string
  default_branch: string
  created_at: string
  updated_at: string
  open_issues_count: number
  size: number
  license: { name: string } | null
  private: boolean
}

interface GitHubCommitItem {
  sha: string
  html_url: string
  commit: {
    message: string
    author: { name: string; email: string; date: string }
    committer: { name: string; email: string; date: string }
  }
}

interface GitHubCommitDetail extends GitHubCommitItem {
  stats?: {
    additions: number
    deletions: number
    total: number
  }
  files?: Array<unknown>
}

interface GitHubContributor {
  login: string
  avatar_url: string
  contributions: number
  html_url: string
}

interface GitHubUserProfile {
  name: string | null
}

interface GitHubBranch {
  name: string
  commit: { sha: string; url: string }
  protected: boolean
}

interface GitHubBranchCommitDetail {
  sha: string
  html_url: string
  commit: {
    message: string
    author: { name: string; email: string; date: string }
  }
}

interface GitHubTreeEntry {
  path: string
  type: 'blob' | 'tree'
  size?: number
}

interface GitHubContentResponse {
  content?: string
  encoding?: string
}

export interface PRData {
  id: number
  number: number
  title: string
  state: 'open' | 'closed'
  merged: boolean
  mergedAt: string | null
  createdAt: string
  closedAt: string | null
  author: string
  authorAvatar: string
  url: string
  additions: number
  deletions: number
  changedFiles: number
  labels: string[]
  reviewCount: number
  commentCount: number
}

export interface IssueData {
  id: number
  number: number
  title: string
  state: 'open' | 'closed'
  createdAt: string
  closedAt: string | null
  author: string
  labels: string[]
  commentCount: number
  isPR: boolean
  url: string
}

export interface PRStats {
  totalPRs: number
  openPRs: number
  closedPRs: number
  mergedPRs: number
  mergeRate: number
  avgMergeTimeHours: number
  avgAdditions: number
  avgDeletions: number
  topContributors: { login: string; prCount: number }[]
  weeklyActivity: {
    week: string
    opened: number
    closed: number
    merged: number
  }[]
}

export interface IssueStats {
  totalIssues: number
  openIssues: number
  closedIssues: number
  resolutionRate: number
  avgResolutionHours: number
  weeklyActivity: {
    week: string
    opened: number
    closed: number
  }[]
  topLabels: { name: string; count: number; color: string }[]
}

class GitHubApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = 'GitHubApiError'
  }
}

function toGitHubError(error: unknown): GitHubApiError {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<{ message?: string }>
    const status = axiosError.response?.status ?? 500
    const message = axiosError.response?.data?.message ?? axiosError.message
    return new GitHubApiError(status, message)
  }

  if (error instanceof Error) {
    return new GitHubApiError(500, error.message)
  }

  return new GitHubApiError(500, 'Unknown GitHub API error')
}

function buildRepoUrl(owner: string, repo: string): string {
  return `https://github.com/${owner}/${repo}`
}

function mapGithubError(error: unknown): never {
  throw toGitHubError(error)
}

function buildFileTree(entries: GitHubTreeEntry[]): FileNode[] {
  const nodesByPath = new Map<string, FileNode>()
  const roots: FileNode[] = []

  const ensureNode = (entry: GitHubTreeEntry): FileNode => {
    const existing = nodesByPath.get(entry.path)
    if (existing) {
      return existing
    }

    const node: FileNode = {
      path: entry.path,
      name: entry.path.split('/').pop() ?? entry.path,
      type: entry.type,
      size: entry.size ?? 0,
      children: entry.type === 'tree' ? [] : undefined,
    }
    nodesByPath.set(entry.path, node)
    return node
  }

  for (const entry of entries) {
    const node = ensureNode(entry)
    const parentPath = entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) : ''

    if (!parentPath) {
      roots.push(node)
      continue
    }

    const parentEntry: GitHubTreeEntry = { path: parentPath, type: 'tree', size: 0 }
    const parentNode = ensureNode(parentEntry)
    parentNode.children = parentNode.children ?? []
    if (!parentNode.children.some(child => child.path === node.path)) {
      parentNode.children.push(node)
    }
  }

  return roots.filter(node => node.type === 'tree' || node.type === 'blob')
}

function startOfWeekUTC(dateString: string): string {
  const date = new Date(dateString)
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const day = utc.getUTCDay()
  const diff = (day + 6) % 7
  utc.setUTCDate(utc.getUTCDate() - diff)
  utc.setUTCHours(0, 0, 0, 0)
  return utc.toISOString().slice(0, 10)
}

function getLastTwelveWeeks(): string[] {
  const weeks: string[] = []
  const now = new Date()
  for (let offset = 11; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    date.setUTCDate(date.getUTCDate() - offset * 7)
    weeks.push(startOfWeekUTC(date.toISOString()))
  }
  return weeks
}

function colorFromLabelName(name: string): string {
  let hash = 0
  for (let index = 0; index < name.length; index += 1) {
    hash = ((hash << 5) - hash) + name.charCodeAt(index)
    hash |= 0
  }

  const hue = Math.abs(hash) % 360
  return `hsl(${hue}, 60%, 55%)`
}

export class GitHubService {
  async getRepo(owner: string, repo: string): Promise<RepoMetadata> {
    try {
      const [repoResponse, topicsResponse] = await Promise.all([
        axios.get<GitHubRepoResponse>(`${GITHUB_API}/repos/${owner}/${repo}`, {
          headers: getHeaders(),
        }),
        axios.get<{ names?: string[] }>(`${GITHUB_API}/repos/${owner}/${repo}/topics`, {
          headers: {
            ...getHeaders(),
            Accept: 'application/vnd.github+json',
          },
        }),
      ])

      const data = repoResponse.data
      return {
        name: data.name,
        owner: data.owner.login,
        description: data.description,
        stars: data.stargazers_count,
        forks: data.forks_count,
        language: data.language,
        url: data.html_url,
        defaultBranch: data.default_branch,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        openIssues: data.open_issues_count,
        size: data.size,
        topics: topicsResponse.data.names ?? [],
        license: data.license?.name ?? null,
        isPrivate: data.private,
      }
    } catch (error) {
      mapGithubError(error)
    }
  }

  async getCommits(owner: string, repo: string, page: number, perPage: number, branch: string): Promise<CommitData[]> {
    try {
      const response = await axios.get<GitHubCommitItem[]>(`${GITHUB_API}/repos/${owner}/${repo}/commits`, {
        headers: getHeaders(),
        params: {
          page,
          per_page: perPage,
          sha: branch,
        },
      })

      const commits = response.data
      const detailedCommits = await Promise.all(
        commits.slice(0, 10).map(async commit => {
          const detailResponse = await axios.get<GitHubCommitDetail>(
            `${GITHUB_API}/repos/${owner}/${repo}/commits/${commit.sha}`,
            { headers: getHeaders() },
          )
          const detail = detailResponse.data
          const author = detail.commit.author ?? detail.commit.committer

          return {
            sha: detail.sha,
            shortSha: detail.sha.slice(0, 7),
            message: detail.commit.message,
            author: {
              name: author.name,
              email: author.email,
              date: author.date,
            },
            filesChanged: detail.files?.length ?? 0,
            changedFiles: (detail.files ?? []).map(file => (file as { filename?: string }).filename).filter((value): value is string => Boolean(value)),
            additions: detail.stats?.additions ?? 0,
            deletions: detail.stats?.deletions ?? 0,
            url: detail.html_url,
          }
        }),
      )

      return commits.map((commit, index) => {
        const detailed = detailedCommits[index]
        if (detailed) {
          return detailed
        }

        const author = commit.commit.author ?? commit.commit.committer
        return {
          sha: commit.sha,
          shortSha: commit.sha.slice(0, 7),
          message: commit.commit.message,
          author: {
            name: author.name,
            email: author.email,
            date: author.date,
          },
          filesChanged: 0,
          changedFiles: [],
          additions: 0,
          deletions: 0,
          url: commit.html_url,
        }
      })
    } catch (error) {
      mapGithubError(error)
    }
  }

  async getLanguages(owner: string, repo: string): Promise<Record<string, number>> {
    try {
      const response = await axios.get<Record<string, number>>(`${GITHUB_API}/repos/${owner}/${repo}/languages`, {
        headers: getHeaders(),
      })
      return response.data
    } catch (error) {
      mapGithubError(error)
    }
  }

  async getContributors(owner: string, repo: string): Promise<ContributorData[]> {
    try {
      const response = await axios.get<GitHubContributor[]>(`${GITHUB_API}/repos/${owner}/${repo}/contributors`, {
        headers: getHeaders(),
        params: { per_page: 20 },
      })

      const contributors = await Promise.all(
        response.data.slice(0, 20).map(async contributor => {
          let name: string | null = null
          try {
            const profileResponse = await axios.get<GitHubUserProfile>(`${GITHUB_API}/users/${contributor.login}`, {
              headers: getHeaders(),
            })
            name = profileResponse.data.name
          } catch {
            name = null
          }

          return {
            login: contributor.login,
            avatarUrl: contributor.avatar_url,
            contributions: contributor.contributions,
            name,
            url: contributor.html_url,
          }
        }),
      )

      return contributors
    } catch (error) {
      mapGithubError(error)
    }
  }

  async getBranches(owner: string, repo: string): Promise<BranchData[]> {
    try {
      const response = await axios.get<GitHubBranch[]>(`${GITHUB_API}/repos/${owner}/${repo}/branches`, {
        headers: getHeaders(),
        params: { per_page: 100 },
      })

      const branches = await Promise.all(
        response.data.map(async branch => {
          const commitResponse = await axios.get<GitHubBranchCommitDetail>(branch.commit.url, {
            headers: getHeaders(),
          })

          return {
            name: branch.name,
            sha: branch.commit.sha,
            isDefault: branch.name === 'main' || branch.name === 'master',
            lastCommitDate: commitResponse.data.commit.author.date,
            lastCommitMessage: commitResponse.data.commit.message,
          }
        }),
      )

      return branches
    } catch (error) {
      mapGithubError(error)
    }
  }

  async getFileTree(owner: string, repo: string, branch: string): Promise<FileNode[]> {
    try {
      const response = await axios.get<{ tree: GitHubTreeEntry[] }>(
        `${GITHUB_API}/repos/${owner}/${repo}/git/trees/${branch}`,
        {
          headers: getHeaders(),
          params: { recursive: 1 },
        },
      )

      return buildFileTree(response.data.tree)
    } catch (error) {
      mapGithubError(error)
    }
  }

  async getFileContent(owner: string, repo: string, path: string, branch?: string): Promise<string | null> {
    try {
      const response = await axios.get<GitHubContentResponse>(
        `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`,
        {
          headers: getHeaders(),
          params: branch ? { ref: branch } : undefined,
          timeout: REQUEST_TIMEOUT_MS,
        },
      )

      const content = response.data.content
      if (!content) {
        return null
      }

      const encoding = response.data.encoding ?? 'base64'
      if (encoding === 'base64') {
        return Buffer.from(content, 'base64').toString('utf-8')
      }

      return content
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return null
      }
      mapGithubError(error)
    }
  }

  async getReadmeContent(owner: string, repo: string): Promise<string | null> {
    try {
      const response = await axios.get<GitHubContentResponse>(
        `${GITHUB_API}/repos/${owner}/${repo}/readme`,
        { headers: getHeaders(), timeout: REQUEST_TIMEOUT_MS },
      )

      const content = response.data.content
      if (!content) {
        return null
      }

      const encoding = response.data.encoding ?? 'base64'
      if (encoding === 'base64') {
        return Buffer.from(content, 'base64').toString('utf-8')
      }

      return content
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        return null
      }
      mapGithubError(error)
    }
  }

  async getRateLimit(): Promise<{ remaining: number; limit: number; reset: Date }> {
    try {
      const response = await axios.get<{ resources: { core: { remaining: number; limit: number; reset: number } } }>(
        `${GITHUB_API}/rate_limit`,
        {
          headers: getHeaders(),
        },
      )

      const core = response.data.resources.core
      return {
        remaining: core.remaining,
        limit: core.limit,
        reset: new Date(core.reset * 1000),
      }
    } catch (error) {
      mapGithubError(error)
    }
  }

  async getPullRequests(owner: string, repo: string, state: 'all' | 'open' | 'closed' = 'all', perPage = 100): Promise<PRData[]> {
    try {
      const response = await axios.get<Array<{
        id: number
        number: number
        title: string
        state: 'open' | 'closed'
        merged_at: string | null
        created_at: string
        closed_at: string | null
        user: { login: string; avatar_url: string }
        additions: number
        deletions: number
        changed_files: number
        labels: Array<{ name: string }>
        review_comments: number
        comments: number
        html_url: string
      }>>(`${GITHUB_API}/repos/${owner}/${repo}/pulls`, {
        headers: getHeaders(),
        params: { state, per_page: perPage, page: 1 },
        timeout: REQUEST_TIMEOUT_MS,
      })

      const prs = await Promise.all(
        response.data.map(async pr => {
          const detailResponse = await axios.get<{
            additions?: number
            deletions?: number
            changed_files?: number
            review_comments?: number
            comments?: number
          }>(`${GITHUB_API}/repos/${owner}/${repo}/pulls/${pr.number}`, {
            headers: getHeaders(),
            timeout: REQUEST_TIMEOUT_MS,
          })

          const detail = detailResponse.data

          return {
            id: pr.id,
            number: pr.number,
            title: pr.title,
            state: pr.state,
            merged: Boolean(pr.merged_at),
            mergedAt: pr.merged_at,
            createdAt: pr.created_at,
            closedAt: pr.closed_at,
            author: pr.user.login,
            authorAvatar: pr.user.avatar_url,
            url: pr.html_url,
            additions: detail.additions ?? pr.additions ?? 0,
            deletions: detail.deletions ?? pr.deletions ?? 0,
            changedFiles: detail.changed_files ?? pr.changed_files ?? 0,
            labels: pr.labels.map(label => label.name),
            reviewCount: detail.review_comments ?? pr.review_comments ?? 0,
            commentCount: detail.comments ?? pr.comments ?? 0,
          }
        }),
      )

      return prs
    } catch (error) {
      mapGithubError(error)
    }
  }

  async getIssues(owner: string, repo: string, state: 'all' | 'open' | 'closed' = 'all', perPage = 100): Promise<IssueData[]> {
    try {
      const response = await axios.get<Array<{
        id: number
        number: number
        title: string
        state: 'open' | 'closed'
        created_at: string
        closed_at: string | null
        user: { login: string }
        labels: Array<{ name: string }>
        comments: number
        html_url: string
        pull_request?: unknown
      }>>(`${GITHUB_API}/repos/${owner}/${repo}/issues`, {
        headers: getHeaders(),
        params: { state, per_page: perPage, page: 1 },
        timeout: REQUEST_TIMEOUT_MS,
      })

      return response.data
        .filter(item => item.pull_request === undefined)
        .map(item => ({
          id: item.id,
          number: item.number,
          title: item.title,
          state: item.state,
          createdAt: item.created_at,
          closedAt: item.closed_at,
          author: item.user.login,
          labels: item.labels.map(label => label.name),
          commentCount: item.comments ?? 0,
          isPR: false,
          url: item.html_url,
        }))
    } catch (error) {
      mapGithubError(error)
    }
  }

  calculatePRStats(prs: PRData[]): PRStats {
    const totalPRs = prs.length
    const openPRs = prs.filter(pr => pr.state === 'open').length
    const closedPRs = prs.filter(pr => pr.state === 'closed').length
    const mergedPRs = prs.filter(pr => pr.merged).length
    const mergeRate = closedPRs > 0 ? Number(((mergedPRs / closedPRs) * 100).toFixed(1)) : 0

    const avgMergeTimeHours = prs.filter(pr => pr.merged && pr.mergedAt).reduce((sum, pr) => sum + ((new Date(pr.mergedAt ?? pr.createdAt).getTime() - new Date(pr.createdAt).getTime()) / 36e5), 0) / Math.max(1, mergedPRs)
    const avgAdditions = totalPRs > 0 ? prs.reduce((sum, pr) => sum + pr.additions, 0) / totalPRs : 0
    const avgDeletions = totalPRs > 0 ? prs.reduce((sum, pr) => sum + pr.deletions, 0) / totalPRs : 0

    const topContributors = Array.from(prs.reduce((map, pr) => {
      map.set(pr.author, (map.get(pr.author) ?? 0) + 1)
      return map
    }, new Map<string, number>()).entries())
      .map(([login, prCount]) => ({ login, prCount }))
      .sort((a, b) => b.prCount - a.prCount)
      .slice(0, 5)

    const weeks = getLastTwelveWeeks()
    const weekMap = new Map(weeks.map(week => [week, { week, opened: 0, closed: 0, merged: 0 }]))

    prs.forEach(pr => {
      const openedWeek = startOfWeekUTC(pr.createdAt)
      if (weekMap.has(openedWeek)) {
        weekMap.get(openedWeek)!.opened += 1
      }
      if (pr.closedAt) {
        const closedWeek = startOfWeekUTC(pr.closedAt)
        if (weekMap.has(closedWeek)) {
          weekMap.get(closedWeek)!.closed += 1
        }
      }
      if (pr.mergedAt) {
        const mergedWeek = startOfWeekUTC(pr.mergedAt)
        if (weekMap.has(mergedWeek)) {
          weekMap.get(mergedWeek)!.merged += 1
        }
      }
    })

    return {
      totalPRs,
      openPRs,
      closedPRs,
      mergedPRs,
      mergeRate,
      avgMergeTimeHours: Number(avgMergeTimeHours.toFixed(1)),
      avgAdditions: Number(avgAdditions.toFixed(1)),
      avgDeletions: Number(avgDeletions.toFixed(1)),
      topContributors,
      weeklyActivity: Array.from(weekMap.values()),
    }
  }

  calculateIssueStats(issues: IssueData[]): IssueStats {
    const totalIssues = issues.length
    const openIssues = issues.filter(issue => issue.state === 'open').length
    const closedIssues = issues.filter(issue => issue.state === 'closed').length
    const resolutionRate = totalIssues > 0 ? Number(((closedIssues / totalIssues) * 100).toFixed(1)) : 0
    const avgResolutionHours = issues.filter(issue => issue.closedAt).reduce((sum, issue) => sum + ((new Date(issue.closedAt ?? issue.createdAt).getTime() - new Date(issue.createdAt).getTime()) / 36e5), 0) / Math.max(1, closedIssues)

    const weeks = getLastTwelveWeeks()
    const weekMap = new Map(weeks.map(week => [week, { week, opened: 0, closed: 0 }]))

    issues.forEach(issue => {
      const openedWeek = startOfWeekUTC(issue.createdAt)
      if (weekMap.has(openedWeek)) {
        weekMap.get(openedWeek)!.opened += 1
      }
      if (issue.closedAt) {
        const closedWeek = startOfWeekUTC(issue.closedAt)
        if (weekMap.has(closedWeek)) {
          weekMap.get(closedWeek)!.closed += 1
        }
      }
    })

    const labelCounts = new Map<string, { name: string; count: number; color: string }>()
    issues.forEach(issue => {
      issue.labels.forEach(label => {
        const current = labelCounts.get(label) ?? { name: label, count: 0, color: colorFromLabelName(label) }
        current.count += 1
        labelCounts.set(label, current)
      })
    })

    return {
      totalIssues,
      openIssues,
      closedIssues,
      resolutionRate,
      avgResolutionHours: Number(avgResolutionHours.toFixed(1)),
      weeklyActivity: Array.from(weekMap.values()),
      topLabels: Array.from(labelCounts.values()).sort((a, b) => b.count - a.count).slice(0, 8),
    }
  }
}

export const githubService = new GitHubService()
export { GitHubApiError }
