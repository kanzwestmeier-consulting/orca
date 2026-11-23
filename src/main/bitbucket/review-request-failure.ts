import type { BitbucketReviewFailure } from '../../shared/bitbucket/bitbucket-pull-request-review'
import { HostedReviewApiRequestError } from '../source-control/hosted-review-api-request'

const MAX_ERROR_DETAIL_CHARS = 300
const UNCONFIRMED_WRITE = 'It may have been applied; check the pull request before retrying.'

function messageOf(value: unknown): string | null {
  return typeof value === 'object' &&
    value !== null &&
    'message' in value &&
    typeof value.message === 'string'
    ? value.message
    : null
}

// Bitbucket's own words help the caller; they are remote text, so keep them short.
// Cloud sends { error: { message } }, Data Center sends { errors: [{ message }] }.
function errorDetail(body: string): string {
  let message = ''
  try {
    const parsed: unknown = JSON.parse(body)
    if (typeof parsed === 'object' && parsed !== null) {
      const first =
        'errors' in parsed && Array.isArray(parsed.errors)
          ? parsed.errors[0]
          : 'error' in parsed
            ? parsed.error
            : null
      message = messageOf(first) ?? ''
    }
  } catch {
    // Not JSON: a proxy page or plain text.
    message = body.trimStart().startsWith('<') ? '' : body
  }
  return message.replace(/\s+/g, ' ').trim().slice(0, MAX_ERROR_DETAIL_CHARS)
}

export function bitbucketReviewFailure(
  code: BitbucketReviewFailure['code'],
  error: string,
  write = false,
  unconfirmed = false
): BitbucketReviewFailure {
  return { ok: false, code, error: write && unconfirmed ? `${error} ${UNCONFIRMED_WRITE}` : error }
}

export function bitbucketReviewFailureFor(error: unknown, write: boolean): BitbucketReviewFailure {
  if (!(error instanceof HostedReviewApiRequestError)) {
    const reason = error instanceof Error ? error.message : String(error)
    return bitbucketReviewFailure(
      'bitbucket_request_failed',
      `Could not reach Bitbucket: ${reason}.`,
      write,
      true
    )
  }
  if (error.timedOut) {
    return bitbucketReviewFailure(
      'bitbucket_timeout',
      'Bitbucket did not answer in time.',
      write,
      true
    )
  }
  const detail = errorDetail(error.message)
  const status = error.status ?? 0
  switch (status) {
    case 401:
      return bitbucketReviewFailure(
        'bitbucket_auth_rejected',
        'Bitbucket rejected the saved credential. Reconnect Bitbucket in Settings > Integrations.'
      )
    case 403:
      return bitbucketReviewFailure(
        'bitbucket_forbidden',
        `Bitbucket refused the request${detail ? `: ${detail}` : ''}. The credential may lack pull request ${write ? 'write' : 'read'} access.`
      )
    case 404:
      return bitbucketReviewFailure(
        'bitbucket_not_found',
        'Bitbucket found no such pull request or repository, or the credential cannot see it.'
      )
    case 429:
      return bitbucketReviewFailure(
        'bitbucket_rate_limited',
        'Bitbucket is rate limiting this credential. Wait before retrying.'
      )
    default:
      return bitbucketReviewFailure(
        'bitbucket_request_failed',
        `Bitbucket request failed (HTTP ${status || 'unknown'})${detail ? `: ${detail}` : ''}.`,
        write,
        status >= 500
      )
  }
}
