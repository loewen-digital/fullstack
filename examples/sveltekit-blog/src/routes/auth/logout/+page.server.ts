import { redirect } from '@sveltejs/kit'
import type { Actions } from './$types'
import { stack } from '$lib/server/stack'
import { clearAuthCookie } from '@loewen-digital/fullstack/adapters/sveltekit'

export const actions: Actions = {
  default: async (event) => {
    const { locals } = event

    // Destroy the server-side session
    if (locals.authSession) {
      await stack.auth.destroySession(locals.authSession.token)
    }

    clearAuthCookie(event)
    locals.session?.flash('_flash', 'You have been logged out.')
    redirect(302, '/')
  },
}
