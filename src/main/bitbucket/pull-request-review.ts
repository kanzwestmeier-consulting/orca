// Pull request reads and comments for either Bitbucket: bitbucket.org or the connected Data Center server.
import type {
  BitbucketCommentAnchor,
  BitbucketPullRequestStateFilter,
  BitbucketPullRequestTarget,
  BitbucketRepositoryTarget,
  BitbucketReviewFailure,
  BitbucketReviewResult
} from '../../shared/bitbucket/bitbucket-pull-request-review'
import {
  addBitbucketCloudPullRequestComment,
  listBitbucketCloudPullRequestComments
} from './cloud-pull-request-comments'
import {
  getBitbucketCloudPullRequestDetail,
  getBitbucketCloudPullRequestDiff,
  listBitbucketCloudPullRequests
} from './cloud-pull-request-read'
import { isBitbucketReviewCreationAuthenticated } from './pull-request-creation'
import { bitbucketReviewFailure } from './review-request-failure'
import { hasBitbucketServerCredential } from './server-auth-config'
import {
  addBitbucketServerPullRequestComment,
  listBitbucketServerPullRequestComments
} from './server-pull-request-comments'
import {
  getBitbucketServerPullRequestDetail,
  getBitbucketServerPullRequestDiff,
  listBitbucketServerPullRequests
} from './server-pull-request-read'

/** Whether the target is on the Data Center server; a failure when a bare name fits both hosts. */
export async function isOnBitbucketServer(
  target: BitbucketRepositoryTarget
): Promise<boolean | BitbucketReviewFailure> {
  if (target.dialect) {
    return target.dialect === 'server'
  }
  // A bare workspace/repo names no host, so it is only clear with one Bitbucket connected.
  const [cloud, server] = await Promise.all([
    isBitbucketReviewCreationAuthenticated(),
    hasBitbucketServerCredential()
  ])
  if (cloud && server) {
    return bitbucketReviewFailure(
      'bitbucket_ambiguous_host',
      'Both Bitbucket Cloud and a Data Center server are connected. Pass the pull request URL, or add --server for the Data Center server or --cloud for bitbucket.org.'
    )
  }
  return server
}

async function route<T>(
  target: BitbucketRepositoryTarget,
  cloud: () => Promise<BitbucketReviewResult<T>>,
  server: () => Promise<BitbucketReviewResult<T>>
): Promise<BitbucketReviewResult<T>> {
  const choice = await isOnBitbucketServer(target)
  if (typeof choice !== 'boolean') {
    return choice
  }
  return choice ? server() : cloud()
}

export const listBitbucketPullRequests = (
  repo: BitbucketRepositoryTarget,
  state: BitbucketPullRequestStateFilter,
  limit: number
) =>
  route(
    repo,
    () => listBitbucketCloudPullRequests(repo, state, limit),
    () => listBitbucketServerPullRequests(repo, state, limit)
  )

export const getBitbucketPullRequestDetail = (target: BitbucketPullRequestTarget) =>
  route(
    target,
    () => getBitbucketCloudPullRequestDetail(target),
    () => getBitbucketServerPullRequestDetail(target)
  )

export const getBitbucketPullRequestDiff = (target: BitbucketPullRequestTarget, path?: string) =>
  route(
    target,
    () => getBitbucketCloudPullRequestDiff(target, path),
    () => getBitbucketServerPullRequestDiff(target, path)
  )

export const listBitbucketPullRequestComments = (target: BitbucketPullRequestTarget) =>
  route(
    target,
    () => listBitbucketCloudPullRequestComments(target),
    () => listBitbucketServerPullRequestComments(target)
  )

export const addBitbucketPullRequestComment = (
  target: BitbucketPullRequestTarget,
  body: string,
  placement: { anchor?: BitbucketCommentAnchor; parentId?: number }
) =>
  route(
    target,
    () => addBitbucketCloudPullRequestComment(target, body, placement),
    () => addBitbucketServerPullRequestComment(target, body, placement)
  )
