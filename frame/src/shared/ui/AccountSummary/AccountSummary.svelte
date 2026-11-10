<script lang="ts">
  /**
   * The account identity shared by the New Tab page and the profile menu.
   * Content only; the place that shows it decides whether it is a button.
   */
  let {
    email,
    initials,
    avatar = null,
    plan = null,
  }: {
    email: string | null;
    initials: string;
    /** The account's own picture, in place of its initials. */
    avatar?: string | null;
    plan?: string | null;
  } = $props();

  let broken = $state<string | null>(null);
  const photo = $derived(avatar && avatar !== broken ? avatar : null);
</script>

<span class="account-summary">
  <span class="disc" aria-hidden="true"
    >{#if photo}<img
        src={photo}
        alt=""
        draggable="false"
        onerror={() => (broken = photo)}
      />{:else}{initials}{/if}</span
  >
  <span class="who">
    <span class="email">{email}</span>
    {#if plan}<span class="plan">{plan}</span>{/if}
  </span>
</span>

<style>
  .account-summary {
    display: grid;
    grid-template-columns: 32px minmax(0, 1fr);
    align-items: center;
    gap: 12px 10px;
    min-inline-size: 0;
    text-align: start;
  }

  /* Initials on the menu's own plate rather than a colour: the profiles
     carry the colour, and the account is the same in every one of them. */
  .disc {
    display: grid;
    inline-size: 32px;
    block-size: 32px;
    border-radius: var(--radius-capsule);
    background: var(--color-fill-active);
    box-shadow: var(--shine-top);
    color: var(--color-text);
    font-size: var(--text-label);
    font-weight: 600;
    letter-spacing: 0.03em;
    place-items: center;
  }

  .disc:has(img) {
    overflow: hidden;
    box-shadow: inset 0 0 0 0.5px var(--avatar-rim);
  }

  .disc img {
    inline-size: 100%;
    block-size: 100%;
    object-fit: cover;
    animation: interface-fade var(--motion-base) var(--ease-out);
  }

  .who {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    min-inline-size: 0;
  }

  .email {
    max-inline-size: 100%;
    overflow: hidden;
    color: var(--color-text);
    font-size: var(--text-body);
    font-weight: 550;
    letter-spacing: -0.005em;
    line-height: 16px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .plan {
    padding-inline: 6px;
    border-radius: var(--radius-capsule);
    background: var(--color-fill);
    box-shadow: var(--row-rim);
    color: var(--color-muted);
    font-size: var(--text-caption);
    font-weight: 550;
    letter-spacing: 0.02em;
    line-height: 16px;
  }

  @media (prefers-reduced-motion: reduce) {
    .disc img {
      animation: none;
    }
  }
</style>
