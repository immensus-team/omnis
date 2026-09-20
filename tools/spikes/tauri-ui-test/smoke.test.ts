import { expect } from "@wdio/globals";

describe("gate: tauri-driver + webdriverio smoke", () => {
  it("clicks the greet button and sees a response", async () => {
    const input = await $("#greet-input");
    await input.setValue("gate-17");
    // The Greet button in the create-tauri-app vanilla template has no id (the plan's
    // `#greet-button` does not match the actual generated output) — target the submit
    // button inside the form.
    const button = await $('#greet-form button[type="submit"]');
    await button.click();
    const msg = await $("#greet-msg");
    await expect(msg).toHaveTextContaining("gate-17");
  });
});
