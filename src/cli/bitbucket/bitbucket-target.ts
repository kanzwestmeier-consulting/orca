import type {
  BitbucketPullRequestTarget,
  BitbucketRepositoryTarget
} from '../../shared/bitbucket/bitbucket-pull-request-review'
import {
  parseBitbucketPullRequestId,
  parseBitbucketPullRequestUrl,
  parseBitbucketRepositoryInput
} from '../../shared/bitbucket/bitbucket-pull-request-target'
import { getOptionalStringFlag, getRequiredStringFlag } from '../arguments/flags'
import type { HandlerContext } from '../dispatch/dispatch'
import { RuntimeClientError } from '../runtime/connection/types'

export function resolveBitbucketRepository(context: HandlerContext): BitbucketRepositoryTarget {
  const repository = parseBitbucketRepositoryInput(getRequiredStringFlag(context.flags, 'repo'))
  if (!repository) {
    throw new RuntimeClientError(
      'invalid_argument',
      '--repo must be <workspace>/<repository> or a bitbucket.org repository URL.'
    )
  }
  return repository
}

export function resolveBitbucketPullRequest(context: HandlerContext): BitbucketPullRequestTarget {
  const url = getOptionalStringFlag(context.flags, 'url')
  const hasRepo = context.flags.has('repo')
  const hasId = context.flags.has('pr')
  if (url !== undefined) {
    if (hasRepo || hasId) {
      throw new RuntimeClientError(
        'invalid_argument',
        'Pass a pull request URL, or --repo with --pr, not both.'
      )
    }
    const target = parseBitbucketPullRequestUrl(url)
    if (!target) {
      throw new RuntimeClientError(
        'invalid_argument',
        'Expected a bitbucket.org pull request URL, like https://bitbucket.org/acme/api/pull-requests/42.'
      )
    }
    return target
  }
  if (!hasRepo || !hasId) {
    throw new RuntimeClientError(
      'invalid_argument',
      'Name the pull request: a bitbucket.org pull request URL, or --repo <workspace>/<repository> with --pr <id>.'
    )
  }
  const id = parseBitbucketPullRequestId(getRequiredStringFlag(context.flags, 'pr'))
  if (id === null) {
    throw new RuntimeClientError('invalid_argument', '--pr must be a pull request number.')
  }
  return { ...resolveBitbucketRepository(context), id }
}
