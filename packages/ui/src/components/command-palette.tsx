import { Command } from "cmdk";
import { type ReactNode, useEffect, useRef } from "react";
import { GlassSurface } from "./glass-surface.js";

export interface PaletteAction {
  id: string;
  name: string;
  shortcut?: string;
  group: string;
  perform: () => void;
}

export function groupBy<T>(items: T[], key: (t: T) => string): Record<string, T[]> {
  return items.reduce<Record<string, T[]>>((acc, item) => {
    const k = key(item);
    if (!acc[k]) acc[k] = [];
    acc[k].push(item);
    return acc;
  }, {});
}

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: PaletteAction[];
  /** "dialog"(기본) = 기존 ⌘K 모달. "inline" = U1 kinso ask/search pill바 —
   *  Command.Dialog(고정 오버레이) 대신 같은 Command를 문서 흐름 안에 그대로 놓고,
   *  입력에 포커스/타이핑이 들어오면 목록만 펼친다. 팔레트를 두 번 만들지 않는다. */
  mode?: "dialog" | "inline";
  placeholder?: string;
}

/** A5 §2.3: kbar 패턴({id,name,shortcut,perform}) 액션을 group으로 묶어 GlassSurface(slot="palette")에 렌더링. */
export function CommandPalette({
  open,
  onOpenChange,
  actions,
  mode = "dialog",
  placeholder,
}: CommandPaletteProps) {
  const groups = groupBy(actions, (a) => a.group);
  const resultList = (
    <Command.List>
      <Command.Empty>결과가 없어요</Command.Empty>
      {Object.entries(groups).map(([group, items]) => (
        <Command.Group key={group} heading={group}>
          {items.map((action) => (
            <Command.Item
              key={action.id}
              onSelect={() => {
                action.perform();
                onOpenChange(false);
              }}
            >
              <span>{action.name}</span>
              {action.shortcut && <kbd>{action.shortcut}</kbd>}
            </Command.Item>
          ))}
        </Command.Group>
      ))}
    </Command.List>
  );

  if (mode === "inline") {
    return (
      <InlinePalette open={open} onOpenChange={onOpenChange}>
        <GlassSurface slot="toolbar" className="ask-bar__pill">
          <span className="ask-bar__orb" aria-hidden="true" />
          <Command.Input
            placeholder={placeholder ?? "Start typing to ask or search"}
            onFocus={() => onOpenChange(true)}
            onValueChange={() => onOpenChange(true)}
          />
        </GlassSurface>
        {open && (
          <GlassSurface slot="palette" className="ask-bar__dropdown">
            {resultList}
          </GlassSurface>
        )}
      </InlinePalette>
    );
  }

  return (
    <Command.Dialog open={open} onOpenChange={onOpenChange} label="omnis command palette">
      <GlassSurface slot="palette">
        <Command.Input placeholder={placeholder ?? "검색 또는 명령…"} />
        {resultList}
      </GlassSurface>
    </Command.Dialog>
  );
}

/** 인라인 모드는 Command.Dialog가 아니라 문서 흐름 안의 Command다 — 모달이 공짜로 주던
 *  Escape/바깥 클릭 닫기가 없어서, 한 번 열리면 액션을 고를 때까지 드롭다운이 Inbox를 덮는다. */
function InlinePalette({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!ref.current?.contains(e.target as Node)) onOpenChange(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, onOpenChange]);

  return (
    <Command
      ref={ref}
      className="ask-bar"
      label="omnis ask/search"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onOpenChange(false);
        }
      }}
    >
      {children}
    </Command>
  );
}
