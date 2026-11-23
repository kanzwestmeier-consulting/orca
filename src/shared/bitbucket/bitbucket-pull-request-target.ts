import { normalizeBitbucketRemoteHost } from '../git/remotes/git-remote-host-alias'
import type {
  BitbucketPullRequestTarget,
  BitbucketRepositoryTarget
} from './bitbucket-pull-request-review'

// Bitbucket Cloud slugs; rejecting everything else keeps `..` and encoded separators out of API paths.
const SLUG_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/

function repositoryFromSegments(
  workspace: string | undefined,
  repoSlug: string | undefined
): BitbucketRepositoryTarget | null {
  if (!workspace || !repoSlug || !SLUG_PATTERN.test(workspace) || !SLUG_PATTERN.test(repoSlug)) {
    return null
  }
  return { workspace, repoSlug }
}

function bitbucketCloudPathSegments(input: string): string[] | null {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return null
  }
  const host = normalizeBitbucketRemoteHost(url.hostname).replace(/^www\./, '')
  if (!['https:', 'http:'].includes(url.protocol) || host !== 'bitbucket.org') {
    return null
  }
  return url.pathname.split('/').filter(Boolean)
}

/** `workspace/repo`, or a bitbucket.org repository URL. */
export function parseBitbucketRepositoryInput(input: string): BitbucketRepositoryTarget | null {
  const trimmed = input.trim()
  const segments = bitbucketCloudPathSegments(trimmed)
  if (segments) {
    return repositoryFromSegments(segments[0], segments[1]?.replace(/\.git$/i, ''))
  }
  const parts = trimmed.split('/')
  return parts.length === 2 ? repositoryFromSegments(parts[0], parts[1]) : null
}

/** A bitbucket.org pull request URL, including its diff, commits and comment-anchor pages. */
export function parseBitbucketPullRequestUrl(input: string): BitbucketPullRequestTarget | null {
  const segments = bitbucketCloudPathSegments(input)
  if (!segments || segments[2] !== 'pull-requests') {
    return null
  }
  const repository = repositoryFromSegments(segments[0], segments[1])
  const id = parseBitbucketPullRequestId(segments[3] ?? '')
  return repository && id !== null ? { ...repository, id } : null
}

export function parseBitbucketPullRequestId(input: string): number | null {
  const trimmed = input.trim().replace(/^#/, '')
  if (!/^[1-9][0-9]{0,14}$/.test(trimmed)) {
    return null
  }
  return Number(trimmed)
}
