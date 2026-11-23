// bitbucket.*: pull request reads and comments with the Bitbucket credential saved on this host.
// The credential never leaves the host; callers get mapped results only.
import {
  addBitbucketCloudPullRequestComment,
  listBitbucketCloudPullRequestComments
} from '../../../../../bitbucket/cloud-pull-request-comments'
import {
  getBitbucketCloudPullRequestDetail,
  getBitbucketCloudPullRequestDiff,
  listBitbucketCloudPullRequests
} from '../../../../../bitbucket/cloud-pull-request-read'
import { getBitbucketConnectionStatus } from '../../../../../bitbucket/credential-connection'
import {
  BitbucketPullRequestCommentAdd,
  BitbucketPullRequestDiffRead,
  BitbucketPullRequestList,
  BitbucketPullRequestRead
} from '../../../../../../shared/rpc-contract/bitbucket/bitbucket-pull-request-params'
import { defineMethod } from '../../../core'

const DEFAULT_LIST_LIMIT = 30
const MAX_LIST_LIMIT = 100

export const BITBUCKET_PULL_REQUEST_METHODS = [
  defineMethod({
    name: 'bitbucket.status',
    permission: 'workspace',
    params: null,
    handler: async () => getBitbucketConnectionStatus()
  }),
  defineMethod({
    name: 'bitbucket.listPullRequests',
    permission: 'workspace',
    params: BitbucketPullRequestList,
    handler: async ({ workspace, repoSlug, state, limit }) =>
      listBitbucketCloudPullRequests(
        { workspace, repoSlug },
        state ?? 'open',
        Math.min(Math.max(1, Math.floor(limit ?? DEFAULT_LIST_LIMIT)), MAX_LIST_LIMIT)
      )
  }),
  defineMethod({
    name: 'bitbucket.getPullRequest',
    permission: 'workspace',
    params: BitbucketPullRequestRead,
    handler: async (target) => getBitbucketCloudPullRequestDetail(target)
  }),
  defineMethod({
    name: 'bitbucket.getPullRequestDiff',
    permission: 'workspace',
    params: BitbucketPullRequestDiffRead,
    handler: async ({ path, ...target }) => getBitbucketCloudPullRequestDiff(target, path?.trim())
  }),
  defineMethod({
    name: 'bitbucket.listPullRequestComments',
    permission: 'workspace',
    params: BitbucketPullRequestRead,
    handler: async (target) => listBitbucketCloudPullRequestComments(target)
  }),
  defineMethod({
    name: 'bitbucket.addPullRequestComment',
    permission: 'workspace',
    params: BitbucketPullRequestCommentAdd,
    handler: async ({ body, parentId, anchor, ...target }) =>
      addBitbucketCloudPullRequestComment(target, body, { anchor, parentId })
  })
]
