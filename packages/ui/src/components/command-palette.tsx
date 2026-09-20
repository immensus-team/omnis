import { Command } from "cmdk";
import { ChevronDown, Paperclip } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  ASK_MODELS,
  type AskModelId,
  askModelLabel,
  readAskModel,
  writeAskModel,
} from "../lib/ask-model.js";
import { AskPanel } from "./ask-panel.js";
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
  /** "dialog"(기본) = 기존 ⌘K 모달. "inline" = U1 kinso ask/search pill바 — US-D01부터 이 바가
   *  아래로 플로팅 AI 패널로 펼쳐진다(AskPanel). 팔레트를 두 번 만들지 않는다. */
  mode?: "dialog" | "inline";
  placeholder?: string;
  /** US-D01: 선택된 스레드가 있을 때만 "이 대화 요약"이 살아난다(App.tsx의 `open`). */
  threadSelected?: boolean;
  /** US-D01: threads.meta.summary — 없으면 패널이 "아직 요약 없음"을 보여준다. */
  threadSummary?: string | null;
}

/** A5 §2.3: kbar 패턴({id,name,shortcut,perform}) 액션을 group으로 묶어 GlassSurface(slot="palette")에 렌더링. */
export function CommandPalette({
  open,
  onOpenChange,
  actions,
  mode = "dialog",
  placeholder,
  threadSelected = false,
  threadSummary = null,
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
      <InlinePalette
        open={open}
        onOpenChange={onOpenChange}
        placeholder={placeholder ?? "Start typing to ask or search"}
        commands={resultList}
        threadSelected={threadSelected}
        threadSummary={threadSummary}
      />
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
 *  Escape/바깥 클릭 닫기를 직접 붙인다.
 *
 *  US-D01 구조: 하나의 Command 루트가 바 입력과 패널 안 명령 목록을 함께 소유한다. 그래야
 *  "바에 타이핑 → 명령 목록이 걸러진다"가 그대로 유지된다(입력을 패널로 옮기면 cmdk 검색
 *  상태가 둘로 갈라져 조용히 깨진다). */
function InlinePalette({
  open,
  onOpenChange,
  placeholder,
  commands,
  threadSelected,
  threadSummary,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  placeholder: string;
  commands: ReactNode;
  threadSelected: boolean;
  threadSummary: string | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // @ 칩이 필요로 하는 값. cmdk Input은 value를 안 주면 스스로 store에 쓰면서 onValueChange로
  // 알려준다 — 그래서 검색 상태를 우리가 제어하지 않고도 값만 받아볼 수 있다.
  const [query, setQuery] = useState("");
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
      <GlassSurface slot="toolbar" className="ask-bar__pill">
        <span className="ask-bar__orb" aria-hidden="true" />
        <Command.Input
          placeholder={placeholder}
          onFocus={() => onOpenChange(true)}
          onValueChange={(value) => {
            setQuery(value);
            onOpenChange(true);
          }}
        />
        {/* 펼친 상태에서만 붙는 컴포저 어포던스. 닫힌 바는 kinso 그대로(오브 + 플레이스홀더)다. */}
        {open && (
          <>
            {query.includes("@") && <span className="ask-bar__chip">@ 멘션</span>}
            {/* 실을 업로드 경로가 없다 — 비활성 + title="Phase B"(스토리 폴백). */}
            <button
              type="button"
              className="ask-bar__attach"
              aria-label="파일 첨부"
              title="Phase B"
              disabled
            >
              <Paperclip size={15} aria-hidden="true" />
            </button>
            <ModelPicker />
          </>
        )}
      </GlassSurface>
      {open && (
        <AskPanel
          commands={commands}
          threadSelected={threadSelected}
          summary={threadSummary}
          onClose={() => onOpenChange(false)}
        />
      )}
    </Command>
  );
}

/** US-D01 모델 선택기. 설정 HTTP 라우트가 없어 localStorage에만 남긴다(lib/ask-model.ts).
 *  메뉴는 일부러 불투명하다 — 유리 위에 유리를 겹치면(apple-design §12) 글자가 죽는다.
 *  레퍼런스(ref-glass-mail-ai-panel.webp)의 모델 드롭다운도 패널보다 확실히 불투명하다. */
function ModelPicker() {
  const [model, setModel] = useState<AskModelId>(readAskModel);
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="ask-bar__model">
      <button
        type="button"
        className="ask-bar__model-toggle"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((v) => !v)}
      >
        {askModelLabel(model)}
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {menuOpen && (
        // biome-ignore lint/a11y/useSemanticElements: popover menu, not a form fieldset.
        <div className="ask-bar__model-menu" role="group" aria-label="모델">
          {ASK_MODELS.map((m) => (
            <button
              key={m.id}
              type="button"
              aria-pressed={m.id === model}
              onClick={() => {
                setModel(m.id);
                writeAskModel(m.id);
                setMenuOpen(false);
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
