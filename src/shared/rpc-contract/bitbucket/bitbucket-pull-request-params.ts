import { z } from 'zod'
import {
  BITBUCKET_COMMENT_SIDES,
  BITBUCKET_PULL_REQUEST_STATE_FILTERS
} from '../../bitbucket/bitbucket-pull-request-review'
import { OptionalFiniteNumber, OptionalString, requiredString } from '../rpc-param-primitives'

const Repository = z.object({
  workspace: requiredString('Workspace is required'),
  repoSlug: requiredString('Repository is required')
})

const PositiveId = z.number().int().positive()

export const BitbucketPullRequestList = Repository.extend({
  state: z.enum(BITBUCKET_PULL_REQUEST_STATE_FILTERS).optional(),
  limit: OptionalFiniteNumber
})

export const BitbucketPullRequestRead = Repository.extend({ id: PositiveId })

export const BitbucketPullRequestDiffRead = BitbucketPullRequestRead.extend({
  path: OptionalString
})

export const BitbucketPullRequestCommentAdd = BitbucketPullRequestRead.extend({
  body: requiredString('Comment body is required'),
  parentId: PositiveId.optional(),
  anchor: z
    .object({
      path: requiredString('File path is required'),
      line: PositiveId,
      side: z.enum(BITBUCKET_COMMENT_SIDES)
    })
    .optional()
})
