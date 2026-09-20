import type { Dictionary } from "./types.js";

/** A5 §8 마이크로카피 표의 영어 원문 — 병기용이 아니라 코드/aria-label에 실제로 쓰는 값이다.
 * 키 형태는 ko와 동일해야 하며(`const en: Dictionary`), 빠지거나 남으면 컴파일 에러가 난다. */
export const en: Dictionary = {
  common: {
    draftCard: {
      editAndSend: "Edit & send",
      discard: "Discard",
      regenerate: "Regenerate",
    },
    approvalSheet: {
      accept: "Accept",
      edit: "Edit",
      ignore: "Ignore",
      respond: "Respond",
    },
    itemCount: "{count, plural, one{# item} other{# items}}",
  },
  errors: {
    inbox: { channelDisconnected: "{channel} disconnected — Reconnect" },
    offline: { banner: "Offline — last synced {n}m ago" },
  },
  emptyStates: {
    inbox: "Inbox is empty",
    tasksToday: "Nothing due today",
    tasksDelegated: "No delegated tasks",
    network: "Contacts fill in automatically from your inbox",
  },
  approvals: {
    killSwitchConfirm: "Stop all autonomous actions?",
    autonomyOnWarning: "Actions to this target send without approval",
    pushNotification: "{action} needs your approval",
  },
  onboarding: {
    channelNotConnected: "Requires Mac mini setup",
    firstSyncInProgress: "Syncing your messages…",
  },
  digest: {
    restoredToast: "Restored · Undo",
    briefingPreparing: "Preparing your briefing, refreshes in {n}m",
  },
};
