import "$styles/global.css";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import type { AccountReplyV1, AccountV1 } from "$shared/ipc/bindings";
import { accountFixture as account, usageFixture } from "$shared/testing/account";
import AccountPage from "../components/sections/AccountPage.svelte";

const native = vi.hoisted(() => ({
  get: vi.fn(),
  send: vi.fn(),
  verify: vi.fn(),
  cancel: vi.fn(),
  buy: vi.fn(),
  signOut: vi.fn(),
  setName: vi.fn(),
  emailCode: vi.fn(),
  reauthCode: vi.fn(),
  changeEmail: vi.fn(),
  history: vi.fn(),
  receipt: vi.fn(),
  workCall: vi.fn(),
  settings: {} as Record<string, string>,
}));
vi.mock("$shared/ipc/bindings", async () => {
  const { mockBindings } = await import("$shared/testing/bindings");
  return mockBindings({
    chromeModal: async () => {},
    accountGet: native.get,
    accountSendCode: native.send,
    accountVerify: native.verify,
    accountCancelCode: native.cancel,
    accountBuy: native.buy,
    accountSignOut: native.signOut,
    accountSetName: native.setName,
    accountEmailCode: native.emailCode,
    accountReauthCode: native.reauthCode,
    accountChangeEmail: native.changeEmail,
    accountUsageHistory: native.history,
    accountReceipt: native.receipt,
    workCall: native.workCall,
    profilesGet: async () => ({ status: "ok" as const, data: null }),
    settingGet: async (key: string) => native.settings[key] ?? null,
  });
});

const reply = (value: AccountV1, fault: AccountReplyV1["fault"] = null): AccountReplyV1 => ({
  account: value,
  fault,
  retry_after: null,
});

const signedIn = account({
  signed_in: true,
  email: "ada@example.com",
  plan: "free",
  usage: usageFixture(),
  subscription: {
    status: "inactive",
    plan: null,
    interval: null,
    paid_until: null,
    cancel_at_period_end: false,
  },
  offers: [
    {
      kind: "plan",
      plan: "pro",
      interval: "monthly",
      name: "Zephium Pro",
      price: { amount_minor: 2000, currency: "usd" },
      features: [],
    },
  ],
});

test("signing in takes an address, then the emailed code, with no password", async () => {
  await page.viewport(1100, 1000);
  native.get.mockResolvedValue(reply(account()));
  const waiting = account({ pending_email: "ada@example.com", resend_in: 60 });
  native.send.mockResolvedValue(reply(waiting));
  native.verify
    .mockResolvedValueOnce(reply(waiting, "invalid_code"))
    .mockResolvedValueOnce(reply(signedIn));
  const screen = await render(AccountPage);

  await expect.element(screen.getByRole("heading", { name: "Sign in to Zephium" })).toBeVisible();
  const continueButton = screen.getByRole("button", { name: "Continue" });
  await expect.element(continueButton).toBeDisabled();
  await screen.getByLabelText("Email address").fill("ada@example.com");
  await continueButton.click();
  expect(native.send).toHaveBeenCalledWith("ada@example.com");

  await expect
    .element(screen.getByText("Enter the 6-digit code sent to ada@example.com."))
    .toBeVisible();
  await expect.element(screen.getByRole("button", { name: /New code in \d+s/u })).toBeDisabled();
  await screen.getByLabelText("Code").click();
  await userEvent.keyboard("111 111");
  expect(native.verify).toHaveBeenLastCalledWith("111111");
  await expect
    .element(screen.getByText("That code didn’t work. Check it, or send a new one."))
    .toBeVisible();

  await userEvent.keyboard("123456");
  expect(native.verify).toHaveBeenLastCalledWith("123456");
  await expect.element(screen.getByRole("heading", { name: "ada@example.com" })).toBeVisible();
});

