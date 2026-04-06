<script lang="ts">
  import type { PageData } from './$types'

  let { data }: { data: PageData } = $props()
</script>

<svelte:head>
  <title>Blog</title>
</svelte:head>

<main>
  <h1>Latest Posts</h1>

  {#if data.posts.length === 0}
    <p>No posts yet. <a href="/posts/new">Write the first one!</a></p>
  {:else}
    <ul class="posts">
      {#each data.posts as post}
        <li>
          <a href="/posts/{post.slug}">
            <h2>{post.title}</h2>
          </a>
          {#if post.excerpt}
            <p>{post.excerpt}</p>
          {/if}
          <small>{post.publishedAt?.toLocaleDateString()}</small>
        </li>
      {/each}
    </ul>
  {/if}
</main>

<style>
  main { max-width: 48rem; margin: 2rem auto; padding: 0 1rem; }
  .posts { list-style: none; padding: 0; }
  .posts li { margin-bottom: 2rem; padding-bottom: 2rem; border-bottom: 1px solid #eee; }
  h2 { margin: 0 0 0.5rem; }
</style>
