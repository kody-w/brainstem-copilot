---
name: brainstem-frontier
description: Optional Frontier mode only. Connect an existing RAPP Brainstem engine when the user explicitly asks for Frontier, external Python RAPP agents, or the legacy /chat workflow. Never required for native Brainstem onboarding.
---

# Frontier: optional external engine

Brainstem and Brain Surgeon are roles in one native Copilot chat. This skill
is an explicit opt-in for users who want a separate RAPP engine. Do not invoke
it just because the user says "Brainstem."

1. Confirm that the user chose Frontier and explain that it runs a separate
   engine. Frontier can execute its installed Python agents and can consume
   additional model usage. Native Copilot approvals still apply.
2. Use `brainstem_mode` to choose `frontier`. Then use `brainstem_frontier`
   to connect to an existing loopback URL, normally `http://127.0.0.1:7071`.
   No automatic installation or startup occurs when the plugin loads.
3. If the engine is not running, offer to start its existing `start.sh` or
   `start.ps1` using Copilot's normal, approved command tools. Do not require
   the user to open a terminal, do not create a hidden daemon, and do not
   bypass device or enterprise policy.
4. If it is not installed, obtain explicit installation approval and use the
   published RAPP installer from `https://github.com/kody-w/rapp-installer`.
   Do not copy credentials, private agents, or config from another machine.
5. Resolve sign-in through the engine's own browser UI at its base URL.
   This plugin never reads `.copilot_token`, `.env`, or session credentials.
6. Execute capabilities with `brainstem_frontier` using the existing `/chat`
   wire. Keep session history coherent and show actual results and agent logs.
   GET source endpoints are for inspection only; never invent new routes.
7. Return to native Copilot with `brainstem_mode` set to `copilot` whenever
   requested. This does not stop an external server the user already owns.

Do not automatically retry failed or timed-out actions: an already submitted
agent action may still have completed. Frontier mode does not make arbitrary
agent code safe or bypass its existing permissions.
