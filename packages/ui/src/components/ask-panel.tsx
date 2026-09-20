import { ListChecks, PenLine, Sparkles, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { cn } from "../lib/cn.js";
import { GlassSurface } from "./glass-surface.js";

/** US-D01: ask 바가 펼쳐진 플로팅 유리 패널. 레퍼런스 ref-glass-mail-ai-panel.webp의
 *  제안 액션 3종(Draft a reply / Summarize / Extract) + 모델 선택기를 omnis 말로 옮긴 것.
 *
 *  컴포저(입력 + @ 칩 + 첨부 + 모델)는 패널이 아니라 위쪽 ask 바 행에 있다 — 바 자체가
 *  이미 입력이고, 패널에 두 번째 입력을 두면 cmdk 검색 상태가 둘로 갈라진다(그 순간
 *  "타이핑이 명령 목록을 거른다"가 조용히 깨진다). 그래서 "펼쳐진 바" = 바 행 + 아래 패널. */
export interface AskPanelProps {
  /** "명령" 탭 내용(cmcd 목록). 소유권은 CommandPalette에 남는다 — 팔레트를 두 번 만들지 않는다. */
  commands: ReactNode;
  /** App.tsx의 `open`(선택된 스레드). null이면 요약할 대상이 없다. */
  threadSelected: boolean;
  /** threads.meta.summary. 아직 요약이 없으면 null → "아직 요약 없음". */
  summary: string | null;
  onClose: () => void;
}

export function AskPanel({ commands, threadSelected, summary, onClose }: AskPanelProps) {
  // 기본은 "제안"이다 — 열자마자 할 수 있는 일을 보여주고, 명령 목록은 한 탭 뒤에 둔다.
  const [tab, setTab] = useState<"suggest" | "commands">("suggest");
  const [summaryShown, setSummaryShown] = useState(false);

  return (
    // biome-ignore lint/a11y/useSemanticElements: GlassSurface is the shared glass wrapper (rail/toolbar/sheet/palette all use it) — a native <dialog> would need its own backdrop/blur styling duplicated here.
    <GlassSurface slot="palette" className="ask-panel" role="dialog" aria-label="AI 패널">
      <div className="ask-panel__head">
        {/* biome-ignore lint/a11y/useSemanticElements: tab-like toggle, not a form fieldset. */}
        <div className="ask-panel__tabs" role="group" aria-label="패널 보기">
          <button type="button" aria-pressed={tab === "suggest"} onClick={() => setTab("suggest")}>
            제안
          </button>
          <button
            type="button"
            aria-pressed={tab === "commands"}
            onClick={() => setTab("commands")}
          >
            명령
          </button>
        </div>
        <button type="button" className="ask-panel__close" aria-label="닫기" onClick={onClose}>
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      {tab === "commands" ? (
        commands
      ) : (
        <div className="ask-panel__actions">
          {/* US-D01 폴백: 초안/할 일 추출은 붙일 라우트가 없다 — 비활성 + title="Phase B".
              누를 수 있는 척하는 것보다 못 누른다고 말하는 게 정직하다. */}
          <button type="button" className="ask-panel__action" disabled title="Phase B">
            <PenLine size={15} aria-hidden="true" />
            답장 초안 작성
          </button>
          {/* 이 대화 요약만 실제로 배선되어 있다 — threads.meta.summary(T1 요약 루프가 채운다). */}
          <button
            type="button"
            className="ask-panel__action"
            disabled={!threadSelected}
            {...(threadSelected ? {} : { title: "스레드를 선택하세요" })}
            onClick={() => setSummaryShown(true)}
          >
            <Sparkles size={15} aria-hidden="true" />이 대화 요약
          </button>
          <button type="button" className="ask-panel__action" disabled title="Phase B">
            <ListChecks size={15} aria-hidden="true" />할 일 추출
          </button>
          {summaryShown && (
            <p
              className={cn("ask-panel__summary", summary === null && "ask-panel__summary--empty")}
            >
              {summary ?? "아직 요약 없음"}
            </p>
          )}
        </div>
      )}
    </GlassSurface>
  );
}
