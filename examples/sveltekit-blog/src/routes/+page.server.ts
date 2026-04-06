import { desc, isNotNull } from 'drizzle-orm'
import type { PageServerLoad } from './$types'
import { stack, schema } from '$lib/server/stack'

export const load: PageServerLoad = async () => {
  const allPosts = await stack.db.drizzle
    .select({
      id: schema.posts.id,
      title: schema.posts.title,
      slug: schema.posts.slug,
      excerpt: schema.posts.excerpt,
      publishedAt: schema.posts.publishedAt,
    })
    .from(schema.posts)
    .where(isNotNull(schema.posts.publishedAt))
    .orderBy(desc(schema.posts.publishedAt))
    .all()

  return { posts: allPosts }
}
