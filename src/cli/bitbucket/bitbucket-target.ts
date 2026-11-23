import type {
  BitbucketDialect,
  BitbucketPullRequestTarget,
  BitbucketRepositoryTarget
} from '../../shared/bitbucket/bitbucket-pull-request-review'
import {
  parseBitbucketPullRequestId,
  parseBitbucketPullRequestUrl,
  parseBitbucketRepositoryInput,
  parseBitbucketServerPullRequestUrl,
  parseBitbucketServerRepositoryInput
} from '../../shared/bitbucket/bitbucket-pull-request-target'
import { getOptionalStringFlag, getRequiredStringFlag } from '../arguments/flags'
import type { HandlerContext } from '../dispatch/dispatch'
import { RuntimeClientError } from '../runtime/connection/types'

function requestedDialect(context: HandlerContext): BitbucketDialect | undefined {
  const server = context.flags.get('server') === true
  const cloud = context.flags.get('cloud') === true
  if (server && cloud) {
    throw new RuntimeClientError('invalid_argument', 'Pass --server or --cloud, not both.')
  }
  return server ? 'server' : cloud ? 'cloud' : undefined
}

export function resolveBitbucketRepository(context: HandlerContext): BitbucketRepositoryTarget {
  const input = getRequiredStringFlag(context.flags, 'repo')
  const dialect = requestedDialect(context)
  // A Data Center project key may start with `~`, which no Cloud workspace does.
  const repository =
    dialect === 'server'
      ? parseBitbucketServerRepositoryInput(input)
      : (parseBitbucketRepositoryInput(input) ??
        (dialect === undefined ? parseBitbucketServerRepositoryInput(input) : null))
  if (!repository) {
    throw new RuntimeClientError(
      'invalid_argument',
      '--repo must be <workspace>/<repository> on bitbucket.org, or <PROJECT>/<repository> on the connected Data Center server.'
    )
  }
  return { ...repository, ...(dialect ? { dialect } : {}) }
}

export function resolveBitbucketPullRequest(context: HandlerContext): BitbucketPullRequestTarget {
  const url = getOptionalStringFlag(context.flags, 'url')
  const hasRepo = context.flags.has('repo')
  const hasId = context.flags.has('pr')
  if (url !== undefined) {
    if (hasRepo || hasId || requestedDialect(context)) {
      throw new RuntimeClientError(
        'invalid_argument',
        'Pass a pull request URL, or --repo with --pr, not both.'
      )
    }
    const target = parseBitbucketPullRequestUrl(url) ?? parseBitbucketServerPullRequestUrl(url)
    if (!target) {
      throw new RuntimeClientError(
        'invalid_argument',
        'Expected a Bitbucket pull request URL, like https://bitbucket.org/acme/api/pull-requests/42 or https://git.example.com/projects/API/repos/server/pull-requests/42.'
      )
    }
    return target
  }
  if (!hasRepo || !hasId) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Name the pull request: its URL, or --repo <workspace>/<repository> with --pr <id>.'
    )
  }
  const id = parseBitbucketPullRequestId(getRequiredStringFlag(context.flags, 'pr'))
  if (id === null) {
    throw new RuntimeClientError('invalid_argument', '--pr must be a pull request number.')
  }
  return { ...resolveBitbucketRepository(context), id }
}
