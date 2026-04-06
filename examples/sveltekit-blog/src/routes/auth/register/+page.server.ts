import { fail, redirect } from '@sveltejs/kit'
import { eq } from 'drizzle-orm'
import type { Actions, PageServerLoad } from './$types'
import { stack, schema } from '$lib/server/stack'
import { validateForm, setAuthCookie } from '@loewen-digital/fullstack/adapters/sveltekit'

export const load: PageServerLoad = async ({ locals }) => {
  // Redirect already-authenticated users
  if (locals.user) redirect(302, '/')
}

export const actions: Actions = {
  default: async (event) => {
    const { request, locals } = event

    const result = await validateForm(request, locals.session, {
      name: 'required|string|max:100',
      email: 'required|email|max:255',
      password: 'required|string|min:8',
      password_confirmation: 'required|confirmed:password',
    })

    if (!result.ok) {
      return fail(422, { errors: result.errors })
    }

    const { name, email, password } = result.data as { name: string; email: string; password: string }

    // Check for duplicate email
    const existing = await stack.db.drizzle
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .get()

    if (existing) {
      return fail(422, { errors: ['That email is already registered.'] })
    }

    // Create the user
    const passwordHash = await stack.auth.hashPassword(password)
    const userId = crypto.randomUUID()

    await stack.db.drizzle.insert(schema.users).values({
      id: userId,
      email,
      name,
      passwordHash,
      createdAt: new Date(),
    })

    const user = { id: userId, email }

    // Send welcome email (via console driver in dev)
    await stack.mail.send({
      to: email,
      subject: 'Welcome to the Blog!',
      html: `<p>Hi ${name}, thanks for joining! Your account is ready.</p>`,
    })

    // Create a session and set the auth cookie
    const session = await stack.auth.createSession(user)
    setAuthCookie(event, session.token)

    locals.session?.flash('_flash', 'Account created — welcome!')
    redirect(302, '/')
  },
}
