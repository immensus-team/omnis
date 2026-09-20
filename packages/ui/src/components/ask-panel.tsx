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
  /** "명령" 탭 내용(cmdk 목록). 소유권은 CommandPalette에 남는다 — 팔레트를 두 번 만들지 않는다. */
  commands: ReactNode;
  /** App.tsx의 `open`(선택된 스레드). null이면 요약할 대상이 없다. */
  threadSelected: boolean;
  /** threads.title — 패널이 "무엇에 대해" 일하는지 보여주는 컨텍스트 줄. */
  threadTitle?: string | null;
  /** threads.meta.summary. 아직 요약이 없으면 null → "아직 요약 없음". */
  summary: string | null;
  /** ask 바의 현재 입력. 비어 있지 않으면 "명령" 탭으로 자동 전환한다 — 타이핑이
   *  cmdk 목록을 거르는데 화면엔 제안만 보이는 막다른 길을 막는다. */
  query?: string;
  /** 닫힘 스프링이 도는 동안(app.css .ask-panel--closing) DOM에 남아 있는 상태. */
  closing?: boolean;
  onClose: () => void;
}

type Tab = "suggest" | "commands";

export function AskPanel({
  commands,
  threadSelected,
  threadTitle = null,
  summary,
  query = "",
  closing = false,
  onClose,
}: AskPanelProps) {
  // 기본 탭은 입력에서 파생된다: 비어 있으면 "제안", 타이핑 중이면 "명령"(">"도 여기에 걸린다).
  // 탭 버튼을 직접 누르면 그 선택이 override로 남고, 다음 타이핑에 풀린다.
  const [override, setOverride] = useState<Tab | null>(null);
  const [summaryShown, setSummaryShown] = useState(false);
  // react.dev "prop이 바뀔 때 state 조정" 패턴: 타이핑이 있을 때마다 수동 선택을 푼다
  // (useEffect로 하면 한 프레임 늦게 지워져서 낡은 탭이 한 번 깜빡인다).
  const [lastQuery, setLastQuery] = useState(query);
  if (lastQuery !== query) {
    setLastQuery(query);
    setOverride(null);
  }
  const tab: Tab = override ?? (query.trim() === "" ? "suggest" : "commands");

  return (
    <GlassSurface
      slot="palette"
      className={cn("ask-panel", closing && "ask-panel--closing")}
      // biome-ignore lint/a11y/useSemanticElements: GlassSurface is the shared glass wrapper (rail/toolbar/sheet/palette all use it) — a native <dialog> would need its own backdrop/blur styling duplicated here.
      role="dialog"
      aria-label="AI 패널"
    >
      <div className="ask-panel__head">
        {/* biome-ignore lint/a11y/useSemanticElements: tab-like toggle, not a form fieldset. */}
        <div className="ask-panel__tabs" role="group" aria-label="패널 보기">
          <button
            type="button"
            aria-pressed={tab === "suggest"}
            onClick={() => setOverride("suggest")}
          >
            제안
          </button>
          <button
            type="button"
            aria-pressed={tab === "commands"}
            onClick={() => setOverride("commands")}
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
        <>
          {/* 패널이 무엇을 대상으로 일하는지 먼저 말한다 — 레퍼런스의 대화 영역 자리다.
              (빈 밴드로 두면 "넓은 드롭다운"으로 읽힌다.) */}
          <div className="ask-panel__context">
            <p className="ask-panel__context-title">
              {threadSelected ? (threadTitle ?? "제목 없는 스레드") : "선택된 스레드 없음"}
            </p>
            <p
              className={cn(
                "ask-panel__context-body",
                (!summaryShown || summary === null) && "ask-panel__context-body--muted",
              )}
            >
              {summaryShown
                ? (summary ?? "아직 요약 없음")
                : threadSelected
                  ? "아래 제안은 이 스레드를 대상으로 실행됩니다."
                  : "스레드를 고르면 제안이 살아납니다."}
            </p>
          </div>
          <div className="ask-panel__actions">
            {/* US-D01 폴백: 초안/할 일 추출은 붙일 라우트가 없다 — 비활성 + title="Phase B".
                누를 수 있는 척하는 것보다 못 누른다고 말하는 게 정직하다. */}
            <button type="button" className="ask-panel__action" disabled title="Phase B">
              <PenLine size={15} aria-hidden="true" />
              답장 초안 작성
              <span className="ask-panel__tag" aria-hidden="true">
                Phase B
              </span>
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
              {!threadSelected && (
                <span className="ask-panel__tag" aria-hidden="true">
                  스레드 필요
                </span>
              )}
            </button>
            <button type="button" className="ask-panel__action" disabled title="Phase B">
              <ListChecks size={15} aria-hidden="true" />할 일 추출
              <span className="ask-panel__tag" aria-hidden="true">
                Phase B
              </span>
            </button>
          </div>
        </>
      )}
    </GlassSurface>
  );
}
