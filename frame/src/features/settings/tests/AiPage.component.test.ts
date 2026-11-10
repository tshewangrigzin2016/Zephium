import "$styles/global.css";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { page, userEvent } from "vitest/browser";
import type { WorkLocalServerV1, WorkMoreModelsV1_Serialize } from "$shared/ipc/bindings";
import { PROFILE, models } from "$shared/testing/work-models";
import { emitNativeEvent } from "$shared/testing/native-events";
import AiPage from "../components/sections/AiPage.svelte";

vi.mock("$domain/tabs", () => ({
  tabs: { profile: () => ({ id: "00000000000000000000000001", kind: "regular" }) },
}));
const native = vi.hoisted(() => ({
  read: vi.fn(),
  set: vi.fn(),
  test: vi.fn(),
  choose: vi.fn(),
  account: vi.fn(),
  local: vi.fn(async () => [] as WorkLocalServerV1[]),
  endpoint: vi.fn(),
  more: vi.fn(async (): Promise<WorkMoreModelsV1_Serialize> => ({
    provider: "compatible",
    entries: [],
    fault: null,
  })),
}));
vi.mock("$shared/ipc/bindings", async () => {
  const { mockBindings } = await import("$shared/testing/bindings");
  return mockBindings({
    workModels: native.read,
    workSetProviderKey: native.set,
    workTestProviderKey: native.test,
    workChooseModel: native.choose,
    accountGet: native.account,
    workLocalServers: native.local,
    workSetModelEndpoint: native.endpoint,
    workMoreModels: native.more,
    voiceStatus: async () => ({
      version: 1,
      engines: ["on_device", "open_ai"],
      chosen: null,
      effective: "on_device",
      language: null,
      languages: ["en-US"],
      on_device: "en_US",
      microphone: "granted",
    }),
    workDecisionPreference: async () => ({
      version: 1,
      profile: PROFILE,
      choice: "recommended",
      effective: "standard",
      typesafe_key_present: false,
      error: null,
    }),
  });
});

test("a refused key is explained and acceptance makes no billing promise", async () => {
  await page.viewport(1100, 1200);
  native.read.mockResolvedValue(models({ keys: { open_ai: "set" }, lead: "openai/gpt-6-sol" }));
  native.set
    .mockResolvedValueOnce({ ...models({ keys: { open_ai: "set" } }), fault: "key_refused" })
    .mockResolvedValueOnce(models({ keys: { open_ai: "set", anthropic: "valid" } }));
  const screen = await render(AiPage);

  await screen.getByRole("button", { name: "Add key" }).first().click();
  await userEvent.keyboard("sk-ant-wrong");
  await screen.getByRole("button", { name: "Save" }).click();
  expect(native.set).toHaveBeenCalledWith(PROFILE, "anthropic", "sk-ant-wrong");
  await expect.element(screen.getByText("Anthropic didn’t accept this key.")).toBeVisible();

  await screen.getByLabelText("Anthropic API key").fill("sk-ant-right");
  await screen.getByRole("button", { name: "Save" }).click();
  await expect.element(screen.getByText("Key accepted")).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Save" })).not.toBeInTheDocument();
});

test("testing a stored key reports what the provider said", async () => {
  await page.viewport(1100, 1200);
  native.read.mockResolvedValue(models({ keys: { open_ai: "set" } }));
  native.test.mockResolvedValue({ ...models({ keys: { open_ai: "set" } }), fault: "unreachable" });
  const screen = await render(AiPage);
  await screen.getByRole("button", { name: "Test" }).click();
  expect(native.test).toHaveBeenCalledWith(PROFILE, "open_ai");
  await expect
    .element(screen.getByText("Couldn’t reach OpenAI. Check your connection and try again."))
    .toBeVisible();
});

test("a role follows Automatic until the person chooses a model", async () => {
  await page.viewport(1100, 1200);
  native.read.mockResolvedValue(
    models({ keys: { anthropic: "valid" }, lead: "anthropic/claude-opus-5-5" }),
  );
  native.choose.mockResolvedValue(
    models({
      keys: { anthropic: "valid" },
      lead: "anthropic/claude-sonnet-5-5",
      chosen: "anthropic/claude-sonnet-5-5",
    }),
  );
  const screen = await render(AiPage);
  await expect.element(screen.getByText("Automatic · Claude Opus 5.5")).toBeVisible();
  await screen.getByText("Automatic · Claude Opus 5.5").click();
  await page.getByRole("option", { name: /Claude Sonnet 5.5/ }).click();
  expect(native.choose).toHaveBeenCalledWith(PROFILE, "lead", "anthropic/claude-sonnet-5-5");
});