test("hosted usage, history and purchases stay absent even when the account advertises them", async () => {
  await page.viewport(1100, 1200);
  native.get.mockResolvedValue(reply({ ...signedIn, hosted_models: true }));
  const screen = await render(AccountPage);
  await expect.element(screen.getByRole("heading", { name: "ada@example.com" })).toBeVisible();
  for (const name of ["Upgrade", "Buy credits", "Usage history"])
    expect(screen.getByRole("button", { name, exact: true }).elements()).toHaveLength(0);
  expect(screen.getByText("Zephium AI", { exact: true }).elements()).toHaveLength(0);
  expect(screen.getByRole("meter").elements()).toHaveLength(0);
  expect(native.history).not.toHaveBeenCalled();
  expect(native.buy).not.toHaveBeenCalled();
});
test("changing email asks for a fresh sign-in first, then signs in at the new address", async () => {
  await page.viewport(1100, 1200);
  native.get.mockResolvedValue(reply(signedIn));
  native.emailCode
    .mockResolvedValueOnce(reply(signedIn, "reauth_required"))
    .mockResolvedValueOnce(reply(signedIn));
  native.reauthCode.mockResolvedValue(reply({ ...signedIn, pending_email: "ada@example.com" }));
  native.verify.mockResolvedValue(reply(signedIn));
  const moved = account({ pending_email: "ada@new.example", resend_in: 60 });
  native.changeEmail.mockResolvedValue(reply(account()));
  native.send.mockResolvedValue(reply(moved));
  const screen = await render(AccountPage);

  await screen.getByRole("button", { name: "Change email…" }).click();
  await screen.getByLabelText("New email address").fill("ada@new.example");
  await screen.getByRole("button", { name: "Send code" }).click();
  expect(native.emailCode).toHaveBeenLastCalledWith("ada@new.example");
  await expect
    .element(screen.getByText("For your security, confirm it’s you first.", { exact: false }))
    .toBeVisible();

  await screen.getByRole("button", { name: "Email me a sign-in code" }).click();
  await screen.getByLabelText("Sign-in code").fill("123456");
  await screen.getByRole("button", { name: "Confirm" }).click();
  expect(native.verify).toHaveBeenLastCalledWith("123456");
  expect(native.emailCode).toHaveBeenCalledTimes(2);

  await screen.getByLabelText("Code from the email").fill("654321");
  await screen.getByRole("button", { name: "Change email", exact: true }).click();
  expect(native.changeEmail).toHaveBeenCalledWith("ada@new.example", "654321");
  expect(native.send).toHaveBeenLastCalledWith("ada@new.example");
  await expect
    .element(screen.getByText("Your email is now ada@new.example.", { exact: false }))
    .toBeVisible();
});

test("the name can be set and cleared", async () => {
  await page.viewport(1100, 1200);
  native.get.mockResolvedValue(reply(signedIn));
  native.setName.mockResolvedValue(reply({ ...signedIn, name: "Ada Lovelace" }));
  const screen = await render(AccountPage);
  await screen.getByRole("button", { name: "Edit name" }).click();
  await screen.getByLabelText("Name").fill("  Ada Lovelace ");
  await screen.getByRole("button", { name: "Save" }).click();
  expect(native.setName).toHaveBeenCalledWith("Ada Lovelace");
  await expect.element(screen.getByRole("heading", { name: "Ada Lovelace" })).toBeVisible();
});

test("signing out returns to the sign-in screen", async () => {
  await page.viewport(1100, 1200);
  native.get.mockResolvedValue(reply(signedIn));
  native.signOut.mockResolvedValue(reply(account()));
  const screen = await render(AccountPage);
  await screen.getByRole("button", { name: "Sign out", exact: true }).first().click();
  await expect.element(screen.getByLabelText("Email address")).toBeVisible();
});

test("an unreadable sign-in is said plainly, with a way to sign in again", async () => {
  await page.viewport(1100, 1200);
  native.get.mockResolvedValue(reply({ ...signedIn, vault_fault: true }));
  native.signOut.mockClear();
  native.signOut.mockResolvedValue(reply(account()));
  const screen = await render(AccountPage);
  await expect
    .element(
      screen.getByText(/can’t read your sign-in from (the Keychain|Windows Credential Manager)/u),
    )
    .toBeVisible();
  expect(native.signOut).not.toHaveBeenCalled();
  await screen.getByRole("button", { name: "Sign in again" }).click();
  expect(native.signOut).toHaveBeenCalledTimes(1);
  await expect.element(screen.getByLabelText("Email address")).toBeVisible();
});

test("a readable sign-in shows no Keychain warning", async () => {
  await page.viewport(1100, 1200);
  native.get.mockResolvedValue(reply(signedIn));
  const screen = await render(AccountPage);
  await expect
    .element(screen.getByRole("button", { name: "Sign out", exact: true }).first())
    .toBeVisible();
  expect(screen.getByText("can’t read your sign-in", { exact: false }).elements()).toHaveLength(0);
});
