// Worker liveness — PURE unit tests (no DB): the detector's verdict logic, alert
// formatting, and the independent-channel email request builder. These cover the
// parts that are easy to get subtly wrong: idle must NOT alarm, and the signal is
// age-of-runnable-work, not absence-of-success.
import { describe, it, expect } from 'vitest'
import {
  evaluateLiveness,
  formatAlert,
  buildAlertEmailRequest,
  formatDuration,
  failureDecision,
  DEFAULT_LIVENESS_THRESHOLDS,
  type LivenessRow,
} from '@exsto/worker-runtime'

const idle: LivenessRow = {
  runnable_pending: 0,
  oldest_pending_age_sec: null,
  running_total: 0,
  oldest_running_age_sec: null,
}

describe('evaluateLiveness', () => {
  it('an IDLE queue is healthy — no runnable work, no false alarm', () => {
    const v = evaluateLiveness(idle)
    expect(v.healthy).toBe(true)
    expect(v.reasons).toEqual([])
  })

  it('runnable jobs aging past the pending threshold is unhealthy (worker not draining)', () => {
    const v = evaluateLiveness({ ...idle, runnable_pending: 3, oldest_pending_age_sec: 700 })
    expect(v.healthy).toBe(false)
    expect(v.reasons.join(' ')).toMatch(/not draining/)
  })

  it('a runnable job UNDER the pending threshold is still healthy (a busy worker is fine)', () => {
    const v = evaluateLiveness({ ...idle, runnable_pending: 1, oldest_pending_age_sec: 500 })
    expect(v.healthy).toBe(true)
  })

  it('a job stuck in running past the running threshold is unhealthy (died mid-job)', () => {
    const v = evaluateLiveness({ ...idle, running_total: 1, oldest_running_age_sec: 2000 })
    expect(v.healthy).toBe(false)
    expect(v.reasons.join(' ')).toMatch(/died mid-job/)
  })

  it('a job running UNDER the running threshold is healthy (long jobs are allowed)', () => {
    const v = evaluateLiveness({ ...idle, running_total: 1, oldest_running_age_sec: 300 })
    expect(v.healthy).toBe(true)
  })

  it('reports both failure modes at once', () => {
    const v = evaluateLiveness({
      runnable_pending: 5,
      oldest_pending_age_sec: 900,
      running_total: 2,
      oldest_running_age_sec: 4000,
    })
    expect(v.healthy).toBe(false)
    expect(v.reasons).toHaveLength(2)
  })

  it('respects custom thresholds', () => {
    const v = evaluateLiveness(
      { ...idle, runnable_pending: 1, oldest_pending_age_sec: 120 },
      { pendingAgeThresholdSec: 60, runningAgeThresholdSec: 120 },
    )
    expect(v.healthy).toBe(false)
  })

  it('exactly AT the threshold is not yet unhealthy (strict >)', () => {
    const v = evaluateLiveness({
      ...idle,
      runnable_pending: 1,
      oldest_pending_age_sec: DEFAULT_LIVENESS_THRESHOLDS.pendingAgeThresholdSec,
    })
    expect(v.healthy).toBe(true)
  })
})

describe('formatAlert', () => {
  it('includes the reasons and the queue snapshot', () => {
    const v = evaluateLiveness({ ...idle, runnable_pending: 4, oldest_pending_age_sec: 3700 })
    const { subject, text } = formatAlert(v)
    expect(subject).toMatch(/Worker liveness alert/)
    expect(text).toMatch(/not draining/)
    expect(text).toMatch(/runnable pending jobs: 4/)
    expect(text).toMatch(/exsto-law-worker/)
  })
})

describe('buildAlertEmailRequest — independent alert channel', () => {
  const message = { subject: 'S', text: 'T' }

  it('returns null when unconfigured (caller degrades to log-only)', () => {
    expect(buildAlertEmailRequest({}, message)).toBeNull()
    expect(
      buildAlertEmailRequest({ ALERT_EMAIL_API_KEY: 'k', ALERT_EMAIL_FROM: 'f@x.co' }, message),
    ).toBeNull() // missing TO
  })

  it('builds a Resend-shaped POST with bearer auth and comma-split recipients', () => {
    const req = buildAlertEmailRequest(
      {
        ALERT_EMAIL_API_KEY: 'key123',
        ALERT_EMAIL_FROM: 'alerts@exsto.law',
        ALERT_EMAIL_TO: 'joe@x.co, ops@x.co',
      },
      { subject: 'Subj', text: 'Body' },
    )
    expect(req).not.toBeNull()
    expect(req!.url).toBe('https://api.resend.com/emails')
    expect(req!.headers.Authorization).toBe('Bearer key123')
    const body = JSON.parse(req!.body)
    expect(body.from).toBe('alerts@exsto.law')
    expect(body.to).toEqual(['joe@x.co', 'ops@x.co'])
    expect(body.subject).toBe('Subj')
    expect(body.text).toBe('Body')
  })

  it('honors an endpoint override for a non-Resend provider', () => {
    const req = buildAlertEmailRequest(
      {
        ALERT_EMAIL_API_KEY: 'k',
        ALERT_EMAIL_FROM: 'f@x.co',
        ALERT_EMAIL_TO: 't@x.co',
        ALERT_EMAIL_ENDPOINT: 'https://api.other.example/send',
      },
      message,
    )
    expect(req!.url).toBe('https://api.other.example/send')
  })
})

describe('failureDecision', () => {
  it('retries while attempts remain, dead-letters once spent', () => {
    expect(failureDecision(1, 5)).toBe('retry')
    expect(failureDecision(4, 5)).toBe('retry')
    expect(failureDecision(5, 5)).toBe('dead_letter')
    expect(failureDecision(6, 5)).toBe('dead_letter')
  })
})

describe('formatDuration', () => {
  it('renders compact human durations', () => {
    expect(formatDuration(45)).toBe('45s')
    expect(formatDuration(600)).toBe('10m')
    expect(formatDuration(3600)).toBe('1h')
    expect(formatDuration(5400)).toBe('1h 30m')
  })
})
