// bitbucket.*: pull request reads and comments with the Bitbucket credentials saved on this host.
// The credential never leaves the host; callers get mapped results only.
import {
  addBitbucketPullRequestComment,
  getBitbucketPullRequestDetail,
  getBitbucketPullRequestDiff,
  listBitbucketPullRequestComments,
  listBitbucketPullRequests
} from '../../../../../bitbucket/pull-request-review'
import { getBitbucketConnectionStatus } from '../../../../../bitbucket/credential-connection'
import { getBitbucketServerConnectionStatus } from '../../../../../bitbucket/server-credential-connection'
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
    handler: async () => {
      const [cloud, server] = await Promise.all([
        getBitbucketConnectionStatus(),
        getBitbucketServerConnectionStatus()
      ])
      return { ...cloud, server }
    }
  }),
  defineMethod({
    name: 'bitbucket.listPullRequests',
    permission: 'workspace',
    params: BitbucketPullRequestList,
    handler: async ({ state, limit, ...repo }) =>
      listBitbucketPullRequests(
        repo,
        state ?? 'open',
        Math.min(Math.max(1, Math.floor(limit ?? DEFAULT_LIST_LIMIT)), MAX_LIST_LIMIT)
      )
  }),
  defineMethod({
    name: 'bitbucket.getPullRequest',
    permission: 'workspace',
    params: BitbucketPullRequestRead,
    handler: async (target) => getBitbucketPullRequestDetail(target)
  }),
  defineMethod({
    name: 'bitbucket.getPullRequestDiff',
    permission: 'workspace',
    params: BitbucketPullRequestDiffRead,
    handler: async ({ path, ...target }) => getBitbucketPullRequestDiff(target, path?.trim())
  }),
  defineMethod({
    name: 'bitbucket.listPullRequestComments',
    permission: 'workspace',
    params: BitbucketPullRequestRead,
    handler: async (target) => listBitbucketPullRequestComments(target)
  }),
  defineMethod({
    name: 'bitbucket.addPullRequestComment',
    permission: 'workspace',
    params: BitbucketPullRequestCommentAdd,
    handler: async ({ body, parentId, anchor, ...target }) =>
      addBitbucketPullRequestComment(target, body, { anchor, parentId })
  })
]
