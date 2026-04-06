import { fail, redirect } from '@sveltejs/kit'
import { eq } from 'drizzle-orm'
import type { Actions, PageServerLoad } from './$types'
import { stack, schema } from '$lib/server/stack'
import { validateForm, setAuthCookie } from '@loewen-digital/fullstack/adapters/sveltekit'

export const load: PageServerLoad = async ({ locals }) => {
  if (locals.user) redirect(302, '/')
}

export const actions: Actions = {
  default: async (event) => {
    const { request, locals } = event

    const result = await validateForm(request, locals.session, {
      email: 'required|email',
      password: 'required|string',
    })

    if (!result.ok) {
      return fail(422, { errors: result.errors })
    }

    const { email, password } = result.data as { email: string; password: string }

    // auth is schema-agnostic; query the user directly from your own schema
    const row = await stack.db.drizzle
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .get()

    if (!row || !row.passwordHash) {
      return fail(401, { errors: ['Invalid email or password.'] })
    }

    const valid = await stack.auth.verifyPassword(password, row.passwordHash)
    if (!valid) {
      return fail(401, { errors: ['Invalid email or password.'] })
    }

    const session = await stack.auth.createSession({ id: row.id, email: row.email })
    setAuthCookie(event, session.token)

    locals.session?.flash('_flash', 'Welcome back!')
    redirect(302, '/')
  },
}
