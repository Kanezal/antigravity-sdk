<div align="center">

# Antigravity SDK

**Community SDK for building extensions for [Antigravity IDE](https://antigravity.dev)**

[![npm](https://img.shields.io/npm/v/antigravity-sdk)](https://www.npmjs.com/package/antigravity-sdk)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![Discord](https://img.shields.io/badge/Discord-Join%20Community-5865F2?logo=discord&logoColor=white)](https://discord.gg/M8MAvr8eAM)
[![Sponsor](https://img.shields.io/badge/Sponsor-Support%20this%20project-ff69b4?logo=githubsponsors&logoColor=white)](https://github.com/Kanezal/antigravity-sdk#support)

*Build powerful extensions that work alongside Antigravity's AI agent.*

</div>

---

## What is this?

A TypeScript SDK for building **VS Code extensions** that extend Antigravity IDE. It gives you programmatic access to the agent's conversations, preferences, step control, real-time activity monitoring, and a declarative API for integrating custom UI directly into the Agent View — all through Antigravity's own extension protocols.

> [!IMPORTANT]
> This SDK is designed **exclusively** for building Antigravity extensions. It is **not** a tool for integrating Antigravity with third-party applications, extracting data, or proxying requests. See [Compliance](#compliance).

---

## Quick Start

```bash
npm install antigravity-sdk
```

```typescript
import { AntigravitySDK } from 'antigravity-sdk';

export async function activate(context: vscode.ExtensionContext) {
  const sdk = new AntigravitySDK(context);
  await sdk.initialize();

  // List conversations with real titles
  const sessions = await sdk.cascade.getSessions();
  console.log(`${sessions.length} conversations`);

  // Read all 16 agent preferences
  const prefs = await sdk.cascade.getPreferences();
  console.log('Terminal policy:', prefs.terminalExecutionPolicy);

  // Monitor agent activity in real time
  sdk.monitor.onStepCountChanged((e) => {
    console.log(`${e.title}: +${e.delta} steps`);
  });
  sdk.monitor.onActiveSessionChanged((e) => {
    console.log(`Switched to: ${e.title}`);
  });
  sdk.monitor.start();

  // Accept/reject agent steps programmatically
  await sdk.cascade.acceptStep();
  await sdk.cascade.acceptTerminalCommand();

  context.subscriptions.push(sdk);
}
```

---

## Features

### Agent View UI Integration

The SDK provides **9 integration points** in the Agent View panel — add buttons, metadata, badges, menu items, and interactive elements with a fluent, declarative API. Everything is theme-aware and survives Antigravity updates via auto-repair.

```typescript
import { IntegrationManager, IntegrationPoint } from 'antigravity-sdk';

const ui = new IntegrationManager();

// Fluent API — chain calls
ui.addTopBarButton('stats', '📊', 'Show Stats', {
    title: 'Session Stats',
    rows: [{ key: 'Steps:', value: '42' }],
  })
  .addInputButton('tokens', '🔢', 'Token Counter')
  .addTurnMetadata('meta', ['turnNumber', 'userCharCount', 'aiCharCount', 'codeBlocks'])
  .addUserBadges('badges', 'charCount')
  .addBotAction('inspect', '🔍', 'Inspect Response')
  .addDropdownItem('export', 'Export Chat', '📋')
  .addTitleInteraction('title', 'dblclick', 'Double-click to bookmark');

await ui.install();
ui.enableAutoRepair(); // Survives Antigravity updates
```

| Integration Point | Location | Use Cases |
|-------------------|----------|-----------|
| `TOP_BAR` | Header icon bar | Session overview, navigation |
| `TOP_RIGHT` | Before close button | Status indicators, quick toggle |
| `INPUT_AREA` | Next to send button | Token counter, prompt templates |
| `BOTTOM_ICONS` | Bottom icon row | Mode switches, quick actions |
| `TURN_METADATA` | Inside each turn | Character count, code block stats, turn numbers |
| `USER_BADGE` | User message bubble | Message length indicator |
| `BOT_ACTION` | Next to Good/Bad | Response analysis, copy actions |
| `DROPDOWN_MENU` | 3-dot overflow menu | Export, settings, debug tools |
| `CHAT_TITLE` | Conversation title | Rename, bookmark on interaction |

> [!NOTE]
> The integration script runs in the renderer process, independent of the extension. The SDK uses a **heartbeat mechanism** to prevent orphaned integrations: `sdk.initialize()` refreshes a timestamp marker, and the script silently exits if the marker is stale (48h). Disabling your extension will automatically stop the integration on the next IDE restart after the grace period.

### Conversation Management

Full control over Cascade conversations — list, create, switch, send messages, and manage agent steps.

```typescript
// List sessions with titles, step counts, timestamps
const sessions = await sdk.cascade.getSessions();

// Switch to a conversation
await sdk.cascade.focusSession(sessions[0].id);

// Send a message to the active chat
await sdk.cascade.sendPrompt('Analyze this file');

// Create a background conversation
const id = await sdk.cascade.createBackgroundSession('Run tests quietly');
```

### Real-Time Event Monitoring

Watch for state changes as they happen — new conversations, step progress, session switches, preference updates.

```typescript
// Agent made progress (added steps)
sdk.monitor.onStepCountChanged((e) => {
  statusBar.text = `${e.title}: step ${e.newCount}`;
});

// User switched to a different conversation
sdk.monitor.onActiveSessionChanged((e) => {
  console.log(`Now viewing: ${e.title}`);
});

// New conversation created
sdk.monitor.onNewConversation(() => {
  console.log('New conversation detected');
});

// Any USS state changed (preferences, settings, etc.)
sdk.monitor.onStateChanged((e) => {
  console.log(`${e.key}: ${e.previousSize} → ${e.newSize} bytes`);
});

sdk.monitor.start(3000, 5000); // USS poll: 3s, trajectory poll: 5s
```

### Agent Step Control

Programmatically accept, reject, or run agent actions — build approval workflows, auto-accept policies, or custom review UIs.

```typescript
await sdk.cascade.acceptStep();           // Accept code edit
await sdk.cascade.rejectStep();           // Reject code edit
await sdk.cascade.acceptTerminalCommand(); // Accept terminal command
await sdk.cascade.rejectTerminalCommand(); // Reject terminal command
await sdk.cascade.runTerminalCommand();    // Run pending command
await sdk.cascade.acceptCommand();         // Accept non-terminal action
```

### State & Preferences

Read the agent's current settings — terminal policies, secure mode, sandbox config, and more. Decoded directly from protobuf sentinel values.

```typescript
const prefs = await sdk.cascade.getPreferences();

prefs.terminalExecutionPolicy  // OFF | AUTO | EAGER
prefs.artifactReviewPolicy     // ALWAYS | TURBO | AUTO
prefs.secureModeEnabled        // boolean
prefs.terminalSandboxEnabled   // boolean
prefs.shellIntegrationEnabled  // boolean
prefs.allowNonWorkspaceFiles   // boolean
// ... 16 preferences total
```

### IDE Diagnostics

Access system information, extension logs, and recent conversation metadata.

```typescript
const diag = await sdk.cascade.getDiagnostics();

console.log(diag.systemInfo.operatingSystem);
console.log(diag.systemInfo.userName);
console.log(diag.isRemote); // SSH?

// MCP URL, browser port, git status
const mcpUrl = await sdk.cascade.getMcpUrl();
const browserPort = await sdk.cascade.getBrowserPort();
const ignored = await sdk.cascade.isFileGitIgnored('secret.env');
```

### Headless Cascade (LSBridge)

Create and manage conversations programmatically through the Language Server — no UI flicker, no panel switching.

```typescript
import { Models } from 'antigravity-sdk';

// Create a headless cascade with model selection
const cascadeId = await sdk.ls.createCascade({
  text: 'Analyze test coverage in this project',
  model: Models.GEMINI_FLASH,
});

// Send follow-up messages
await sdk.ls.sendMessage({
  cascadeId,
  text: 'Now fix the failing tests',
  model: Models.GEMINI_PRO_HIGH,
});

// Focus in UI when ready
await sdk.ls.focusCascade(cascadeId);

// Or make raw RPC calls to any of the 68 verified LS methods
const status = await sdk.ls.getUserStatus();
const cascades = await sdk.ls.listCascades();
```

> [!NOTE]
> LSBridge auto-discovers the Language Server port and CSRF token from the running LS process. If auto-discovery fails (sandboxed environments), use `sdk.ls.setConnection(port, csrfToken)` manually.

---

## Architecture

```
Your Extension
     │
     ▼
┌──────────────────────────────────────────┐
│            antigravity-sdk               │
│                                          │
│  sdk.cascade     ← CascadeManager       │
│    Sessions, preferences, step control   │
│                                          │
│  sdk.monitor     ← EventMonitor         │
│    USS polling, trajectory tracking      │
│                                          │
│  sdk.integration ← IntegrationManager   │
│    Declarative UI for Agent View         │
│                                          │
│  sdk.commands    ← CommandBridge         │
│    60+ verified Antigravity commands     │
│                                          │
│  sdk.state       ← StateBridge          │
│    Read-only access to USS preferences   │
│                                          │
│  sdk.ls          ← LSBridge             │
│    Local LS communication (advanced)     │
│                                          │
└────────────────────────────────────────-─┘
         │
    vscode.commands.executeCommand()
    + read-only state.vscdb (sql.js)
```

> [!NOTE]
> The SDK uses `sql.js` (pure JS/WASM SQLite) instead of `better-sqlite3` because Antigravity's Electron ABI (v140 / Node v22.21.1) is incompatible with native modules. This was verified in runtime.

---

## Compliance

> [!CAUTION]
> **Token extraction is a violation of Google's Terms of Service.**
>
> The SDK **actively blocks** access to authentication tokens (`oauthToken`, `agentManagerInitState`, and other sensitive keys). Any attempt to read these keys will throw an error.
>
> Extracting, storing, forwarding, or reusing Antigravity OAuth tokens — directly or through third-party tools — violates Google's TOS and may result in account termination.

### What this SDK is for

- Building **VS Code extensions** that run inside Antigravity IDE
- Extending Antigravity's functionality for your own workflows
- Adding custom UI elements to the Agent View
- Monitoring and automating agent step approval
- Reading preferences and conversation metadata

### What this SDK is NOT for

- Integrating Antigravity with external applications or services
- Proxying or relaying requests to Google's infrastructure
- Extracting AI model outputs for training other models
- Accessing Google's backend servers, gRPC endpoints, or auth systems
- Building alternative clients or wrappers around Antigravity

### How it works

All SDK communication goes through three safe, local channels:

1. **`vscode.commands.executeCommand()`** — the standard VS Code Extension API that all extensions use. Antigravity decides what to execute.
2. **Read-only local state** — the SDK reads `state.vscdb` for preferences and metadata, never writes.
3. **Local Language Server** — the SDK communicates with the LS process on `127.0.0.1` using the same ConnectRPC protocol that Antigravity itself uses. Authentication is via an ephemeral per-session CSRF token (not the user's OAuth token). No data leaves the local machine through this channel.

The SDK includes a `SENSITIVE_KEYS` blocklist that prevents extension developers from accidentally (or intentionally) accessing authentication data.

---

## Documentation

- **[GEMINI.md](GEMINI.md)** — Full internal architecture docs, verified DOM selectors, protobuf schemas
- **[LEGAL.md](LEGAL.md)** — Legal notice, interoperability rights, compliance details
- **[API Reference](https://kanezal.github.io/antigravity-sdk)** — TypeDoc (coming soon)

---

## Community

Join our **[Discord server](https://discord.gg/M8MAvr8eAM)** to discuss SDK development, share extensions, and get help.

---

## Contributing

This is a community project. PRs welcome!

1. Fork the repo
2. Create a feature branch
3. Follow the existing code style
4. Add JSDoc comments for all public methods
5. Submit a PR

---

## Disclaimer

> [!WARNING]
> This project is not affiliated with Google or the Antigravity team. The SDK interacts with Antigravity through its existing extension API and local state files. Use at your own risk and in compliance with applicable terms of service.

---

## ❤️ Support

If you find this project useful and want to support its development, you can send **USDT** to:

| Network | Address |
|---------|---------|
| **TON** | `UQCjVh3C3mZc44GjT2IDsS4pmeOoUgRNxWMcb85NS5Bz_v1d` |
| **TRON (TRC20)** | `TH3JKGjNrSDCsjkkSuneaSMZoJYF7CNTXD` |

---

## License

[AGPL-3.0-or-later](LICENSE)
