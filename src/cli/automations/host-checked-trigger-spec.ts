// The `--on` rules a host checks itself (Gmail, Calendar, Bitbucket), behind one parse, format,
// description and trigger-options entry.
import { isBitbucketTrigger } from '../../shared/automation-bitbucket-triggers'
import type { AutomationEventSource } from '../../shared/automation-event-triggers'
import { GOOGLE_EVENT_SOURCES } from '../../shared/automation-google-triggers'
import type {
  AutomationHostCheckedTrigger,
  HostCheckedEventSource
} from '../../shared/automation-host-checked-triggers'
import type { BotConnectors } from '../../shared/bot-event-sources'
import {
  BITBUCKET_TRIGGER_OPTIONS,
  describeBitbucketTrigger,
  formatBitbucketTrigger,
  isBitbucketTriggerHead,
  parseBitbucketTrigger
} from '../bitbucket/bitbucket-event-trigger-spec'
import {
  describeGoogleTrigger,
  formatGoogleTrigger,
  GOOGLE_TRIGGER_OPTIONS,
  parseGoogleTrigger
} from '../google/google-event-trigger-spec'

type Entry = readonly [key: string, value: string, ...written: string[]]

export const HOST_CHECKED_SOURCES: readonly HostCheckedEventSource[] = [
  ...GOOGLE_EVENT_SOURCES,
  'bitbucket'
]

/** The rule `head` names, or null when a host checks no such event. */
export function parseHostCheckedTrigger(
  spec: string,
  head: string,
  entries: () => readonly Entry[]
): AutomationHostCheckedTrigger | null {
  if (head === 'gmail.new_email' || head === 'calendar.starting_soon') {
    return parseGoogleTrigger(spec, head, entries())
  }
  return isBitbucketTriggerHead(head) ? parseBitbucketTrigger(spec, head, entries()) : null
}

/** The rule as an --on value; parsing it gives the same rule back. */
export function formatHostCheckedTrigger(trigger: AutomationHostCheckedTrigger): string {
  return isBitbucketTrigger(trigger)
    ? formatBitbucketTrigger(trigger)
    : formatGoogleTrigger(trigger)
}

export function describeHostCheckedTrigger(trigger: AutomationHostCheckedTrigger): string {
  return isBitbucketTrigger(trigger)
    ? describeBitbucketTrigger(trigger)
    : describeGoogleTrigger(trigger)
}

/** The source's events and filters; `heard` are the sources that can start `bot`. */
export function hostCheckedTriggerOptions(
  source: HostCheckedEventSource,
  bot: BotConnectors | undefined,
  heard: readonly AutomationEventSource[] | undefined
): string {
  if (source === 'bitbucket') {
    return BITBUCKET_TRIGGER_OPTIONS
  }
  return bot && !heard?.includes(source)
    ? `${source}: none of these start ${bot.name}: Google is off for it. Its owner can turn it on with \`orca google bot "${bot.name}" --on\`.`
    : GOOGLE_TRIGGER_OPTIONS[source]
}
