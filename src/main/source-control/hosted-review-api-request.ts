export class HostedReviewApiRequestError extends Error {
  readonly status: number | null
  readonly timedOut: boolean

  constructor(message: string, options: { status?: number | null; timedOut?: boolean } = {}) {
    super(message)
    this.name = 'HostedReviewApiRequestError'
    this.status = options.status ?? null
    this.timedOut = options.timedOut ?? false
  }
}

async function readResponseText(response: Response): Promise<string> {
  try {
    return await response.text()
  } catch {
    return ''
  }
}

async function requestHostedReview<T>(
  url: URL,
  init: Omit<RequestInit, 'signal'>,
  timeoutMs: number,
  read: (response: Response) => Promise<T>
): Promise<T> {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
    if (!response.ok) {
      const body = await readResponseText(response)
      throw new HostedReviewApiRequestError(body || response.statusText, {
        status: response.status
      })
    }
    return await read(response)
  } catch (error) {
    if (error instanceof HostedReviewApiRequestError) {
      throw error
    }
    // AbortSignal.timeout() rejects with a TimeoutError, not an AbortError.
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new HostedReviewApiRequestError('Request timed out', { timedOut: true })
    }
    throw error
  }
}

export function requestHostedReviewJson<T>(
  url: URL,
  init: Omit<RequestInit, 'signal'>,
  timeoutMs: number
): Promise<T> {
  return requestHostedReview(url, init, timeoutMs, async (response) => (await response.json()) as T)
}

export type HostedReviewTextReply = { text: string; truncated: boolean }

// A diff can be far larger than a reply may carry, so stop reading at the cap.
async function readBoundedText(
  response: Response,
  maxChars: number
): Promise<HostedReviewTextReply> {
  const reader = response.body?.getReader()
  if (!reader) {
    return { text: '', truncated: false }
  }
  const decoder = new TextDecoder()
  let text = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) {
      return { text: text + decoder.decode(), truncated: false }
    }
    text += decoder.decode(value, { stream: true })
    if (text.length > maxChars) {
      await reader.cancel().catch(() => undefined)
      return { text: text.slice(0, maxChars), truncated: true }
    }
  }
}

export function requestHostedReviewText(
  url: URL,
  init: Omit<RequestInit, 'signal'>,
  timeoutMs: number,
  maxChars: number
): Promise<HostedReviewTextReply> {
  return requestHostedReview(url, init, timeoutMs, (response) =>
    readBoundedText(response, maxChars)
  )
}
