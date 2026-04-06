import { fail, redirect } from '@sveltejs/kit'
import type { Actions, PageServerLoad } from './$types'
import { stack, schema } from '$lib/server/stack'
import { validateForm } from '@loewen-digital/fullstack/adapters/sveltekit'

export const load: PageServerLoad = async ({ locals }) => {
  // Require authentication
  if (!locals.user) redirect(302, '/auth/login')
}

export const actions: Actions = {
  default: async ({ request, locals }) => {
    if (!locals.user) redirect(302, '/auth/login')

    const result = await validateForm(request, locals.session, {
      title: 'required|string|max:255',
      content: 'required|string',
      excerpt: 'optional|string|max:500',
      publish: 'optional|boolean',
    })

    if (!result.ok) {
      return fail(422, { errors: result.errors })
    }

    const { title, content, excerpt, publish } = result.data as {
      title: string
      content: string
      excerpt?: string
      publish?: boolean
    }

    // Generate a URL slug from the title
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')

    const postId = crypto.randomUUID()

    await stack.db.drizzle.insert(schema.posts).values({
      id: postId,
      title,
      slug,
      content,
      excerpt: excerpt ?? content.slice(0, 200),
      authorId: String(locals.user.id),
      publishedAt: publish ? new Date() : null,
      createdAt: new Date(),
    })

    locals.session?.flash('_flash', publish ? 'Post published!' : 'Draft saved.')
    redirect(302, publish ? `/posts/${slug}` : '/')
  },
}
