<script lang="ts">
  import { accountSession as session, shortDate } from "$domain/account";
  import { ArrowUpRight01Icon } from "@hugeicons/core-free-icons";
  import * as m from "$shared/i18n/messages";
  import Button from "$shared/ui/Button";
  import Icon from "$shared/ui/Icon";
  import SettingsRow from "$shared/ui/SettingsRow";
  import { explainAccountFault } from "../../lib/account";

  const account = $derived(session.account());
  const busy = $derived(session.pending());
  const subscription = $derived(account?.subscription ?? null);
  const active = $derived(subscription?.status === "active" || subscription?.status === "unknown");
  const detail = $derived.by(() => {
    if (subscription?.status === "unknown") return m.account_plan_unknown();
    const date = shortDate(subscription?.paid_until);
    if (!date) return m.account_plan_active();
    return subscription?.cancel_at_period_end
      ? m.account_plan_ends({ date })
      : m.account_plan_renews({ date });
  });
  const fault = $derived(session.fault());
  const manageFault = $derived(
    fault?.action === "manage" ? explainAccountFault(fault.fault, fault.retryAfter) : null,
  );
</script>

{#if active}
  <SettingsRow title={m.account_plan_group()} description={detail}>
    <Button
      size="compact"
      variant="ghost"
      pending={busy === "manage"}
      disabled={!!busy && busy !== "manage"}
      onclick={() => void session.manage()}
      >{m.account_billing_manage()}<Icon icon={ArrowUpRight01Icon} size={13} /></Button
    >
  </SettingsRow>
  {#if manageFault}<p class="note" role="alert">{manageFault}</p>{/if}
{/if}

<style>
  .note {
    margin: 0 18px 24px;
    color: var(--color-danger);
    font-size: var(--text-label);
    line-height: 1.5;
  }
</style>
