import type {
  BitbucketRepositoryTarget,
  BitbucketReviewResult
} from '../../shared/bitbucket/bitbucket-pull-request-review'
import {
  requestHostedReviewJson,
  requestHostedReviewText,
  type HostedReviewTextReply
} from '../source-control/hosted-review-api-request'
import { authHeaders, hasAuth, type BitbucketAuthConfig } from './bitbucket-auth-config'
import { resolveBitbucketAuthConfig } from './resolve-auth'
import { bitbucketReviewFailure, bitbucketReviewFailureFor } from './review-request-failure'

const READ_TIMEOUT_MS = 15_000
const WRITE_TIMEOUT_MS = 30_000

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

async function send<T>(
  write: boolean,
  run: (config: BitbucketAuthConfig) => Promise<T>
): Promise<BitbucketReviewResult<T>> {
  const config = await resolveBitbucketAuthConfig()
  if (!hasAuth(config)) {
    return bitbucketReviewFailure(
      'bitbucket_not_connected',
      "Bitbucket is not connected on this host. Connect it in Settings > Integrations, or set ORCA_BITBUCKET_* in the host's environment."
    )
  }
  try {
    return { ok: true, value: await run(config) }
  } catch (error) {
    return bitbucketReviewFailureFor(error, write)
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
