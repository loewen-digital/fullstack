import { createHandle } from '@loewen-digital/fullstack/adapters/sveltekit'
import { stack } from '$lib/server/stack'

// Wire the fullstack handle into SvelteKit's middleware chain.
// Per request, it will:
//  - load/save the session
//  - validate the auth token cookie → event.locals.user
//  - enforce CSRF on non-GET requests
export const handle = createHandle(stack)