test("a refused model change restores the stored choice and reports the failure", async () => {
  await page.viewport(1100, 1200);
  const view = models({ keys: { anthropic: "valid" }, lead: "anthropic/claude-opus-5-5" });
  native.read.mockResolvedValue(view);
  native.choose.mockReset().mockResolvedValue({ ...view, fault: "request" });
  const screen = await render(AiPage);
  const control = screen.getByLabelText("Work", { exact: true });
  await control.click();
  await page.getByRole("option", { name: /Claude Sonnet 5.5/u }).click();
  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent("The model couldn’t be changed");
  await expect.element(control).toHaveTextContent("Automatic · Claude Opus 5.5");
});

test("billing trouble preserves acceptance and the old Cloud group stays gone", async () => {
  await page.viewport(1100, 1200);
  const view = models({ keys: { open_ai: "valid" }, cloud: true });
  view.providers = view.providers.map((provider) =>
    provider.provider === "open_ai" ? { ...provider, fault: "billing" } : provider,
  );
  native.read.mockResolvedValue(view);
  const screen = await render(AiPage);
  await expect.element(screen.getByText("Key accepted")).toBeVisible();
  await expect
    .element(
      screen.getByText("Check your provider’s billing or available credits, then try again."),
    )
    .toBeVisible();
  await expect.element(screen.getByText("Zephium Cloud", { exact: true })).not.toBeInTheDocument();
});

test("Settings AI exposes Jev setup beside the regular model controls with honest fallback", async () => {
  await page.viewport(1100, 1200);
  native.read.mockResolvedValue(models({ keys: { open_ai: "set" }, lead: "openai/gpt-6-sol" }));
  const screen = await render(AiPage);
  await expect.element(screen.getByRole("button", { name: "Add Jev key" })).toBeVisible();
  await expect.element(screen.getByRole("radio", { name: "Recommended" })).toBeChecked();
  await expect.element(screen.getByText("Active: Standard")).toBeVisible();
  await expect.element(screen.getByRole("heading", { name: "Work", exact: true })).toBeVisible();
});

test("hosted AI is absent while provider keys and local models remain available", async () => {
  await page.viewport(1100, 1200);
  native.read.mockResolvedValue(models({ cloud: true }));
  const screen = await render(AiPage);
  await expect
    .element(screen.getByText("Add a provider key or connect a local model", { exact: false }))
    .toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Add key" }).first()).toBeVisible();
  expect(screen.getByText("Zephium AI", { exact: true }).elements()).toHaveLength(0);
  expect(screen.getByRole("button", { name: "Sign in…" }).elements()).toHaveLength(0);
  expect(native.account).not.toHaveBeenCalled();
});
test("a model server already running here is one click away", async () => {
  await page.viewport(1100, 1400);
  native.read.mockResolvedValue(models({}));
  native.local.mockResolvedValue([
    { kind: "ollama", base: "http://localhost:11434/v1", models: 3 },
  ]);
  native.endpoint.mockResolvedValue(models({ base: "http://localhost:11434/v1" }));
  const screen = await render(AiPage);
  await screen.getByRole("button", { name: "Use Ollama on this computer" }).click();
  expect(native.endpoint).toHaveBeenCalledWith(PROFILE, "http://localhost:11434/v1");
  await expect
    .element(screen.getByText("Set OLLAMA_CONTEXT_LENGTH", { exact: false }))
    .toBeVisible();
});

test("a custom server is asked for its models once per address, even when it has none", async () => {
  await page.viewport(1100, 1200);
  native.more.mockReset();
  native.read.mockResolvedValue(models({ base: "http://localhost:11434/v1" }));
  for (const answer of [
    { provider: "compatible", entries: [], fault: null },
    { provider: "compatible", entries: [], fault: "unreachable" },
  ] satisfies WorkMoreModelsV1_Serialize[]) {
    native.more.mockReset();
    native.more.mockResolvedValue(answer);
    const screen = await render(AiPage);
    await expect.element(screen.getByText("http://localhost:11434/v1")).toBeVisible();
    await new Promise((settle) => setTimeout(settle, 400));
    expect(native.more).toHaveBeenCalledTimes(1);
    emitNativeEvent("workModelsChanged", { version: 1 });
    await new Promise((settle) => setTimeout(settle, 200));
    expect(native.more).toHaveBeenCalledTimes(1);
    screen.unmount();
  }
  native.more.mockReset();
  native.more.mockResolvedValue({ provider: "compatible", entries: [], fault: null });
  const screen = await render(AiPage);
  await expect.poll(() => native.more.mock.calls.length).toBe(1);
  native.read.mockResolvedValue(models({ base: "http://localhost:1234/v1" }));
  emitNativeEvent("workModelsChanged", { version: 1 });
  await expect.poll(() => native.more.mock.calls.length).toBe(2);
  screen.unmount();
});
