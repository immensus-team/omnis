import * as Popover from "@radix-ui/react-popover";
import { Command } from "cmdk";
import { useState } from "react";

/** US-D02: 리스트 위에 얹는 필터 칩 바(ref-issue-tracker-density.webp의 "Priority is any of 2
 *  priorities ×" 문법). 칩 텍스트는 호출자가 완성된 문장으로 만들어 넘긴다 — 이 컴포넌트는
 *  "채널이냐 라벨이냐"를 모른다(Inbox 말고도 Tasks·Needs-approval이 같은 바를 쓴다). */

export interface FilterChipOption {
  id: string;
  label: string;
}

export interface FilterChip {
  id: string;
  /** 칩의 접근성 이름에 쓰는 필드명(예: "Label"). 화면에는 안 그린다 — text 안에 이미 들어 있다. */
  fieldLabel: string;
  /** 완성된 칩 문구(예: `Channel is Slack`). 만드는 건 호출자 몫이다. */
  text: string;
  onRemove: () => void;
}

export interface FilterChipBarProps {
  chips: FilterChip[];
  /** 이 바가 새 칩을 만들 수 있는 필드. 없으면 "+" 트리거 자체를 안 그린다(추가할 게 없다). */
  addOptions?: {
    fieldLabel: string;
    options: FilterChipOption[];
    selectedIds: string[];
    onToggle: (id: string) => void;
  };
}

export function FilterChipBar({ chips, addOptions }: FilterChipBarProps) {
  return (
    // 레퍼런스의 칩은 한 덩어리 라벨 + 별도 × 하나다 — 안쪽을 3조각으로 쪼개지 않는다.
    <div className="filter-chip-bar">
      {chips.map((chip) => (
        <span key={chip.id} className="filter-chip">
          {chip.text}
          <button
            type="button"
            // 브리프 문구는 "필터 제거" 하나였지만, 칩이 둘 이상이면 접근성 이름이 같아져
            // 스크린리더가 어느 ×인지 구분할 수 없다 — 필드명을 앞에 붙인다.
            aria-label={`${chip.fieldLabel} 필터 제거`}
            onClick={chip.onRemove}
          >
            ×
          </button>
        </span>
      ))}
      {addOptions && <AddFilterPopover {...addOptions} />}
    </div>
  );
}

/** 칩 편집 팝오버. Radix Popover가 위치를 잡고 cmdk가 목록·검색을 맡는다 — 이 저장소의
 *  검색 리스트 문법은 이미 cmdk 하나뿐이라(CommandPalette) 두 번째 패턴을 만들지 않는다.
 *  스타일은 Popover.Content에 glass-surface를 그대로 입힌다: 떠 있는 패널은 유리다
 *  (DESIGN-DIRECTION.md "Liquid Glass는 …플로팅 패널에만"). */
function AddFilterPopover({
  fieldLabel,
  options,
  selectedIds,
  onToggle,
}: NonNullable<FilterChipBarProps["addOptions"]>) {
  const [open, setOpen] = useState(false);
  const selected = new Set(selectedIds);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" className="filter-chip-bar__add">
          + {fieldLabel}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="glass-surface filter-chip-popover"
          data-glass-slot="palette"
          side="bottom"
          align="start"
          sideOffset={6}
        >
          <Command label={`${fieldLabel} 필터`}>
            <Command.Input placeholder="Filter…" autoFocus />
            <Command.List>
              <Command.Empty>결과가 없어요</Command.Empty>
              {options.map((option) => (
                <Command.Item
                  key={option.id}
                  // 다중 선택: 골라도 팝오버를 닫지 않는다(레퍼런스의 체크박스 목록은 클릭을
                  // 거듭해도 열려 있다). 여기서 open을 건드리는 코드가 없는 게 곧 그 동작이다.
                  onSelect={() => onToggle(option.id)}
                  data-checked={selected.has(option.id) ? "true" : undefined}
                >
                  <span className="filter-chip-popover__check" aria-hidden="true">
                    {selected.has(option.id) ? "✓" : ""}
                  </span>
                  <span>{option.label}</span>
                </Command.Item>
              ))}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
