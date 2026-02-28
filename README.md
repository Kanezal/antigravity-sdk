<div align="center">

# 🔌 Antigravity SDK

**Community SDK for building extensions and tools for [Antigravity IDE](https://antigravity.dev)**

[![npm](https://img.shields.io/npm/v/antigravity-sdk)](https://www.npmjs.com/package/antigravity-sdk)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)

*Unlock the full potential of Antigravity's AI agent.*

</div>

---

## 🤔 What is this?

A TypeScript SDK that lets you build VS Code extensions that interact with **Antigravity's Cascade agent** — create headless background chats, monitor steps, read hidden metadata, **inject custom UI**, and access **148 Language Server methods** directly.

**Key principle:** The SDK communicates through **existing Antigravity protocols** — never directly with Google servers.

---

## 🚀 Quick Start

```bash
npm install antigravity-sdk
```

```typescript
import { AntigravitySDK, Models } from 'antigravity-sdk';

export async function activate(context: vscode.ExtensionContext) {
  const sdk = new AntigravitySDK(context);
  await sdk.initialize();

  // ⭐ Create a HEADLESS cascade (no UI switching!)
  const cascadeId = await sdk.ls.createCascade({
    text: 'Analyze test coverage',
    model: Models.GEMINI_FLASH,
  });

  // Send follow-up messages
  await sdk.ls.sendMessage({
    cascadeId: cascadeId!,
    text: 'Focus on edge cases',
  });

  // Switch UI only when ready
  await sdk.ls.focusCascade(cascadeId!);

  // List conversations
  const sessions = await sdk.cascade.getSessions();
  console.log(`${sessions.length} conversations`);

  // Read agent preferences (16 sentinel keys)
  const prefs = await sdk.cascade.getPreferences();
  console.log('Terminal policy:', prefs.terminalExecutionPolicy);

  // Monitor agent activity
  sdk.monitor.onStepCountChanged((e) => {
    console.log(`${e.title}: +${e.delta} steps`);
  });
  sdk.monitor.start();

  // Call ANY of 148 LS methods directly
  const status = await sdk.ls.rawRPC('GetUserStatus', {});

  context.subscriptions.push(sdk);
}
```

---

## 📦 Features

| Feature | Status |
|---------|--------|
| **Headless cascade creation** (no UI flickering) | ✅ `sdk.ls` |
| **148 Language Server methods** (direct RPC) | ✅ `sdk.ls.rawRPC()` |
| List & switch conversations | ✅ `sdk.cascade` |
| Read agent preferences (16 sentinel keys) | ✅ `sdk.cascade` |
| Get system diagnostics (176KB) | ✅ `sdk.cascade` |
| Monitor step changes & session switches | ✅ `sdk.monitor` |
| Accept/reject agent steps & terminal commands | ✅ `sdk.cascade` |
| **Inject custom UI into Agent View** (9 points) | ✅ `sdk.injection` |
| Send messages to active chat | ✅ `sdk.cascade` |
| Background chat creation | ✅ `sdk.ls` |

---

## 🏗️ Architecture

```
Your Extension
     │
     ▼
┌──────────────────────────────────────────┐
│            antigravity-sdk               │
│                                          │
│  sdk.ls          ← LSBridge (⭐ NEW)     │
│    Direct HTTPS to Language Server       │
│    148 methods, headless cascades        │
│                                          │
│  sdk.cascade     ← CascadeManager       │
│    Sessions, preferences, step control   │
│                                          │
│  sdk.monitor     ← EventMonitor         │
│    USS polling, trajectory tracking      │
│                                          │
│  sdk.injection   ← InjectionManager     │
│    DOM injection into Agent View         │
│                                          │
│  sdk.commands    ← CommandBridge         │
│  sdk.state       ← StateBridge          │
└────────┬───────────────┬─────────────────┘
         │               │
    LS (gRPC)      workbench.html
  127.0.0.1:PORT    (DOM inject)
```

---

## 🔑 Key Discovery: Headless LS API

The SDK discovered that Antigravity's Language Server is accessible via **ConnectRPC** on `127.0.0.1:{port}`. The port is auto-discovered from diagnostics. This enables:

- **True headless cascade creation** — no panel opens, no UI switching
- **Direct access to 148 RPC methods** — everything from chat to git to MCP
- **Background task orchestration** — create and manage cascades silently

```typescript
// Create cascade in background
const id = await sdk.ls.createCascade({ text: 'Run tests', model: 1018 });

// Raw RPC to any LS method
const memories = await sdk.ls.rawRPC('GetUserMemories', {});
const workflows = await sdk.ls.rawRPC('GetAllWorkflows', {});
const models = await sdk.ls.rawRPC('GetModelStatuses', {});
```

---

## 📖 Documentation

- **[GEMINI.md](GEMINI.md)** — Full internal architecture docs (148 LS methods catalog, Preact VNode structure, protobuf schemas)
- **[API Reference](https://kanezal.github.io/antigravity-sdk)** — TypeDoc (coming soon)

---

## 🤝 Contributing

This is a community project. PRs welcome!

1. Fork the repo
2. Create a feature branch
3. Follow the existing code style
4. Add JSDoc comments for all public methods
5. Submit a PR

---

## ⚠️ Disclaimer

This project is not affiliated with Google or the Antigravity team. The SDK interacts with Antigravity through its existing extension API and internal protocols.

---

## 📜 License

[AGPL-3.0](LICENSE)
