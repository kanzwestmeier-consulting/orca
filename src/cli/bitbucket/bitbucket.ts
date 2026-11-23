import type { BitbucketConnectionStatus } from '../../shared/bitbucket/bitbucket-credentials'
import {
  BITBUCKET_COMMENT_SIDES,
  BITBUCKET_PULL_REQUEST_STATE_FILTERS,
  type BitbucketCommentAnchor,
  type BitbucketPullRequestComment,
  type BitbucketPullRequestCommentList,
  type BitbucketPullRequestDetail,
  type BitbucketPullRequestDiff,
  type BitbucketPullRequestSummary,
  type BitbucketReviewResult
} from '../../shared/bitbucket/bitbucket-pull-request-review'
import type { RuntimeRpcSuccess } from '../../shared/remote-runtime/rpc/runtime-rpc-envelope'
import { readCommandBody } from '../arguments/command-body-input'
import { getOptionalPositiveIntegerFlag, getOptionalStringFlag } from '../arguments/flags'
import type { CommandHandler, HandlerContext } from '../dispatch/dispatch'
import { printResult } from '../output/command-result-output'
import { RuntimeClientError } from '../runtime/connection/types'
import {
  formatBitbucketComment,
  formatBitbucketCommentList,
  formatBitbucketDiff,
  formatBitbucketPullRequest,
  formatBitbucketPullRequestList
} from './bitbucket-format'
import { resolveBitbucketPullRequest, resolveBitbucketRepository } from './bitbucket-target'

// Bitbucket Cloud rejects longer comments.
const MAX_COMMENT_CHARS = 32_000
const LOST_CONTACT_CODES = [
  'runtime_timeout',
  'runtime_connection_failed',
  'runtime_disconnected',
  'runtime_unavailable'
]

async function callBitbucket<T>(
  context: HandlerContext,
  method: string,
  params: unknown
): Promise<RuntimeRpcSuccess<T>> {
  const response = await context.client.call<BitbucketReviewResult<T>>(method, params)
  if (!response.result.ok) {
    throw new RuntimeClientError(response.result.code, response.result.error)
  }
  return { ...response, result: response.result.value }
}

function oneOf<T extends string>(
  context: HandlerContext,
  flag: string,
  allowed: readonly T[]
): T | undefined {
  const value = getOptionalStringFlag(context.flags, flag)?.trim().toLowerCase()
  const match = allowed.find((entry) => entry === value)
  if (value !== undefined && match === undefined) {
    throw new RuntimeClientError('invalid_argument', `--${flag} must be ${allowed.join(', ')}.`)
  }
  return match
}

function commentPlacement(context: HandlerContext): {
  anchor?: BitbucketCommentAnchor
  parentId?: number
} {
  const path = getOptionalStringFlag(context.flags, 'file')?.trim()
  const line = getOptionalPositiveIntegerFlag(context.flags, 'line')
  const side = oneOf(context, 'side', BITBUCKET_COMMENT_SIDES)
  const parentId = getOptionalPositiveIntegerFlag(context.flags, 'parent')
  if (parentId !== undefined) {
    if (path || line !== undefined || side) {
      throw new RuntimeClientError(
        'invalid_argument',
        'A reply sits where its parent sits; drop --file, --line and --side.'
      )
    }
    return { parentId }
  }
  if (!path && line === undefined && !side) {
    return {}
  }
  if (!path || line === undefined) {
    throw new RuntimeClientError(
      'invalid_argument',
      'An inline comment needs both --file <path> and --line <n>.'
    )
  }
  return { anchor: { path, line, side: side ?? 'new' } }
}

async function addComment(context: HandlerContext): Promise<void> {
  const body = await readCommandBody(context.flags, context.cwd, {
    required: true,
    maximumCharacters: MAX_COMMENT_CHARS,
    tooLargeCode: 'bitbucket_body_too_large',
    label: 'Comment body'
  })
  if (!body.trim()) {
    throw new RuntimeClientError('invalid_argument', 'Comment body cannot be blank.')
  }
  const target = resolveBitbucketPullRequest(context)
  const params = { ...target, body, ...commentPlacement(context) }
  let response: RuntimeRpcSuccess<BitbucketPullRequestComment>
  try {
    response = await callBitbucket(context, 'bitbucket.addPullRequestComment', params)
  } catch (error) {
    if (error instanceof RuntimeClientError && LOST_CONTACT_CODES.includes(error.code)) {
      throw new RuntimeClientError(
        'bitbucket_write_unverified',
        `${error.message} The comment may have been posted. Check the pull request before retrying.`
      )
    }
    throw error
  }
  printResult(response, context.json, (comment) =>
    [
      `Commented on ${target.workspace}/${target.repoSlug}#${target.id}`,
      formatBitbucketComment(comment),
      ...(comment.url ? [`URL: ${comment.url}`] : [])
    ].join('\n')
  )
}

export const BITBUCKET_HANDLERS: Record<string, CommandHandler> = {
  'bitbucket connection': async (context) => {
    const response = await context.client.call<BitbucketConnectionStatus>('bitbucket.status')
    printResult(response, context.json, (status) =>
      status.configured
        ? [
            `Connected (${status.source === 'environment' ? 'host environment' : 'saved in Orca'})`,
            `Account: ${status.account ?? status.email ?? 'unknown'}`,
            'A saved connection; this does not verify access to a repository.'
          ].join('\n')
        : 'Bitbucket is not connected on this host. Connect it in Settings > Integrations.'
    )
  },
  'bitbucket pr list': async (context) => {
    const response = await callBitbucket<BitbucketPullRequestSummary[]>(
      context,
      'bitbucket.listPullRequests',
      {
        ...resolveBitbucketRepository(context),
        state: oneOf(context, 'state', BITBUCKET_PULL_REQUEST_STATE_FILTERS),
        limit: getOptionalPositiveIntegerFlag(context.flags, 'limit')
      }
    )
    printResult(response, context.json, formatBitbucketPullRequestList)
  },
  'bitbucket pr view': async (context) => {
    const response = await callBitbucket<BitbucketPullRequestDetail>(
      context,
      'bitbucket.getPullRequest',
      resolveBitbucketPullRequest(context)
    )
    printResult(response, context.json, formatBitbucketPullRequest)
  },
  'bitbucket pr diff': async (context) => {
    const path = getOptionalStringFlag(context.flags, 'path')?.trim()
    const response = await callBitbucket<BitbucketPullRequestDiff>(
      context,
      'bitbucket.getPullRequestDiff',
      { ...resolveBitbucketPullRequest(context), path }
    )
    printResult(response, context.json, (result) =>
      path && !result.diff && !result.truncated
        ? `The pull request does not change ${path}.`
        : formatBitbucketDiff(result)
    )
  },
  'bitbucket pr comment list': async (context) => {
    const response = await callBitbucket<BitbucketPullRequestCommentList>(
      context,
      'bitbucket.listPullRequestComments',
      resolveBitbucketPullRequest(context)
    )
    printResult(response, context.json, formatBitbucketCommentList)
  },
  'bitbucket pr comment add': addComment
}
