import { InboxRow } from "@omnis/ui/components/inbox-row";

/** InboxRow 7조합 데모: 아바타 3종(이니셜/런타임/사진) × 상태(안읽음/선택/승인대기/보관/초안).
 *  agentState가 null이 아니면 우측 슬롯이 채널 아이콘 대신 상태 배지로 바뀐다(에이전트 세션 행).
 *  onArchive를 안 주면 hover 액션 버튼 자체가 안 그려진다 — 3·5번 행이 그 케이스. */

export function InboxRowDemo() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {/* 1. 이니셜 + 안읽음 + scope 라벨 1개 */}
      <InboxRow
        id="demo-inbox-1"
        name="김서연"
        timestamp="3m"
        summary="분기 예산안 검토 부탁드립니다."
        isDraft={false}
        avatar={{ kind: "initials", name: "김서연" }}
        channel="gmail"
        agentState={null}
        unread
        selected={false}
        hasPendingApproval={false}
        labels={[{ kind: "scope", name: "고객", color: null }]}
        onSelect={() => {}}
        onArchive={() => {}}
      />

      {/* 2. 선택됨 + 승인 대기 + 라벨 4개(칩 2개 + "+2") */}
      <InboxRow
        id="demo-inbox-2"
        name="Alex Kim"
        timestamp="2h"
        summary="릴리스 파이프라인 승인만 남았습니다."
        isDraft={false}
        avatar={{ kind: "initials", name: "Alex Kim" }}
        channel="slack"
        agentState={null}
        unread={false}
        selected
        hasPendingApproval
        labels={[
          { kind: "topic", name: "릴리스", color: null },
          { kind: "priority", name: "긴급", color: null },
          { kind: "person", name: "김서연", color: null },
          { kind: "topic", name: "인프라", color: null },
        ]}
        onSelect={() => {}}
        onArchive={() => {}}
      />

      {/* 3. 런타임 아바타(Claude 마크) + 에이전트 세션 + working — onArchive 없음이라 액션 버튼 미표시 */}
      <InboxRow
        id="demo-inbox-3"
        name="Claude Code · 결제 모듈 리팩터"
        timestamp="1m"
        summary="테스트 스위트 실행 중입니다."
        isDraft={false}
        avatar={{ kind: "runtime", runtime: "claude_code" }}
        channel="agent"
        agentState="working"
        unread
        selected={false}
        hasPendingApproval={false}
        labels={[]}
        onSelect={() => {}}
      />

      {/* 4. 런타임 아바타(DeepSeek 마크) + blocked + onArchive 있음 */}
      <InboxRow
        id="demo-inbox-4"
        name="claude-ds · 스키마 마이그레이션"
        timestamp="12m"
        summary="승인 필요: 운영 DB 스키마 변경."
        isDraft={false}
        avatar={{ kind: "runtime", runtime: "claude_ds" }}
        channel="agent"
        agentState="blocked"
        unread={false}
        selected={false}
        hasPendingApproval
        labels={[{ kind: "topic", name: "DB", color: null }]}
        onSelect={() => {}}
        onArchive={() => {}}
      />

      {/* 5. RUNTIME_ICON에 마크가 없는 런타임 → 글자 "H" 폴백 */}
      <InboxRow
        id="demo-inbox-5"
        name="Hermes · 문서 정리"
        timestamp="1w"
        summary="회의록 요약을 저장했습니다."
        isDraft={false}
        avatar={{ kind: "runtime", runtime: "hermes" }}
        channel="agent"
        agentState="done"
        unread={false}
        selected={false}
        hasPendingApproval={false}
        labels={[]}
        onSelect={() => {}}
      />

      {/* 6. 사진 아바타 + 초안 — "초안: " 접두는 컴포넌트가 붙인다 */}
      <InboxRow
        id="demo-inbox-6"
        name="Jordan Lee"
        timestamp="5m"
        summary="다음 주 미팅 일정 공유드립니다."
        isDraft
        avatar={{
          kind: "photo",
          url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3Crect width='32' height='32' fill='%234A90D9'/%3E%3C/svg%3E",
          name: "Jordan Lee",
        }}
        channel="linkedin"
        agentState={null}
        unread={false}
        selected={false}
        hasPendingApproval={false}
        labels={[{ kind: "scope", name: "파트너", color: null }]}
        onSelect={() => {}}
      />

      {/* 7. 보관된 행 — 액션 버튼 라벨이 "되살리기"로 바뀐다 */}
      <InboxRow
        id="demo-inbox-7"
        name="박민수"
        timestamp="2w"
        summary="지난 스프린트 회고 정리입니다."
        isDraft={false}
        avatar={{ kind: "initials", name: "박민수" }}
        channel="outlook"
        agentState={null}
        unread={false}
        selected={false}
        hasPendingApproval={false}
        labels={[]}
        onSelect={() => {}}
        onArchive={() => {}}
        archived
      />
    </div>
  );
}
