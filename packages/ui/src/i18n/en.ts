import type { Dictionary } from "./types.js";

/** The English source of A5 §8's microcopy table — these are the strings the UI actually renders,
 * not a parallel gloss. The key shape has to match ko's exactly (`const en: Dictionary`), so a key
 * missing here or left over there is a compile error; packages/ui/test/i18n.test.ts checks the same
 * invariant at runtime, and that the two locales agree on every `{variable}`. */
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
    dialog: {
      confirm: "Confirm",
      cancel: "Cancel",
    },
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
    steps: {
      welcome: "Welcome",
      connectChannels: "Connect channels",
      selfModel: "Self-model seed",
      firstSync: "First sync",
      firstBriefing: "First briefing",
    },
    welcome: "Welcome to omnis",
    connect: "Connect",
    connectLater: "Connect later",
  },
  digest: {
    restoredToast: "Restored · Undo",
    briefingPreparing: "Preparing your briefing, refreshes in {n}m",
    heading: "{date} night digest · {n} archived",
    categoryHeading: "{category} ({n})",
    category: {
      email: "Email",
      message: "Messages",
    },
    categoryCount: "{label} {n}",
    viewAll: "View all",
    costReport: "This month's spend: {spent} / {limit} ({percent}%)",
    restore: "Restore",
    loading: "Tonight's digest hasn't run yet — it generates at 23:00",
    empty: "Nothing was archived today",
    error: "Digest generation failed — retry manually",
  },
  settings: {
    nav: {
      accounts: "Accounts",
      autonomy: "Autonomy",
      modelTiers: "Model tiers",
      general: "General",
    },
    accounts: {
      status: {
        connected: "Connected",
        readOnly: "Read only",
      },
      reconnect: "Reconnect",
      reconnectFailed: "Reconnect failed — Retry",
      sendEnable: "Enable send",
      sendEnableCountdown: "Enable send (D-{days})",
      sendEnableTooltip: "read stable {elapsed}/14 days · activates in {remaining}d",
    },
    autonomy: {
      allowToggle: "Allow autonomy",
    },
    // US-C05 / A4 §4.4: the delegation allow-rule editor on the Autonomy tab. The dialog's Cancel
    // button is not repeated here — `common.dialog.cancel` is the same word, and a second key for
    // one string is how two copies of it come to disagree.
    delegation: {
      title: "Delegation",
      empty: "No runtime runs without your approval.",
      add: "Add rule",
      runtime: "Runtime",
      host: "Host",
      repo: "Repository path",
      remove: "Remove",
      warning:
        "Delegations to this runtime in this repository will run without approval. Continue?",
      allow: "Allow",
      hermesHint: "Needs the Hermes approval check first",
    },
    modelTiers: {
      spentHeading: "Spend this month",
      spent: "{amount} used",
      limitLabel: "Monthly cost cap",
      reserveLabel: "VIP/sensitive thread reserve",
      statusNormal: "Normal",
      statusWarning: "T2→T1 downgrade",
      statusOver: "Non-VIP drafts paused",
      usageBarLabel: "Monthly budget used",
      save: "Save",
    },
    killSwitch: {
      heading: "Kill switch",
      stopAll: "Stop all autonomous actions",
    },
  },
  inbox: {
    title: "Inbox",
    filters: {
      all: "All",
      work: "Work",
      personal: "Personal",
      agents: "Agents",
      needsApproval: "Needs approval",
    },
    bulk: {
      archive: "Archive",
      label: "Label",
      delegate: "Delegate",
    },
    draftPrefix: "Draft: {preview}",
    emptyChannels: "Connected channels: {n} OK",
    channelIcon: "{channel} message",
    runtimeIcon: "{runtime} session",
    unread: "Unread",
    labelChip: "{kind} label: {name}",
    moreLabels: "Show {n} more labels",
  },
  thread: {
    actions: {
      archive: "Archive",
      label: "Label",
      more: "More",
    },
    // US-D05: same copy the card renders (draft-card.tsx). The "omnis draft · Sources:" form was
    // the `A · B` metadata separator and a field name; {sources} is unchanged, so the ko/en
    // placeholder-parity test still holds.
    draftProvenance: "Drafted from {sources}",
    draftFailed: "Couldn't generate a draft — Retry",
    empty: "No messages yet",
    autoArchived: "Auto-archived {n}d ago — Restore",
    composerReadOnly: "This channel sends after approval",
    composerPlaceholder: "Type a message",
  },
  agentSession: {
    readOnly: "Read-only",
    readSession: "Read session",
    connecting: "Connecting to {runtime}…",
    connectFailed: "Can't reach local-agent on {host} — check Tailscale",
    reconnect: "Reconnect",
    notLive: "Not live",
    tool: {
      read: "Reading",
      searchMemory: "Searching memory",
      readCalendar: "Checking calendar",
      readSession: "Checking other sessions",
      proposeDraft: "Drafting a reply",
      proposeTask: "Extracting tasks",
      proposeDelegation: "Proposing a delegation",
      proposeRoute: "Proposing a note route",
    },
    toolState: {
      running: "Running",
      done: "Done",
      error: "Failed",
      retry: "Retry",
    },
    systemDelegated: "✓ Delegated to {runtime} · {time}",
  },
  askPanel: {
    placeholder: "Type a message",
    send: "Send",
  },
  today: {
    greeting: "Good morning, {name}.",
    summary: "{items} items to handle today, {approvals} awaiting approval.",
    nightlyDigest: {
      ready: "Night digest ready · {n} archived",
      view: "View",
    },
    calendarHeading: "Today's schedule",
    calendarSource: "Google Calendar",
    briefingHeading: "Morning briefing",
    briefingSubheading: "Overnight, by importance",
    briefingRetry: "Retry",
    pendingApprovals: "Pending approvals ({n})",
    approvalChipLabel: "Pending approval: {summary}, requested {time}",
    emptyQuiet: "A quiet day today",
    offlineBadge: "As of {n}h ago",
  },
  tasks: {
    tabs: {
      today: "Today",
      thisWeek: "This week",
      someday: "Someday",
      delegated: "Delegated",
    },
    source: "from: {source}",
    due: {
      today: "Today",
      todayDeadline: "Due today",
    },
    delegatedBadge: "delegated",
    state: {
      inProgress: "In progress",
      done: "Done",
      unknown: "Can't check status",
    },
    quickAddPlaceholder: "Add a task",
  },
  network: {
    followUpQueue: "Follow-up queue ({n})",
    searchPlaceholder: "Search",
    lastContact: "Last contact: {when}",
    followUpSuggestion: "Follow-up: {suggestion}",
    relationship: {
      active: "Active",
      warming: "Forming",
      dormant: "At risk",
      unknown: "Not enough info",
      dormantDays: "Dormant {n}d",
    },
    detail: {
      timeline: "Interaction timeline",
      channels: "Conversations across channels",
      notes: "Notes",
    },
  },
  notes: {
    composerHeading: "New note",
    composerPlaceholder: "Type a note",
    save: "Save",
    routing: {
      heading: "Routing suggestion:",
      shareTo: "Share to {target} thread",
      confidenceHigh: "High confidence",
      confidenceLow: "Low confidence",
      accept: "Accept",
      pickOther: "Pick another",
      none: "Don't route",
    },
    lowConfidenceRouting: "Couldn't find a match — pick manually",
    recentHeading: "Recent notes",
    routedTo: "→ {target}",
    empty: "No notes yet",
  },
  relativeTime: {
    justNow: "Just now",
    minutesAgo: "{n}m ago",
    hoursAgo: "{n}h ago",
    daysAgo: "{n}d ago",
    yesterday: "Yesterday",
  },
};
