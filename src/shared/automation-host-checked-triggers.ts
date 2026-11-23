// The rules a host checks itself with its own sign-in or connection: Gmail, Calendar and Bitbucket.
// Orca Cloud never has them, so it can neither match nor deliver one.
import {
  assertBitbucketTrigger,
  isBitbucketTrigger,
  type AutomationBitbucketTrigger
} from './automation-bitbucket-triggers'
import {
  assertGoogleTrigger,
  isGoogleTrigger,
  type AutomationGoogleTrigger,
  type GoogleEventSource
} from './automation-google-triggers'

export type HostCheckedEventSource = GoogleEventSource | 'bitbucket'
export type AutomationHostCheckedTrigger = AutomationGoogleTrigger | AutomationBitbucketTrigger

export function isHostCheckedTrigger<Rule extends { source: string }>(
  trigger: Rule
): trigger is Extract<Rule, { source: HostCheckedEventSource }> {
  return isGoogleTrigger(trigger) || isBitbucketTrigger(trigger)
}

export function isHostCheckedSource(source: string): source is HostCheckedEventSource {
  return isHostCheckedTrigger({ source })
}

export function assertHostCheckedTrigger(trigger: AutomationHostCheckedTrigger): void {
  if (isBitbucketTrigger(trigger)) {
    assertBitbucketTrigger(trigger)
  } else {
    assertGoogleTrigger(trigger)
  }
}
