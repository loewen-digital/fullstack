<script lang="ts">
  import type { PageData } from './$types'

  let { data }: { data: PageData } = $props()
</script>

<svelte:head>
  <title>{data.post.title}</title>
</svelte:head>

<main>
  <article>
    <header>
      <h1>{data.post.title}</h1>
      <p class="meta">
        By {data.post.authorName}
        {#if data.post.publishedAt}
          · {data.post.publishedAt.toLocaleDateString()}
        {/if}
      </p>
    </header>

    <div class="content">
      {data.post.content}
    </div>
  </article>

  <a href="/">← All posts</a>
</main>

<style>
  main { max-width: 48rem; margin: 2rem auto; padding: 0 1rem; }
  .meta { color: #6b7280; font-size: 0.9rem; }
  .content { margin-top: 2rem; line-height: 1.7; white-space: pre-wrap; }
</style>
