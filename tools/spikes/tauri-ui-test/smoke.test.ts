import { expect } from "@wdio/globals";

describe("gate: tauri-driver + webdriverio smoke", () => {
  it("clicks the greet button and sees a response", async () => {
    const input = await $("#greet-input");
    await input.setValue("gate-17");
    // create-tauri-app vanilla 템플릿의 Greet 버튼에는 id가 없다(플랜이 적은
    // `#greet-button`은 실제 생성물과 불일치) — form 안의 submit 버튼을 잡는다.
    const button = await $('#greet-form button[type="submit"]');
    await button.click();
    const msg = await $("#greet-msg");
    await expect(msg).toHaveTextContaining("gate-17");
  });
});
