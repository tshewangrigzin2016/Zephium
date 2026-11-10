import "$styles/global.css";
import { beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import { accountFixture } from "$shared/testing/account";
import AccountPage from "../components/sections/AccountPage.svelte";

const native = vi.hoisted(() => ({ get: vi.fn(), manage: vi.fn(), buy: vi.fn() }));
vi.mock("$shared/ipc/bindings", async () => {
  const { mockBindings } = await import("$shared/testing/bindings");
  return mockBindings({
    accountGet: native.get,
    accountRefresh: native.get,
    accountManage: native.manage,
    accountBuy: native.buy,
    profilesGet: async () => ({ status: "ok" as const, data: null }),
    settingGet: async () => null,
  });
});

beforeEach(() => vi.clearAllMocks());

test("existing subscribers can manage their subscription without AI purchase prompts", async () => {
  await page.viewport(1100, 1000);
  const account = accountFixture({
    signed_in: true,
    email: "ada@example.com",
    subscription: {
      status: "active",
      plan: "pro",
      interval: "monthly",
      paid_until: "2026-11-19T00:00:00Z",
      cancel_at_period_end: false,
    },
  });
  const reply = { account, fault: null, retry_after: null };
  native.get.mockResolvedValue(reply);
  native.manage.mockResolvedValue(reply);
  const screen = await render(AccountPage);
  await screen.getByRole("button", { name: "Manage subscription" }).click();
  expect(native.manage).toHaveBeenCalledOnce();
  expect(native.buy).not.toHaveBeenCalled();
  for (const name of ["Upgrade", "Buy credits", "Change plan"])
    expect(screen.getByRole("button", { name, exact: true }).elements()).toHaveLength(0);
});
