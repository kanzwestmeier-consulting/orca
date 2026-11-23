import type {
  BitbucketRepositoryTarget,
  BitbucketReviewResult
} from '../../shared/bitbucket/bitbucket-pull-request-review'
import {
  requestHostedReviewJson,
  requestHostedReviewText,
  type HostedReviewTextReply
} from '../source-control/hosted-review-api-request'
import { bitbucketReviewFailure, bitbucketReviewFailureFor } from './review-request-failure'
import {
  normalizeBitbucketServerBaseUrl,
  resolveBitbucketServerAuthConfig,
  serverAuthHeaders
} from './server-auth-config'
import { bitbucketServerRepoApiPath } from './server-client'

const READ_TIMEOUT_MS = 15_000
const WRITE_TIMEOUT_MS = 30_000

export type BitbucketServerQuery = readonly (readonly [string, string])[]

type Connection = { baseUrl: string; headers: Record<string, string> }

async function send<T>(
  repo: BitbucketRepositoryTarget,
  write: boolean,
  run: (connection: Connection) => Promise<T>
): Promise<BitbucketReviewResult<T>> {
  const config = await resolveBitbucketServerAuthConfig()
  if (!config.baseUrl || !config.accessToken) {
    return bitbucketReviewFailure(
      'bitbucket_not_connected',
      "No Bitbucket Data Center server is connected on this host. Connect it in Settings > Integrations, or set ORCA_BITBUCKET_SERVER_BASE_URL and ORCA_BITBUCKET_SERVER_TOKEN in the host's environment."
    )
  }
  // The token goes to the connected server only, whatever server a pasted URL names.
  if (repo.serverUrl && normalizeBitbucketServerBaseUrl(repo.serverUrl) !== config.baseUrl) {
    return bitbucketReviewFailure(
      'bitbucket_not_connected',
      `That pull request is not on the connected Bitbucket Data Center server (${config.baseUrl}).`
    )
  }
  try {
    return {
      ok: true,
      value: await run({ baseUrl: config.baseUrl, headers: serverAuthHeaders(config) })
    }
  } catch (error) {
    return bitbucketReviewFailureFor(error, write)
  }
}

function repositoryUrl(
  connection: Connection,
  repo: BitbucketRepositoryTarget,
  path: string,
  query: BitbucketServerQuery
): URL {
  const url = new URL(
    `${connection.baseUrl}${bitbucketServerRepoApiPath({ projectKey: repo.workspace, repoSlug: repo.repoSlug })}${path}`
  )
  for (const [key, value] of query) {
    url.searchParams.append(key, value)
  }
  return url
}

export function getBitbucketServerJson<T>(
  repo: BitbucketRepositoryTarget,
  path: string,
  query: BitbucketServerQuery = []
): Promise<BitbucketReviewResult<T>> {
  return send(repo, false, (connection) =>
    requestHostedReviewJson<T>(
      repositoryUrl(connection, repo, path, query),
      { headers: { Accept: 'application/json', ...connection.headers } },
      READ_TIMEOUT_MS
    )
  )
}

export function getBitbucketServerText(
  repo: BitbucketRepositoryTarget,
  path: string,
  maxChars: number
): Promise<BitbucketReviewResult<HostedReviewTextReply>> {
  return send(repo, false, (connection) =>
    requestHostedReviewText(
      repositoryUrl(connection, repo, path, []),
      { headers: { Accept: 'text/plain', ...connection.headers } },
      WRITE_TIMEOUT_MS,
      maxChars
    )
  )
}

export function postBitbucketServerJson<T>(
  repo: BitbucketRepositoryTarget,
  path: string,
  body: unknown
): Promise<BitbucketReviewResult<T>> {
  return send(repo, true, (connection) =>
    requestHostedReviewJson<T>(
      repositoryUrl(connection, repo, path, []),
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...connection.headers
        },
        body: JSON.stringify(body)
      },
      WRITE_TIMEOUT_MS
    )
  )
}
