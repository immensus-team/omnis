import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
