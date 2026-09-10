/**
 * The adapter against SvelteKit's real types (`@sveltejs/kit` is a devDependency only).
 * `npm run typecheck` covers this file: the assignments below fail to compile when the
 * adapter's structural mirror of `RequestEvent` and `Handle` drifts from SvelteKit.
 */
import { describe, it, expect } from 'vitest'
import type { Handle, RequestEvent } from '@sveltejs/kit'
import { sequence } from '@sveltejs/kit/hooks'
import { createHandle, setAuthCookie, clearAuthCookie } from '../index.js'
import { createSession } from '../../../session/index.js'

// An app's App.Locals: an interface without an index signature, unrelated to FullstackLocals.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace App {
    interface Locals {
      requestId: string
    }
  }
}

function makeKitEvent(): RequestEvent {
  const cookies = new Map<string, string>()
  const event = {
    request: new Request('http://localhost/'),
    url: new URL('http://localhost/'),
    locals: { requestId: 'r1' },
    route: { id: null },
    cookies: {
      get: (name: string) => cookies.get(name),
      set: (name: string, value: string) => { cookies.set(name, value) },
      delete: (name: string) => { cookies.delete(name) },
    },
  }
  // The runtime fake carries only what the adapter reads; the type is SvelteKit's.
  return event as unknown as RequestEvent
}

describe('SvelteKit types', () => {
  const stack = { session: createSession({ driver: 'memory' }) }

  it('createHandle is a Handle, alone and inside sequence()', async () => {
    const handle: Handle = createHandle(stack)
    const other: Handle = ({ event, resolve }) => resolve(event)
    // Composing is a type check; the composed handle only runs inside SvelteKit's request store.
    const composed: Handle = sequence(createHandle(stack), other)
    expect(typeof composed).toBe('function')

    const event = makeKitEvent()
    const resolve = async () => new Response('ok')

    expect((await handle({ event, resolve })).status).toBe(200)
    expect(event.locals.requestId).toBe('r1')
    expect(event.cookies.get('fsid')).toBeDefined()
  })

  it('setAuthCookie and clearAuthCookie take a RequestEvent', () => {
    const event = makeKitEvent()
    setAuthCookie(event, 'token')
    expect(event.cookies.get('fs_token')).toBe('token')
    clearAuthCookie(event)
    expect(event.cookies.get('fs_token')).toBeUndefined()
  })
})
