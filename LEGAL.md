# Legal Notice

## Disclaimer

This project is an unofficial, community-maintained SDK for building extensions
for [Antigravity IDE](https://antigravity.dev). It is **not affiliated with,
endorsed by, or sponsored by Google LLC or any of its subsidiaries.**

## Nature of the Project

Antigravity SDK provides a **TypeScript library** for VS Code extension
developers who want to build tools that work within Antigravity IDE.

The SDK interacts with Antigravity exclusively through:

- **VS Code Extension API** — the standard, documented `vscode.*` namespace
  that all extensions use
- **Registered commands** — commands exposed by Antigravity through the
  standard `vscode.commands` interface
- **Local state files** — reading (not writing) locally stored settings

## Compliance

- This SDK **does not access** Google's backend servers, gRPC endpoints,
  or authentication systems directly.
- This SDK **does not extract** AI models, training data, weights, or
  proprietary algorithms.
- This SDK **does not bypass** security features, licensing, rate limits,
  or usage restrictions.
- This SDK **does not proxy** or relay requests to Google's infrastructure.
- All communication goes through Antigravity's own extension host — the same
  mechanism used by any VS Code extension.

## Interoperability

This SDK is developed to enable interoperability between Antigravity IDE
and third-party extensions, as provided by:

- **EU Software Directive** (Directive 2009/24/EC), Article 6 — permits
  analysis of software for the purpose of achieving interoperability
- **UK Copyright, Designs and Patents Act 1988**, Section 50B
- Similar provisions in other jurisdictions

The API interfaces documented in this project were derived through observation
of Antigravity's public extension API surface — the same surface available to
any VS Code extension running inside Antigravity.

## User Responsibility

Users and extension developers are responsible for ensuring their use of
this SDK and any extensions built with it comply with applicable terms of
service and local laws.

Extension developers should:

1. Not use the SDK to access Google's backend directly
2. Not use the SDK to extract or replicate AI model behavior
3. Not use the SDK to bypass security or licensing restrictions
4. Follow Antigravity's extension guidelines where applicable

## Takedown

If Google or the Antigravity team requests removal of this project, we will
comply promptly. Contact: [open a GitHub issue](https://github.com/Kanezal/antigravity-sdk/issues).

## License

This project is released under the [GNU Affero General Public License v3.0](LICENSE).
