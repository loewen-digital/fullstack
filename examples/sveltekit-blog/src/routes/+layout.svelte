<script lang="ts">
  import type { LayoutData } from './$types'

  let { data, children }: { data: LayoutData; children: any } = $props()
</script>

<nav>
  <a href="/">Blog</a>
  {#if data.user}
    <a href="/posts/new">New Post</a>
    <form method="POST" action="/auth/logout" style="display:inline">
      <button type="submit">Log out ({data.user.email})</button>
    </form>
  {:else}
    <a href="/auth/login">Log in</a>
    <a href="/auth/register">Register</a>
  {/if}
</nav>

{#if data.flash}
  <div class="flash flash--success">{data.flash}</div>
{/if}

{#if data.errors && data.errors.length > 0}
  <div class="flash flash--error">
    <ul>
      {#each data.errors as error}
        <li>{error}</li>
      {/each}
    </ul>
  </div>
{/if}

{@render children()}

<style>
  nav { padding: 1rem; border-bottom: 1px solid #eee; display: flex; gap: 1rem; align-items: center; }
  .flash { padding: 0.75rem 1rem; margin: 1rem; border-radius: 4px; }
  .flash--success { background: #d1fae5; color: #065f46; }
  .flash--error { background: #fee2e2; color: #991b1b; }
</style>
