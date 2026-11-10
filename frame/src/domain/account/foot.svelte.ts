import * as accountSession from "./account.svelte";
import { avatarUrl, initials, planName } from "./account-model";
import { drawn, profiles } from "$domain/profiles";

/**
 * What the account surfaces show: the profile's picture for a foot's trigger,
 * and the account (the same in every profile) wherever it is summed up. One
 * reading of both, so the places that show it cannot drift. Call it during
 * component initialisation.
 */
export function accountFoot(options: { private?: () => boolean } = {}) {
  const account = $derived(accountSession.account());
  const signedIn = $derived(account?.signed_in === true);
  /** Only the picture the profile chose; the account never stands in for it. */
  const face = $derived.by((): ReturnType<typeof drawn> | null => {
    if (options.private?.()) return null;
    const current = profiles.current();
    return current && current.avatar.revision > 0 ? drawn(current) : null;
  });
  return {
    /** The account service answers here, and this is not a private window. */
    get available() {
      return account?.available === true && !options.private?.();
    },
    get signedIn() {
      return signedIn;
    },
    get email() {
      return account?.email ?? null;
    },
    get initials() {
      return signedIn ? initials(account?.email, account?.name) : "";
    },
    /** The account's own picture, shown where its initials would be. */
    get avatar() {
      return signedIn ? avatarUrl(account?.avatar) : null;
    },
    get plan() {
      return signedIn ? planName(account?.plan) : null;
    },
    get face() {
      return face;
    },
  };
}
