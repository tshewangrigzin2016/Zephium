import { afterEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import "$styles/global.css";
import { loadNewTab } from "$features/newtab";
import { loadNewTabSearch } from "$features/search";
import type { AccountV1 } from "$shared/ipc/bindings";
import { accountFixture, portraitFixture, usageFixture } from "$shared/testing/account";
import NewTabLook from "./NewTabLook.svelte";

const native = vi.hoisted(() => ({
  account: null as unknown as AccountV1,
  kind: "default" as "default" | "incognito",
}));
vi.mock("$shared/ipc/bindings", async () => {
  const { mockBindings } = await import("$shared/testing/bindings");
  return mockBindings({
    accountGet: async () => ({ account: native.account, fault: null, retry_after: null }),
    settingGet: async () => null,
    newtabSearchContext: async () => ({
      window_id: "window",
      profile_id: "00000000000000000000000501",
      space_id: "space",
      session_id: "newtab:tab:1",
      request_id: "",
    }),
    newtabSearch: async () => true,
    newtabCancel: async () => true,
    newtabRun: async () => ({ accepted: true, operation_id: null }),
    blockerStats: async () => ({ status: "error" as const, error: null }),
    timeCall: async () => ({ kind: "focus_days" as const, days: [] }),
    resourceCall: async () => {
      throw new Error("no tasks here");
    },
  });
});
// Rust serves the account picture by revision; a picture stands in for it here.
vi.mock("$domain/account/account-model", async (original) => ({
  ...(await original<typeof import("$domain/account/account-model")>()),
  avatarUrl: (revision: number | null | undefined) => (revision ? portraitFixture : null),
}));
vi.mock("$domain/tabs", () => ({
  tabs: {
    profile: () => ({ id: "00000000000000000000000501", name: "Ada", kind: native.kind }),
  },
}));

await Promise.all([loadNewTab(), loadNewTabSearch()]);

const onaccount = vi.fn();
const shots = "../../../../../target/look/newtab-account";
const settled = () =>
  Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => null)));

const signedIn = (email: string, used: number, offers = false) =>
  accountFixture({
    signed_in: true,
    email,
    plan: "pro",
    usage: usageFixture({ used_percent: used }),
    offers: offers
      ? [
          {
            kind: "top_up",
            id: "pack",
            name: null,
            units: "5000000",
            price: null,
            expires_days: null,
          },
        ]
      : [],
  });

afterEach(() => {
  native.kind = "default";
  delete document.documentElement.dataset.theme;
});

async function stage(account: AccountV1) {
  native.account = account;
  onaccount.mockClear();
  await page.viewport(860, 560);
  const screen = await render(NewTabLook, { onaccount });
  screen.container.style.cssText = "inline-size:820px;block-size:520px;padding:6px";
  await new Promise((done) => setTimeout(done, 300));
  return screen;
}

async function shoot(screen: Awaited<ReturnType<typeof stage>>, name: string) {
  for (const theme of ["dark", "light"]) {
    document.documentElement.dataset.theme = theme;
    screen.container.style.background = "var(--color-canvas)";
    await settled();
    await page
      .elementLocator(screen.container)
      .screenshot({ path: `${shots}/${name}-${theme}.png` });
  }
  document.documentElement.dataset.theme = "dark";
}

test("signed out, the corner offers a calm way in", async () => {
  const screen = await stage(accountFixture());
  const button = screen.getByRole("button", { name: "Sign in", exact: true });
  await expect.element(button).toBeVisible();
  // Its disc is a capsule as wide as the words it holds, beside the page's settings.
  expect(screen.container.querySelectorAll(".control")).toHaveLength(2);
  const words = button.element().getBoundingClientRect();
  const gear = screen.getByRole("button", { name: "Customize New Tab" }).element();
  expect(words.right).toBeLessThan(gear.getBoundingClientRect().left);
  await shoot(screen, "out");
  await button.click();
  expect(onaccount).toHaveBeenCalledWith("account");
});

test("signed in, the initials open the account, and the panel keeps the keyboard", async () => {
  const screen = await stage(signedIn("ada@example.com", 42, true));
  const avatar = screen.getByRole("button", { name: "Account", exact: true });
  await expect.element(avatar).toHaveTextContent("A");
  expect(screen.container.querySelector(".usage-ring")).toBeNull();
  await shoot(screen, "in");

  await avatar.click();
  expect(page.getByRole("menuitem", { name: "Buy credits" }).query()).toBeNull();
  expect(page.getByRole("meter", { name: "Included usage used" }).query()).toBeNull();
  expect(page.getByText("42% used").query()).toBeNull();
  await shoot(screen, "open");
  await expect.element(page.getByRole("menuitem", { name: "Manage account" })).toHaveFocus();
  await userEvent.keyboard("{Tab}");
  await expect.element(page.getByRole("menuitem", { name: "Manage account" })).toHaveFocus();
  await userEvent.keyboard("{Escape}");
  await expect.element(avatar).toHaveFocus();
  await avatar.click();
  await page.getByRole("menuitem", { name: "Manage account" }).click();
  expect(onaccount).toHaveBeenLastCalledWith("account");
});

test("with a photo, the corner and the panel show the account's own picture", async () => {
  const screen = await stage({ ...signedIn("ada@example.com", 42, true), avatar: 3 });
  const avatar = screen.getByRole("button", { name: "Account", exact: true });
  await expect.element(avatar).toBeVisible();
  expect(avatar.element().querySelector("img")?.getAttribute("src")).toBe(portraitFixture);
  await shoot(screen, "photo");
  await avatar.click();
  expect(page.getByText("42% used").query()).toBeNull();
  const summary = document.querySelector(".ntp-account-panel .account-summary img");
  expect(summary?.getAttribute("src")).toBe(portraitFixture);
  await shoot(screen, "photo-open");
});

test("old usage and credits never appear in the new tab account menu", async () => {
  const screen = await stage(signedIn("ada@example.com", 100, true));
  expect(screen.container.querySelector(".usage-ring")).toBeNull();
  await screen.getByRole("button", { name: "Account", exact: true }).click();
  expect(page.getByRole("meter", { name: "Included usage used" }).query()).toBeNull();
  expect(page.getByText("100% used").query()).toBeNull();
  expect(page.getByRole("menuitem", { name: "Buy credits" }).query()).toBeNull();
});
test("a long address is cut short, never the panel widened", async () => {
  const screen = await stage(signedIn("ada.lovelace@analytical-engine.example", 42, true));
  await screen.getByRole("button", { name: "Account", exact: true }).click();
  const panel = document.querySelector<HTMLElement>(".ntp-account-panel")!;
  await expect.poll(() => panel.inert).toBe(false);
  expect(panel.offsetWidth).toBe(272);
  await shoot(screen, "long-open");
});

test("a private window and an install without the service show no account", async () => {
  native.kind = "incognito";
  let screen = await stage(signedIn("ada@example.com", 42));
  expect(screen.container.querySelectorAll(".control")).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Account", exact: true }).query()).toBeNull();
  await screen.unmount();

  native.kind = "default";
  screen = await stage(accountFixture({ available: false }));
  expect(screen.getByRole("button", { name: "Sign in", exact: true }).query()).toBeNull();
  expect(screen.container.querySelectorAll(".control")).toHaveLength(1);
});
