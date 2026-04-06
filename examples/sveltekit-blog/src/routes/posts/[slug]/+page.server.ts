import { error } from '@sveltejs/kit'
import { eq } from 'drizzle-orm'
import type { PageServerLoad } from './$types'
import { stack, schema } from '$lib/server/stack'

export const load: PageServerLoad = async ({ params }) => {
  const post = await stack.db.drizzle
    .select({
      id: schema.posts.id,
      title: schema.posts.title,
      content: schema.posts.content,
      publishedAt: schema.posts.publishedAt,
      authorName: schema.users.name,
    })
    .from(schema.posts)
    .innerJoin(schema.users, eq(schema.posts.authorId, schema.users.id))
    .where(eq(schema.posts.slug, params.slug))
    .get()

  if (!post) error(404, 'Post not found')

  return { post }
}
