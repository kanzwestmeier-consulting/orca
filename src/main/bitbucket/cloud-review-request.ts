import type {
  BitbucketRepositoryTarget,
  BitbucketReviewFailure,
  BitbucketReviewResult
} from '../../shared/bitbucket/bitbucket-pull-request-review'
import {
  HostedReviewApiRequestError,
  requestHostedReviewJson,
  requestHostedReviewText,
  type HostedReviewTextReply
} from '../source-control/hosted-review-api-request'
import { authHeaders, hasAuth, type BitbucketAuthConfig } from './bitbucket-auth-config'
import { resolveBitbucketAuthConfig } from './resolve-auth'

const READ_TIMEOUT_MS = 15_000
const WRITE_TIMEOUT_MS = 30_000
const MAX_ERROR_DETAIL_CHARS = 300
const UNCONFIRMED_WRITE = 'It may have been applied; check the pull request before retrying.'

export type BitbucketCloudQuery = readonly (readonly [string, string])[]

function repositoryUrl(
  config: BitbucketAuthConfig,
  repo: BitbucketRepositoryTarget,
  path: string,
  query: BitbucketCloudQuery
): URL {
  const base = config.baseUrl.replace(/\/+$/, '')
  const url = new URL(
    `${base}/repositories/${encodeURIComponent(repo.workspace)}/${encodeURIComponent(repo.repoSlug)}${path}`
  )
  for (const [key, value] of query) {
    url.searchParams.append(key, value)
  }
  return url
}

// Bitbucket's own words help the caller; they are remote text, so keep them short.
function errorDetail(body: string): string {
  let message = body
  try {
    const parsed: unknown = JSON.parse(body)
    if (typeof parsed === 'object' && parsed !== null && 'error' in parsed) {
      const error = parsed.error
      if (typeof error === 'object' && error !== null && 'message' in error) {
        message = typeof error.message === 'string' ? error.message : ''
      }
    }
  } catch {
    // Not JSON: a proxy page or plain text.
    message = body.trimStart().startsWith('<') ? '' : body
  }
  return message.replace(/\s+/g, ' ').trim().slice(0, MAX_ERROR_DETAIL_CHARS)
}

function failure(
  code: BitbucketReviewFailure['code'],
  error: string,
  write: boolean,
  unconfirmed = false
): BitbucketReviewFailure {
  return { ok: false, code, error: write && unconfirmed ? `${error} ${UNCONFIRMED_WRITE}` : error }
}

function failureFor(error: unknown, write: boolean): BitbucketReviewFailure {
  if (!(error instanceof HostedReviewApiRequestError)) {
    const reason = error instanceof Error ? error.message : String(error)
    return failure('bitbucket_request_failed', `Could not reach Bitbucket: ${reason}.`, write, true)
  }
  if (error.timedOut) {
    return failure('bitbucket_timeout', 'Bitbucket did not answer in time.', write, true)
  }
  const detail = errorDetail(error.message)
  const status = error.status ?? 0
  switch (status) {
    case 401:
      return failure(
        'bitbucket_auth_rejected',
        'Bitbucket rejected the saved credential. Reconnect Bitbucket in Settings > Integrations.',
        write
      )
    case 403:
      return failure(
        'bitbucket_forbidden',
        `Bitbucket refused the request${detail ? `: ${detail}` : ''}. The credential may lack pull request ${write ? 'write' : 'read'} access.`,
        write
      )
    case 404:
      return failure(
        'bitbucket_not_found',
        'Bitbucket found no such pull request or repository, or the credential cannot see it.',
        write
      )
    case 429:
      return failure(
        'bitbucket_rate_limited',
        'Bitbucket is rate limiting this credential. Wait before retrying.',
        write
      )
    default:
      return failure(
        'bitbucket_request_failed',
        `Bitbucket request failed (HTTP ${status || 'unknown'})${detail ? `: ${detail}` : ''}.`,
        write,
        status >= 500
      )
  }
}

async function send<T>(
  write: boolean,
  run: (config: BitbucketAuthConfig) => Promise<T>
): Promise<BitbucketReviewResult<T>> {
  const config = await resolveBitbucketAuthConfig()
  if (!hasAuth(config)) {
    return failure(
      'bitbucket_not_connected',
      "Bitbucket is not connected on this host. Connect it in Settings > Integrations, or set ORCA_BITBUCKET_* in the host's environment.",
      write
    )
  }
  try {
    return { ok: true, value: await run(config) }
  } catch (error) {
    return failureFor(error, write)
  }
}

export function getBitbucketCloudJson<T>(
  repo: BitbucketRepositoryTarget,
  path: string,
  query: BitbucketCloudQuery = []
): Promise<BitbucketReviewResult<T>> {
  return send(false, (config) =>
    requestHostedReviewJson<T>(
      repositoryUrl(config, repo, path, query),
      { headers: { Accept: 'application/json', ...authHeaders(config) } },
      READ_TIMEOUT_MS
    )
  )
}

export function getBitbucketCloudText(
  repo: BitbucketRepositoryTarget,
  path: string,
  maxChars: number
): Promise<BitbucketReviewResult<HostedReviewTextReply>> {
  return send(false, (config) =>
    requestHostedReviewText(
      repositoryUrl(config, repo, path, []),
      { headers: { Accept: 'text/plain', ...authHeaders(config) } },
      WRITE_TIMEOUT_MS,
      maxChars
    )
  )
}

export function postBitbucketCloudJson<T>(
  repo: BitbucketRepositoryTarget,
  path: string,
  body: unknown
): Promise<BitbucketReviewResult<T>> {
  return send(true, (config) =>
    requestHostedReviewJson<T>(
      repositoryUrl(config, repo, path, []),
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...authHeaders(config)
        },
        body: JSON.stringify(body)
      },
      WRITE_TIMEOUT_MS
    )
  )
}
