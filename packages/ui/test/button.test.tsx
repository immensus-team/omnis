// @vitest-environment jsdom
// 루트 `pnpm test`(vitest.workspace.ts)는 packages/ui/vitest.config.ts를 읽지 않는다.
// 환경과 셋업(jest-dom matchers + afterEach(cleanup))을 파일 자체가 선언한다.
import "./setup";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "../src/components/button";

describe("Button (shadcn primitive)", () => {
  it("renders children and fires onClick", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>승인</Button>);
    fireEvent.click(screen.getByRole("button", { name: "승인" }));
    expect(onClick).toHaveBeenCalledOnce();
  });
  it("default variant is not pill-radius (A5 §9 pill 남용 금지)", () => {
    render(<Button>보내기</Button>);
    expect(screen.getByRole("button")).not.toHaveClass("rounded-full");
  });
});
