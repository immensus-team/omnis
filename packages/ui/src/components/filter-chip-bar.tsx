import * as Popover from "@radix-ui/react-popover";
import { Command } from "cmdk";
import { useState } from "react";
import { LuSearch } from "react-icons/lu";

/** US-D02: 리스트 위에 얹는 필터 칩 바(ref-issue-tracker-density.webp의 필터 DSL 칩).
 *  칩은 필드 칸과 값 칸으로 갈린다 — 문장을 통째로 받지 않는다. 무엇을 거는지(채널/라벨)는
 *  여전히 호출자가 정한다: Inbox 말고도 Tasks·Needs-approval이 같은 바를 쓴다. */

export interface FilterChipOption {
  id: string;
  label: string;
}

export interface FilterChip {
  id: string;
  /** 왼쪽(옅은) 칸 = 무엇을 거는가. 칩 ×의 접근성 이름도 여기서 나온다. 예: "라벨". */
  field: string;
  /** 오른쪽(틴트) 칸 = 무엇으로 거는가. 조사·수량사까지 포함한 완성 어구. 예: "2개 중 하나". */
  value: string;
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
    // 레퍼런스의 칩은 `[▣ Priority][is any of][2 priorities][×]` — 칸마다 채움이 번갈아 들고
    // 가운데 연산자 칸만 옅다. 한국어는 조사가 명사에 붙어("라벨은", "2개 중 하나") 연산자를
    // 따로 떼면 문장이 깨지므로 칸을 셋이 아니라 둘로 나눈다. 번갈이 채움은 그대로 가져와
    // 필드 칸을 옅게, 값 칸을 틴트로 둔다 — 칩이 한 덩어리 태그로 뭉개지지 않는 게 핵심이다.
    <div className="filter-chip-bar">
      {chips.map((chip) => (
        <span key={chip.id} className="filter-chip">
          <span className="filter-chip__field">{chip.field}</span>
          <span className="filter-chip__value">{chip.value}</span>
          <button
            type="button"
            // 브리프 문구는 "필터 제거" 하나였지만, 칩이 둘 이상이면 접근성 이름이 같아져
            // 스크린리더가 어느 ×인지 구분할 수 없다 — 필드명을 앞에 붙인다.
            aria-label={`${chip.field} 필터 제거`}
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
            {/* 레퍼런스의 필터 팝오버와 같은 입력 크롬: 돋보기 + 아래 헤어라인 한 줄.
                맨몸 placeholder는 목록 위에 뜬 회색 글자일 뿐 입력칸으로 안 읽힌다. */}
            <div className="filter-chip-popover__search">
              <LuSearch aria-hidden="true" />
              <Command.Input placeholder={`${fieldLabel} 검색`} autoFocus />
            </div>
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
