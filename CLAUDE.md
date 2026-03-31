# CLAUDE.md

## Project

Louie — civic engagement product for the City of Mississauga. This repo contains both the Louie web app and the embedded Negation Game deliberative tool.

## Read First

Before starting any work, read `SPEC.md` at the repo root. It contains the full product brief, page architecture, design principles, and the two demo happy paths that must work.

## Branch

All demo work happens on the `demo` branch.

## What We're Building

Front-end only. No backend, no API keys. Louis handles AI/backend separately. Our job is a polished, functional-looking front-end for a video demo.

## Tech Stack

<!-- Update these once you confirm what Louis is using -->
- Framework: (check repo — likely Next.js or similar)
- Styling: (check repo)
- Package manager: (check repo)

## Build & Run

```bash
# Update these with actual commands from the repo
npm install
npm run dev
```

## Key Constraints

- Design should feel civic/institutional, not startup-flashy. Reference mississauga.ca for tone.
- Narrow column layout for the feed — mobile-compatible by default.
- Chat UI needs all core features. Build it as a clean, replaceable component so Louis can swap in real AI.
- Search bar: default placeholder content → default mock response on Enter.
- The Negation Game lives in a separate repo. We embed it via iframe URLs (~6–10 topic URLs available).
- Ensure the feed topics match the topics we have Negation Game URLs for.
- Sample data and headlines are already in the repo. Use them.

## Files to Know

- `SPEC.md` — full product brief (the source of truth)
- `louie-demo (15).html` — Paul's demo prototype (reference only, don't extend)
- `louie-civic-memory (31).html` — Paul's civic memory prototype (reference only)
- Screenshot of Mississauga landing page with entry points circled (to be added)

## Demo Happy Paths (Must Work)

1. **Road Safety Budget**: Mississauga page → sidebar link → Home feed → Road Safety headline → Topic Detail with Negation Game embed + chat
2. **Institutional Memory Search**: Mississauga page → sidebar link → Home → search bar → type question about institutional memory → Enter → chat with mock response