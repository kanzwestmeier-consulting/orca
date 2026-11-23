// Bitbucket rules ride the host's automation tick beside Look around and the Google rules, on
// desktop and `orca serve` alike. Everything is asked with this host's own Bitbucket connection.
import { parseBitbucketRepositoryInput } from '../../shared/bitbucket/bitbucket-pull-request-target'
import type { AutomationService } from '../automations/automation-service'
import type { Store } from '../persistence/loading-store/store'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { hasAuth } from './bitbucket-auth-config'
import { readOwnBitbucketAuthors } from './bitbucket-own-comment-authors'
import { BitbucketTriggerChecker } from './bitbucket-trigger-checker'
import { readBitbucketTriggerState, writeBitbucketTriggerState } from './bitbucket-trigger-state'
import {
  listBitbucketCloudRecentComments,
  listBitbucketCloudReviewRequests
} from './cloud-pull-request-activity'
import { resolveBitbucketAuthConfig } from './resolve-auth'
import { fetchBitbucketUserResult } from './user-request'

const UNKNOWN_REPOSITORY = {
  ok: false,
  code: 'bitbucket_not_found',
  error: 'The rule names no Bitbucket repository.'
} as const

async function connectedAccountId(): Promise<string | null> {
  const config = await resolveBitbucketAuthConfig()
  if (!hasAuth(config)) {
    return null
  }
  const result = await fetchBitbucketUserResult(config)
  return result.ok ? (result.user?.account_id ?? null) : null
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
    recentComments: async (repo, afterId) => {
      const target = parseBitbucketRepositoryInput(repo)
      return target ? listBitbucketCloudRecentComments(target, afterId) : UNKNOWN_REPOSITORY
    },
    reviewRequests: async (repo, accountId) => {
      const target = parseBitbucketRepositoryInput(repo)
      return target ? listBitbucketCloudReviewRequests(target, accountId) : UNKNOWN_REPOSITORY
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
