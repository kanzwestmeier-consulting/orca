// Bitbucket rules ride the host's automation tick beside Look around and the Google rules, on
// desktop and `orca serve` alike. Everything is asked with this host's own Bitbucket connection:
// bitbucket.org, or the connected Data Center server.
import type {
  BitbucketRepositoryTarget,
  BitbucketReviewFailure
} from '../../shared/bitbucket/bitbucket-pull-request-review'
import {
  parseBitbucketRepositoryInput,
  parseBitbucketServerRepositoryInput
} from '../../shared/bitbucket/bitbucket-pull-request-target'
import type { AutomationService } from '../automations/automation-service'
import type { Store } from '../persistence/loading-store/store'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { hasAuth } from './bitbucket-auth-config'
import { lookAtBitbucketCloudComments } from './bitbucket-comment-look'
import { readOwnBitbucketAuthors } from './bitbucket-own-comment-authors'
import { BitbucketTriggerChecker } from './bitbucket-trigger-checker'
import { readBitbucketTriggerState, writeBitbucketTriggerState } from './bitbucket-trigger-state'
import {
  listBitbucketCloudRecentComments,
  listBitbucketCloudReviewRequests
} from './cloud-pull-request-activity'
import { isOnBitbucketServer } from './pull-request-review'
import { resolveBitbucketAuthConfig } from './resolve-auth'
import { getBitbucketServerBaseUrl, hasBitbucketServerCredential } from './server-auth-config'
import { readBitbucketServerAccount } from './server-credential-connection'
import {
  listBitbucketServerReviewRequests,
  lookAtBitbucketServerComments
} from './server-pull-request-activity'
import { fetchBitbucketUserResult } from './user-request'

const UNKNOWN_REPOSITORY: BitbucketReviewFailure = {
  ok: false,
  code: 'bitbucket_not_found',
  error: 'The rule names no Bitbucket repository.'
}

type Place =
  | { on: 'cloud'; target: BitbucketRepositoryTarget }
  | { on: 'server'; target: BitbucketRepositoryTarget; baseUrl: string }

// A rule names `workspace/repository` without a host, so it is asked of the one Bitbucket connected.
async function placeOf(repo: string): Promise<Place | BitbucketReviewFailure> {
  const server = parseBitbucketServerRepositoryInput(repo)
  if (!server) {
    return UNKNOWN_REPOSITORY
  }
  const choice = await isOnBitbucketServer({
    workspace: server.workspace,
    repoSlug: server.repoSlug
  })
  if (typeof choice !== 'boolean') {
    return choice
  }
  if (choice) {
    const baseUrl = await getBitbucketServerBaseUrl()
    return baseUrl ? { on: 'server', target: server, baseUrl } : UNKNOWN_REPOSITORY
  }
  const cloud = parseBitbucketRepositoryInput(repo)
  return cloud ? { on: 'cloud', target: cloud } : UNKNOWN_REPOSITORY
}

async function connectedAccountId(): Promise<string | null> {
  const config = await resolveBitbucketAuthConfig()
  if (hasAuth(config)) {
    const result = await fetchBitbucketUserResult(config)
    return result.ok ? (result.user?.account_id ?? null) : null
  }
  return (await hasBitbucketServerCredential()) ? readBitbucketServerAccount() : null
}

export function bindBitbucketTriggersToAutomations(
  service: Pick<AutomationService, 'onTick' | 'stop'>,
  store: Pick<Store, 'listAutomations'>,
  runtime: Pick<OrcaRuntimeService, 'runAutomationForEvent'>
): void {
  const checker = new BitbucketTriggerChecker({
    automations: () => store.listAutomations(),
    accountId: connectedAccountId,
    ownAuthors: () => readOwnBitbucketAuthors(),
    newComments: async (repo, saved, now) => {
      const place = await placeOf(repo)
      if ('ok' in place) {
        return place
      }
      return place.on === 'server'
        ? lookAtBitbucketServerComments(place.target, place.baseUrl, saved, now)
        : lookAtBitbucketCloudComments(
            (afterId) => listBitbucketCloudRecentComments(place.target, afterId),
            saved,
            repo
          )
    },
    reviewRequests: async (repo, accountId) => {
      const place = await placeOf(repo)
      if ('ok' in place) {
        return place
      }
      return place.on === 'server'
        ? listBitbucketServerReviewRequests(place.target, place.baseUrl, accountId)
        : listBitbucketCloudReviewRequests(place.target, accountId)
    },
    runForEvent: (automationId, event) => runtime.runAutomationForEvent(automationId, event),
    readState: () => readBitbucketTriggerState(),
    writeState: (state) => writeBitbucketTriggerState(state),
    now: () => Date.now()
  })
  const earlier = service.onTick
  service.onTick = () => {
    earlier?.()
    void checker.tick()
  }
  const stop = service.stop.bind(service)
  service.stop = () => {
    checker.stop()
    stop()
  }
}
