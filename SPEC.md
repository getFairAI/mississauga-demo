# Louie Demo — Project Brief

## Overview

**Louie** is a civic engagement product that combines universal transcript search with a deliberative platform (the Negation Game) to surface and organize the substance of municipal council meetings. The first target customer is the **City of Mississauga**.

The core idea: take all of a city's council meeting assets (transcripts, audio, video, agendas, minutes) and distill them into searchable, interactable **deliberation maps** — then make those maps accessible via an AI chat experience.

**For this demo** we are building a **front-end only** — no API keys, no backend work. Louis handles the backend/AI. Our job is to produce a polished, functional-looking front-end that can be walked through in a **video demo** for city officials.

---

## Team & Naming

- **Louis** — CTO / backend / AI transcription
- **Paul** — collaborator who built earlier HTML prototypes (see repo: `louie-demo (15).html`, `louie-civic-memory (31).html`)
- **Louie** — the product name (yes, it's amusingly close to Louis)
- **Negation Game** — the deliberative decision-making tool (existing product, ~1.5 years in development). Uses Supporting Arguments, Negating Arguments, and Mitigating Arguments organized around questions with options. The Negation Game lives in a **separate repo** — it is integrated here via **embedded URLs**. We have roughly 6–10 Negation Game URLs associated with specific topics; the demo must include at least those topics, and especially the $2.2M budget question. In some prototypes, a screenshot of a Negation Game board was used as a placeholder.
- **Bo** — Paul's concept for a publicly accessible citizen feedback/submission API and app. Allows citizens to submit issues asynchronously, which get routed to the appropriate committee and surface in the agenda-setting process.

---

## Design Principles

The design should feel:

- **Durable** — this looks like infrastructure, not a startup experiment
- **Pragmatic** — no flash for flash's sake
- **Fresh & clean** — modern but not bleeding-edge
- **Not overwhelming** — obvious what to do, minimal cognitive load
- **Powerful** — conveys that serious capability lives underneath

Stylistically, lean toward the civic-website aesthetic — it's okay and even desirable to feel a bit "built by committee." Think: lots of links, lists, fairly small text, readable density. We're not designing a consumer app; we're designing a tool city staff and engaged citizens will trust. Reference the existing Mississauga site for tone.

---

## Key Assets

- **City of Mississauga Council & Committees Calendar page**: https://www.mississauga.ca/council/council-activities/council-and-committees-calendar/
- **Screenshot of landing page** with circled entry-point locations: *(to be provided separately)*
- **Paul's HTML prototypes** (in repo root): `louie-demo (15).html` and `louie-civic-memory (31).html`
- **Existing repo** with Louis's initial product build (styled similarly to Mississauga site but needs cleanup — currently described as "simultaneously flamboyant and inconsistent with the surrounding design")
- **Negation Game embed URLs** — ~6–10 URLs for specific topic boards; these are embedded via iframe or similar. The $2.2M budget question board must be among them.
- **Sample data / headlines** — already in the repo from Louis's work; use these as the feed content

---

## Architecture of Pages & Flows

### 1. Entry Point: Replicated Mississauga Council Page

We replicate the existing Mississauga Council & Committees Calendar page and add **two entry-point links** into the Louie experience. Their exact locations are documented in the annotated screenshot (see Key Assets).

1. **Sidebar link** — labeled something like "Open Civic Deliberative Memory." Clicking this takes the user to the **Home Page** of Louie (the feed + search experience).
2. **Per-meeting link** — appears in the details/minutes area of individual meetings. Clicking this takes the user directly to that **Committee Page** within Louie.

### 2. Home Page — Civic Deliberative Memory

This is the main landing page of the Louie product. It has two main elements:

#### A. Search Bar (top of page)

- On load: search bar sits at the top of the page, visually prominent, clearly the primary action. Give it **generous vertical whitespace** — breathing room that signals this is the most important element on the page.
- On click/focus: the search bar **does not** take over the whole screen in a flashy way. Instead, it smoothly pushes the feed content down and fills your viewport with just the search bar (and optionally suggested queries / search hints below it). Simple, centered, full attention.
- On blur/escape: returns to its resting position at the top

#### B. Feed (below search bar)

Replaces the current category-based committee listing. Instead of organizing by committee, present a **chronological feed** (newest first) of headline-style posts about what councils and committees have discussed.

**Feed item design:**
- **Title** — written like a news article headline. What would a Mississauga-engaged citizen find interesting? Be specific and substantive.
- **Question** (below the title) — a deliberative question associated with this topic. Clicking the question opens the Topic Detail Page / deliberative map. Not every feed item needs a question, but when one exists, this two-layer structure (title → question) is the pattern. A topic may have **multiple associated questions** (depending on how the data is structured); one approach is to generate a single representative question from the title for the feed, with additional questions visible on the Topic Detail Page.
- **Committee attribution** — shown in a readable but discreet way (e.g., small tag or byline). Clicking the committee name navigates to that Committee Page.
- **Audio play button** — a compact play button (not the full ugly audio scrubber). Tap to play; a circular progress indicator fills around the play icon as the short clip plays. These clips are very short — no need for a seek bar.
- **Expandable transcript** — a councillor's full statement can optionally expand below the audio snippet.
- *Optional: link to video at timestamp, if available*

**Feed layout:**
- Use a **narrow-ish column** layout (think modern feed / newsletter style). This reads well, looks modern, and is mobile-compatible from the start.

**Feed item structure (top to bottom within each item):**
1. **Title** (headline)
2. **Brief** — a short summary or context line
3. **Description opener** — beginning of a longer description, truncated with a "Read more" link that expands inline or navigates to the Topic Detail Page
4. **Key quotes** — notable statements from councillors on this topic, shown as sub-content beneath the description

The feed should be **a surface on which councillors get their voices heard and get to look good.** A handful of larger, prominent pull-quotes from councillors can be used to decorate the feed and add visual interest — think editorial style where a councillor's statement is given space and visual emphasis.

Topics/issues are the primary feed content. Quotes and statements are always sub-content of a topic, not standalone items.

#### C. Brief Description of "Civic Deliberative Memory"

Near the top of the page (below the header, above or near the search bar), include **1–2 lines** explaining what Civic Deliberative Memory is and does. This is a term we're coining — make it feel natural and self-evident. Something like:

> *Civic Deliberative Memory surfaces the issues your council is working on, tracks how they evolve over time, and invites structured public input.*

Keep it concise. Don't be hokey.

### 3. Committee Page

Reached by clicking a committee name anywhere in the app, or by clicking the per-meeting entry point on the replicated Mississauga page.

**Layout (top to bottom):**

1. **Committee header** (~1/4 to 1/2 of viewport) — key info about the committee:
   - Committee name
   - Meeting schedule (when it meets)
   - Links to agenda (HTML and PDF)
   - Link to video (if available)
   - Most recent meetings listed
2. **Key Issues section** — the feed-style posts associated with this committee. Same design as the home page feed, but filtered to this committee.

### 4. Topic Detail Page

Reached by clicking a topic/headline in the feed.

**Layout:**

- **Topic headline** expanded with full context
- **Other open questions** for this council/committee (sidebar or secondary list — shows what else is being discussed)
- **Key points made** — quotes, statements, arguments from councillors on this topic
- **History visualization** — how often this issue has been raised over time (borrowing from Paul's concept, but much simpler — avoid the overly complex circle/band graphics; a simple timeline or bar indicator is fine)
- **Main content area (side by side):**
  - **Left (~3/4 width): Negation Game embed** — embedded via iframe/URL for topics where we have one (in demo: the $2.2M budget question). For topics without a Negation Game URL, this area can show an expanded view of the key points and history instead.
  - **Right (~1/4 width): Chat panel** — a chat interface scoped to this topic. The **first message** in the chat is an AI-generated **summary of the deliberation**, so the user lands with immediate context. The user can then ask follow-up questions in this same chat. It should prioritize the Negation Game board / epistemic graph for this topic in its responses.

### 5. Universal Search → Chat Experience

When a user enters a search query in the Home Page search bar and hits enter:

- They land in a **chat interface** (separate page)
- Their search query becomes the first message in the chat
- A **sidebar** shows previous chat sessions they can switch back to
- The chat interface needs **all core features and functionality** of a modern chat UI. Given how established the pattern is (ChatGPT, Gemini, Claude, etc.), users have strong expectations. It must feel like a real, competent chat product.

**Mock behavior for the demo:**
- The search bar should have **default placeholder content** (e.g., a sample query)
- If the user hits Enter with the default content, it should produce a **pre-written default response** that looks like a reasonable AI answer
- Louis will override this component with real AI functionality later — build it as a clean, replaceable component

**Important distinction:** This universal chat is a *separate experience* from the per-topic chat on the Topic Detail Page. The universal chat searches across all transcripts and content. The topic chat is scoped to that specific topic's deliberation.

### 6. Citizen Feedback / Submission — "Bo"

Paul has a concept called **Bo** for a publicly accessible API/app where citizens can submit issues they're facing and get feedback. The flow:

- Citizens submit issues → routed to the proper committee → surfaces in the agenda-setting process (e.g., "Now we'd like to review public business — these are issues asynchronously submitted by citizens")
- Could be surfaced through the per-topic chat: when a user is discussing a deliberation and raises a point that isn't represented, the AI can say *"Would you like me to add that for you?"*
- Could also be a standalone API with good documentation that becomes a tool/skill people install to "talk to their councillor"

This is extremely compelling for the demo's value proposition — it closes the loop between citizens and council. Consider including at least a visual indication of this capability in the demo, even if the backend isn't wired up.

---

## Two Happy Paths (Must Work for Demo)

**These are the highest priority deliverables.** Everything else in this spec supports these two flows. If you have to cut scope anywhere, protect these paths. Every page, component, and interaction described below should be built to the extent that these two walkthroughs work end-to-end with no dead ends.

### Happy Path 1: Road Safety Budget Question
1. User starts on replicated Mississauga page
2. Clicks "Open Civic Deliberative Memory" in sidebar
3. Lands on Home Page feed
4. Sees a headline about the Road Safety Committee
5. Clicks through to the Topic Detail Page
6. Sees the Negation Game embed for: *"How is the Road Safety Committee using the $2.2 million budget provided by the province?"*
7. Can interact with the summary, key quotes, and chat

### Happy Path 2: Universal Search for "Institutional Memory"
1. User starts on replicated Mississauga page
2. Clicks "Open Civic Deliberative Memory" in sidebar
3. Lands on Home Page
4. Types a natural language question into the search bar, something like: *"When have councillors mentioned institutional memory or forgetting things?"*
5. Hits enter → lands in the chat experience
6. Sees a response surfacing relevant transcript moments

---

## Value Proposition Language

Throughout the design, look for natural opportunities to convey that Louie provides:

- **Transparency** — what's being discussed, by whom, and how it's evolving
- **Civic engagement** — citizens can follow, understand, and participate
- **Efficiency & cost savings** — staff and councillors can quickly find what's been discussed before, avoid re-litigating settled issues
- **Institutional memory** — nothing falls through the cracks; issues are tracked over time
- **Citizen satisfaction** — people feel heard and informed

Weave this into microcopy, page descriptions, and feature labels naturally. Do not be heavy-handed.

---

## What to Keep & What to Drop from Paul's Prototypes

**Keep:**
- The concept of showing how often an issue has recurred historically
- The flow from committee → key issues → Negation Game embed
- The overall page structure ideas (slides 3–5 of his demo are excellent)
- The "Civic Deliberative Memory" entry point on the Mississauga sidebar

**Drop / Redesign:**
- The complex circle/band history visualization — too much visual real estate for too little information; symbols doing too much work. Replace with something simpler.
- The unintuitive history tab UX
- The existing "Ask Louie" chat design — it doesn't look good or feel usable
- The category-based committee organization on the landing page — replace with the feed

**From Louis's existing build, keep but refine:**
- The search bar concept (currently "simultaneously flamboyant and inconsistent with the surrounding design" — tone down the flashy expand animation, make it feel native to the civic aesthetic)
- The general page structure and Mississauga-aligned styling
- Audio snippets (but replace the full audio scrubber with the compact play button)

---

## Technical Notes

- **Branch**: Create a `demo` branch for all this work
- **Front-end only**: No backend, no API integration. Louis handles that separately.
- **Negation Game**: Lives in a separate repo. Embed via iframe using the ~6–10 URLs we have. Ensure the topics in the feed match the topics we have Negation Game URLs for.
- **Sample data**: Headlines and transcript data are already in the repo from Louis's work. Use them.
- **AI chat**: Build a full-featured chat UI with mock default behavior (default query → default response). Louis will override the response component with real AI. Build the chat component to be cleanly replaceable.
- **Mobile-first-ish**: The narrow column layout should be responsive by default. Don't build a separate mobile version, but make sure it doesn't break.

---

## Terminology

| Internal term | User-facing term |
|---|---|
| Universal search / universal chat | *(just the search bar and chat — no special label)* |
| Civic Deliberative Memory | "Civic Deliberative Memory" (use this as the feature name) |
| Negation Game | *(embedded, may not need to be named in the demo)* |
| Epistemic graph | *(internal only)* |
| Topic / headline | *(just appears as content — no meta-label needed)* |
| Bo | *(citizen feedback system — TBD on user-facing name)* |
| Louie | "Louie" (the product name) |