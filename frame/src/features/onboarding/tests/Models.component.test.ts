import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import Models from "../components/steps/Models.svelte";

const native = vi.hoisted(() => ({ account: vi.fn(), local: vi.fn(async () => []) }));
vi.mock("$shared/ipc/bindings", async () => {
  const { mockBindings } = await import("$shared/testing/bindings");
  return mockBindings({ accountGet: native.account, workLocalServers: native.local });
});

test("onboarding offers provider keys and local models without hosted AI", async () => {
  const screen = await render(Models, { onsubmit: vi.fn() });
  await expect.element(screen.getByRole("radio", { name: /Your own key/u })).toBeVisible();
  await expect.element(screen.getByRole("radio", { name: /A local model/u })).toBeVisible();
  expect(screen.getByRole("radio").elements()).toHaveLength(2);
  expect(screen.getByText("Zephium AI", { exact: true }).elements()).toHaveLength(0);
  expect(native.account).not.toHaveBeenCalled();
});
