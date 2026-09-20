import { InboxRow } from "@omnis/ui/components/inbox-row";

/** InboxRow 7-combination demo: 3 avatar kinds (initials/runtime/photo) × states (unread/selected/pending-approval/archived/draft).
 *  When agentState isn't null the right slot becomes a status badge instead of the channel icon (agent session row).
 *  Without onArchive the hover action button isn't drawn at all — rows 3 and 5 are that case. */

export function InboxRowDemo() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {/* 1. Initials + unread + 1 scope label */}
      <InboxRow
        id="demo-inbox-1"
        name="Seoyeon Kim"
        timestamp="3m"
        summary="Please review the quarterly budget proposal."
        isDraft={false}
        avatar={{ kind: "initials", name: "Seoyeon Kim" }}
        channel="gmail"
        agentState={null}
        unread
        selected={false}
        hasPendingApproval={false}
        labels={[{ kind: "scope", name: "Customer", color: null }]}
        onSelect={() => {}}
        onArchive={() => {}}
      />

      {/* 2. Selected + pending approval + 4 labels (2 chips + "+2") */}
      <InboxRow
        id="demo-inbox-2"
        name="Alex Kim"
        timestamp="2h"
        summary="Just needs approval on the release pipeline."
        isDraft={false}
        avatar={{ kind: "initials", name: "Alex Kim" }}
        channel="slack"
        agentState={null}
        unread={false}
        selected
        hasPendingApproval
        labels={[
          { kind: "topic", name: "Release", color: null },
          { kind: "priority", name: "Urgent", color: null },
          { kind: "person", name: "Seoyeon Kim", color: null },
          { kind: "topic", name: "Infra", color: null },
        ]}
        onSelect={() => {}}
        onArchive={() => {}}
      />

      {/* 3. Runtime avatar (Claude mark) + agent session + working — no onArchive, so no action button */}
      <InboxRow
        id="demo-inbox-3"
        name="Claude Code · Payment module refactor"
        timestamp="1m"
        summary="Running the test suite."
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

      {/* 4. Runtime avatar (DeepSeek mark) + blocked + onArchive present */}
      <InboxRow
        id="demo-inbox-4"
        name="claude-ds · Schema migration"
        timestamp="12m"
        summary="Approval needed: production DB schema change."
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

      {/* 5. Runtime with no mark in RUNTIME_ICON → letter "H" fallback */}
      <InboxRow
        id="demo-inbox-5"
        name="Hermes · Document cleanup"
        timestamp="1w"
        summary="Saved the meeting-notes summary."
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

      {/* 6. Photo avatar + draft — the draft prefix is added by the component */}
      <InboxRow
        id="demo-inbox-6"
        name="Jordan Lee"
        timestamp="5m"
        summary="Sharing next week's meeting schedule."
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
        labels={[{ kind: "scope", name: "Partner", color: null }]}
        onSelect={() => {}}
      />

      {/* 7. Archived row — the action button label flips to the restore label */}
      <InboxRow
        id="demo-inbox-7"
        name="Minsu Park"
        timestamp="2w"
        summary="Notes from last sprint's retro."
        isDraft={false}
        avatar={{ kind: "initials", name: "Minsu Park" }}
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
