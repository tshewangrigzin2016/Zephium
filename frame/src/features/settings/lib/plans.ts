import { planName, priceLabel } from "$domain/account";
import type { AccountOfferV1, AccountPriceV1 } from "$shared/ipc/bindings";
import * as m from "$shared/i18n/messages";

export type PlanOffer = Extract<AccountOfferV1, { kind: "plan" }>;
/** What each plan includes when the server sends no list of its own; it mirrors the pricing page. */
function plainFeatures(plan: string): string[] {
  switch (plan) {
    case "free":
      return [
        m.account_plan_feature_free_1(),
        m.account_plan_feature_free_2(),
        m.account_plan_feature_free_3(),
        m.account_plan_feature_free_4(),
      ];
    case "pro":
      return [
        m.account_plan_feature_pro_1(),
        m.account_plan_feature_pro_2(),
        m.account_plan_feature_pro_3(),
      ];
    case "max":
      return [
        m.account_plan_feature_max_1(),
        m.account_plan_feature_max_2(),
        m.account_plan_feature_max_3(),
      ];
    default:
      return [];
  }
}

/** Each plan once, in the server's order. */
const planIds = (plans: readonly PlanOffer[]) => [...new Set(plans.map((p) => p.plan))];

/**
 * Yearly is called "2 months free" only where the numbers say so: every plan
 * sold both ways costs exactly ten months when paid yearly.
 */
export function yearlySavesTwoMonths(plans: readonly PlanOffer[]): boolean {
  const pairs = planIds(plans).flatMap((id) => {
    const monthly = plans.find((p) => p.plan === id && p.interval === "monthly")?.price;
    const yearly = plans.find((p) => p.plan === id && p.interval === "yearly")?.price;
    return monthly && yearly ? [[monthly, yearly] as const] : [];
  });
  return (
    pairs.length > 0 &&
    pairs.every(
      ([monthly, yearly]) =>
        monthly.currency === yearly.currency &&
        monthly.amount_minor > 0 &&
        yearly.amount_minor === monthly.amount_minor * 10,
    )
  );
}

type PlanAction = "current" | "upgrade" | "switch" | "none";

export type PlanCard = {
  id: string;
  name: string;
  price: string | null;
  /** "per month" / "per year", or null for Free. */
  per: string | null;
  features: string[];
  action: PlanAction;
  /** Cheaper than the plan held: it waits for renewal rather than charging now. */
  downgrade: boolean;
  /** The offer a purchase buys; none for Free. */
  offer: PlanOffer | null;
};

export type PlanContext = {
  plans: readonly PlanOffer[];
  /** The plan that decides model access (`usage.plan`). */
  currentPlan: string | null;
  /** The plan an active subscription is for; it, not the access plan, marks the held card. */
  subscribed?: string | null;
  paid: boolean;
  interval: string;
  /** Under billing review nothing new is bought; only a downgrade is let through. */
  review: boolean;
};

const offerAt = (plans: readonly PlanOffer[], id: string, interval: string) =>
  plans.find((plan) => plan.plan === id && plan.interval === interval) ??
  plans.find((plan) => plan.plan === id);

/** Free as the baseline, then every plan the server sells. */
export function planCards({
  plans,
  currentPlan,
  subscribed,
  paid,
  interval,
  review,
}: PlanContext): PlanCard[] {
  const current = (paid && subscribed) || (currentPlan ?? "free");
  const currency = plans.find((plan) => plan.price)?.price?.currency;
  const nothing: AccountPriceV1 | null = currency ? { amount_minor: 0, currency } : null;
  const nowPrice = current === "free" ? 0 : offerAt(plans, current, interval)?.price?.amount_minor;

  const free: PlanCard = {
    id: "free",
    name: m.account_plan_free(),
    price: priceLabel(nothing) ?? m.account_plan_free(),
    per: null,
    features: plainFeatures("free"),
    action: current === "free" ? "current" : "none",
    downgrade: false,
    offer: null,
  };

  const paidCards = planIds(plans).map((id): PlanCard => {
    const offer = offerAt(plans, id, interval)!;
    const price = priceLabel(offer.price);
    const target = offer.price?.amount_minor;
    const downgrade = target !== undefined && nowPrice !== undefined && target < nowPrice;
    let action: PlanAction = "none";
    if (id === current) action = "current";
    else if (!review || (paid && downgrade)) action = paid ? "switch" : "upgrade";
    return {
      id,
      name: planName(id) ?? offer.name ?? id,
      price,
      per: price
        ? offer.interval === "yearly"
          ? m.account_plans_per_year()
          : m.account_plans_per_month()
        : null,
      features: offer.features.length > 0 ? offer.features : plainFeatures(id),
      action,
      downgrade,
      offer,
    };
  });
  return [free, ...paidCards];
}

/** Whether there is anything to do in the plans dialog. */
export const canChangePlan = (cards: readonly PlanCard[]) =>
  cards.some((card) => card.action === "upgrade" || card.action === "switch");
