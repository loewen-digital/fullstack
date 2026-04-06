<script lang="ts">
  import type { PageData } from './$types'

  let { data }: { data: PageData } = $props()
</script>

<svelte:head>
  <title>New Post</title>
</svelte:head>

<main>
  <h1>New Post</h1>

  <form method="POST">
    <label>
      Title
      <input type="text" name="title" value={data.oldInput?.title ?? ''} required />
    </label>

    <label>
      Excerpt <small>(optional — shown on the homepage)</small>
      <textarea name="excerpt" rows="2">{data.oldInput?.excerpt ?? ''}</textarea>
    </label>

    <label>
      Content
      <textarea name="content" rows="16" required>{data.oldInput?.content ?? ''}</textarea>
    </label>

    <div class="actions">
      <button type="submit" name="publish" value="true">Publish</button>
      <button type="submit" class="secondary">Save Draft</button>
    </div>
  </form>
</main>

<style>
  main { max-width: 48rem; margin: 2rem auto; padding: 0 1rem; }
  form { display: flex; flex-direction: column; gap: 1rem; }
  label { display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.9rem; }
  input, textarea { padding: 0.5rem; border: 1px solid #ccc; border-radius: 4px; font: inherit; }
  .actions { display: flex; gap: 0.75rem; }
  button { padding: 0.5rem 1rem; background: #2563eb; color: white; border: none; border-radius: 4px; cursor: pointer; }
  button.secondary { background: #6b7280; }
</style>
