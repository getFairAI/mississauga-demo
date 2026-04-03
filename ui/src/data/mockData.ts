// Mock data for the Louie civic engagement demo
// Meeting-centric model: each meeting has questions with optional Negation Game boards

export type KeyQuote = {
  speaker: string;
  role?: string;
  quote: string;
};

export type MeetingQuestion = {
  id: string;
  label: string; // short tab label
  deliberativeQuestion: string;
  negationGameUrl?: string;
  summary: string;
  decision?: string;
  keyQuotes?: KeyQuote[];
  theme?: string;
};

export type Meeting = {
  id: string;
  committee: string;
  committeeId: string;
  date: string;
  time: string;
  location: string;
  agendaHtmlUrl?: string;
  agendaPdfUrl?: string;
  minutesHtmlUrl?: string;
  minutesPdfUrl?: string;
  videoUrl?: string;
  questions: MeetingQuestion[];
  summary: string;
};

// --- Meetings with CDM data ---

export const meetings: Meeting[] = [
  {
    id: "road-safety-2026-01-27",
    committee: "Road Safety Committee",
    committeeId: "road-safety",
    date: "Tuesday, 27 January 2026",
    time: "9:30 AM",
    location: "Online Video Conference",
    agendaHtmlUrl:
      "https://pub-mississauga.escribemeetings.com/Meeting.aspx?Id=07533487-8a7e-44b4-bd23-f999f0bedc7d&Agenda=Agenda&lang=English",
    agendaPdfUrl: "#",
    videoUrl:
      "https://pub-mississauga.escribemeetings.com/Meeting.aspx?Id=07533487-8a7e-44b4-bd23-f999f0bedc7d&Agenda=Agenda&lang=English",
    questions: [
      {
        id: "q1-22m-fund",
        label: "$2.2M Road Safety Fund",
        deliberativeQuestion:
          "How should the $2.2M provincial road safety funding be deployed?",
        negationGameUrl:
          "https://negationgame.com/board/Jan-27-Q1-22M-Road-Safety-Fund_m-GXONA6Jzl8DHs9Z3M7OxI?share=sl-uQqy0QFtkaiTcTdJRh3-K",
        summary:
          "Staff plan equitable allocation across 11 wards (~$200k/ward), using ASE data to shortlist 5–6 candidate locations per ward with councillor input. Focus on physical traffic calming (speed cushions/bumps) plus lower-cost seasonal measures. Target 3–4 projects/ward (~40–50 total); construction anticipated 2026. March 2028 provincial deadline creates time pressure.",
        decision: "Recommendation carried — goes to General Committee next month",
        theme: "funding",
        keyQuotes: [
          {
            speaker: "Max Gill",
            role: "Staff",
            quote:
              "We're looking at equitable deployment across all 11 wards — approximately $200,000 each — focused on school zones and physical traffic calming measures.",
          },
          {
            speaker: "Committee Member",
            quote:
              "The provincial restrictions apply regardless of how we allocate. The March 2028 deadline means we need to move quickly on construction.",
          },
        ],
      },
      {
        id: "q2-school-bus",
        label: "School Bus Cameras",
        deliberativeQuestion:
          "Should school bus stop arm cameras be revived?",
        negationGameUrl:
          "https://negationgame.com/board/Jan-27-Q3-School-Bus-Cameras_m-GQtKRw7e2tVgMLN6WCII7?share=sl-syXRBLzUaIS4t3d_SPSTy",
        summary:
          "Initiative began around 2018; previously stalled due to procurement fraud by the original vendor. Councillor Tedjo is raising this at the regional level; Brampton is exploring a revival. School buses are region-wide, so Mississauga cannot act alone. Newer camera systems cost 60% less than the 2019 pilot technology.",
        decision: "Added to committee work plan by Monica",
        theme: "enforcement",
        keyQuotes: [
          {
            speaker: "Sunil",
            role: "Citizen Member",
            quote:
              "I personally witnessed two stop arm violations in just two weeks. This is not a theoretical problem — drivers are putting children at risk every single day.",
          },
          {
            speaker: "Councillor Tedjo",
            quote:
              "I'm raising this at the regional level. Brampton is exploring a revival — we should be coordinating with them rather than going it alone.",
          },
        ],
      },
      {
        id: "q3-road-watch",
        label: "Road Watch Awareness",
        deliberativeQuestion:
          "Is Road Watch awareness worth improving?",
        summary:
          "Road Watch saw 8.5% year-over-year growth with 3,590 reports in 2025, of which 2,018 were sent to registered owners. Reports drive daily officer deployment. However, residents largely don't know it exists, the form is too long, and people are uncomfortable sharing personal information.",
        decision: "Referred to promotional subcommittee",
        theme: "digital",
        keyQuotes: [
          {
            speaker: "Sunil",
            role: "Citizen Member",
            quote:
              "I personally assure residents their information won't be shared. But we need to make the process simpler — the form is a barrier.",
          },
        ],
      },
      {
        id: "q4-headlights",
        label: "Headlight Misalignment",
        deliberativeQuestion: "Is headlight misalignment worth addressing?",
        negationGameUrl:
          "https://negationgame.com/board/jan-27-Q2-Headlight-Misalignment_m-tBj6H9GP_ZFugVCCDbE0E?share=sl-2AhbwWv94KjT7_7UDThOj",
        summary:
          "The UK MOT model was cited as a successful approach. CAA receives complaints regularly. However, the province went in the opposite direction by removing license plate renewal requirements — there's no provincial appetite for additional cost to drivers. A CAA partnership was proposed as mitigation that wouldn't require provincial action.",
        decision: "Referred to promotional subcommittee — needs qualified presenter",
        theme: "education",
        keyQuotes: [
          {
            speaker: "CAA Representative",
            quote:
              "We can help develop guidance and promotional materials and communicate with approved shops. This doesn't require provincial action.",
          },
        ],
      },
      {
        id: "q5-event-participation",
        label: "Event Participation",
        deliberativeQuestion:
          "How do we increase Road Safety Committee event participation?",
        negationGameUrl:
          "https://negationgame.com/board/Jan-27-Q5-Increase-Road-Watch-Participation-Event_m-EydoHj8Yomc_HDCfPUSoT?share=sl-Qrg1JsGtcTxnAmwzQWkR9",
        summary:
          "Only 12 of 35 planned Road Watch events in 2025 met minimum attendance. The committee was dormant from approximately February 2020 through 2024. Strategies discussed include social media outreach, partnerships with neighbourhood associations, and integrating safety messaging into existing community events. Councillor offices need to provide 3–4 weeks' notice for volunteer coordination.",
        decision: "Staff/Chair to issue email calls for volunteers",
        theme: "process",
        keyQuotes: [
          {
            speaker: "Committee Chair",
            quote:
              "We need councillor offices giving us 3 to 4 weeks' notice. We can't scramble volunteers together in a few days.",
          },
        ],
      },
      {
        id: "q6-meeting-frequency",
        label: "Meeting Frequency",
        deliberativeQuestion:
          "Should the committee meet more frequently?",
        summary:
          "The 60-day gap between meetings means follow-up items wait too long. Recent agendas have been more robust, suggesting sufficient business to justify more frequent meetings. However, this is an election year — the committee may only meet 2–3 more times. The previous rationale for less frequent meetings was a lack of sufficient agenda items.",
        decision: "Deferred — review after March agenda",
        theme: "process",
        keyQuotes: [
          {
            speaker: "Committee Member",
            quote:
              "The 60-day gap means important follow-ups just sit there. If our agendas are this full, we should be meeting monthly.",
          },
        ],
      },
    ],
    summary: `**Road Safety Committee — January 27, 2026**

This meeting covered six key items across funding, enforcement, awareness, and process:

**$2.2M Provincial Road Safety Fund** — Staff plan equitable allocation across 11 wards (~$200k/ward), using ASE data to shortlist locations. Focus on physical traffic calming in school zones. Target 40–50 total projects; construction in 2026. Goes to General Committee next month.

**School Bus Stop-Arm Cameras** — Initiative that began ~2018, previously stalled due to vendor procurement fraud. Newer technology is 60% cheaper. Average of 8 stop arm violations per bus per day. Added to committee work plan.

**Road Watch Awareness** — 8.5% growth with 3,590 reports in 2025, but most residents don't know it exists. Form length and privacy concerns are barriers. Referred to promotional subcommittee.

**Headlight Misalignment** — UK MOT model cited; no provincial appetite for mandatory checks. CAA partnership proposed for guidance materials. Referred to promotional subcommittee.

**Event Participation** — Only 12/35 planned events met minimum attendance. Need 3–4 weeks notice from councillor offices for volunteer coordination.

**Meeting Frequency** — 60-day gaps slow down follow-ups. Deferred pending review after March agenda.`,
  },
  {
    id: "road-safety-2026-03-24",
    committee: "Road Safety Committee",
    committeeId: "road-safety",
    date: "Tuesday, 24 March 2026",
    time: "8:30 AM",
    location: "Online Video Conference",
    agendaHtmlUrl: "#",
    agendaPdfUrl: "#",
    videoUrl: "#",
    questions: [],
    summary:
      "This meeting's deliberation map has not yet been generated. Check back after the meeting transcript has been processed.",
  },
];

export const getMeeting = (id: string): Meeting | undefined =>
  meetings.find((m) => m.id === id);

// The most recent meeting with CDM content
export const mostRecentMeeting = meetings.find(
  (m) => m.questions.length > 0,
)!;

// --- Mock Chat Responses ---

export const mockChatResponses: Record<string, string> = {
  "2.2m": `The committee decided to deploy the **$2.2M provincial Road Safety Initiatives Fund** equitably across all 11 wards — approximately **$200,000 each** — focused on physical traffic calming in school zones.

### Key details

- **Funding source:** Provincial Road Safety Initiatives Fund, letter received November 2025
- **Deadline:** Must be spent by **March 2028**
- **Approach:** Staff will use Automated Speed Enforcement (ASE) data to shortlist 5–6 candidate locations per ward, then seek councillor input
- **Focus areas:** Speed cushions, speed bumps, and lower-cost seasonal measures
- **Scale:** Target 3–4 projects per ward, approximately **40–50 total projects**
- **Timeline:** Construction anticipated to begin in 2026

> *"We're looking at equitable deployment across all 11 wards — approximately $200,000 each — focused on school zones and physical traffic calming measures."*

— **Max Gill, Staff**

The recommendation was carried and goes to **General Committee next month** for approval.`,

  "school bus": `The school bus stop-arm camera initiative has a **long and complicated history** going back to 2018.

### Background

The original program stalled due to **procurement fraud** — the vendor involved in the 2019 pilot was found to have engaged in misconduct, killing the initiative.

### Current status

- **Councillor Tedjo** is raising the issue at the regional level
- **Brampton** is independently exploring a revival
- School buses operate **region-wide**, so Mississauga can't implement cameras alone
- Newer camera systems cost **60% less** than the 2019 pilot technology
- Data shows an average of **8 stop arm violations per bus per day** in Mississauga

> *"I personally witnessed two stop arm violations in just two weeks. This is not a theoretical problem — drivers are putting children at risk every single day."*

— **Sunil, Citizen Member**

**Decision:** Added to committee work plan by Monica. Regional coordination with Brampton is the likely path forward.`,

  "unresolved": `Based on the January 27 meeting, several items remain **unresolved or deferred**:

### Deferred items

- **Meeting frequency** — The question of whether to meet more often than every 60 days was deferred pending the March agenda. The committee may only meet 2–3 more times this term (election year).
- **Headlight misalignment** — Referred to promotional subcommittee, but still needs a qualified presenter and has no provincial support.

### Ongoing challenges

- **Road Watch awareness** — Has been raised 4 times since 2021 with no formal resolution. Keeps getting referred to subcommittee. The program is growing (8.5% YoY) but most residents still don't know it exists.
- **School bus cameras** — History goes back to 2018. Previously stalled due to vendor fraud. Now revived but requires regional coordination — Mississauga can't act alone.
- **Event participation** — Only 12 of 35 planned events met minimum attendance in 2025. Structural issues with volunteer coordination remain.

> *"We studied this in 2019. We studied it in 2022. Each time, the committee changes and we start from scratch. At some point we need to stop studying and start doing."*

— **Councillor Carolyn Parrish**`,

  "citizen-disagree": `That's an interesting perspective, and it touches on a real tension in the committee's debate.

### The equity vs. equality argument

The committee chose **equal distribution** (~$200K per ward), but several members did raise the point you're making:

- **Wards 5, 7, and 1** have significantly higher collision rates near schools — in some cases **3x the city average** based on ASE data
- The provincial funding letter does not require equal distribution — it allows **needs-based allocation**
- Staff's ASE shortlisting data could support a proportional model just as easily as an equal one

### What was said in the meeting

The counterargument from staff was that equitable allocation ensures **political buy-in across all 11 wards**, making it more likely the program moves forward quickly within the March 2028 deadline.

> *"If we weight the funding toward a few wards, we risk losing support from the others — and then the whole program stalls."*

— **Max Gill, Staff**

However, your point aligns with what transportation safety research supports: **targeting high-risk corridors yields greater safety returns per dollar spent**.

If you'd like, you can propose this as a formal citizen point on the deliberation map. It would be reviewed by the municipality's Citizen Engagement Coordinator and, if approved, added to the argument thread alongside the committee's own discussion.`,
};

export const institutionalMemoryResponse = `Based on a search across council meeting transcripts from 2024–2026, here are the most relevant moments where councillors discussed **institutional memory** or the challenge of lost knowledge:

### General Committee — March 11, 2026
**Councillor Chris Fonseca** raised the issue directly during the Imagine Mississauga strategic plan discussion:

> *"Every term, new councillors spend their first year learning what the previous council already figured out. We lose institutional memory every four years, and staff turnover compounds it. If this strategic plan doesn't address knowledge management, we'll be writing the same plan again in 2030."*

### Budget Committee — February 19, 2026
**Councillor Dipika Damerla** referenced the problem during debate on the infrastructure levy reduction:

> *"We reduced this same levy in 2014 and it took us three budget cycles to recover. I worry we're forgetting the lessons of the past because the people who lived through it aren't in the room anymore."*

### General Committee — January 15, 2026
During the waste collection transfer discussion, **staff** acknowledged gaps in institutional knowledge:

> *"One of the challenges with the Peel transition is that many of the operational details were managed at the regional level. As we bring these services in-house, we're effectively rebuilding knowledge that existed in a different organization."*

### Road Safety Committee — January 27, 2026
**Councillor Carolyn Parrish** made an oblique reference during the school bus camera discussion:

> *"We studied this in 2019. We studied it in 2022. Each time, the committee changes and we start from scratch. At some point we need to stop studying and start doing."*

---

**Summary:** The theme of institutional memory loss appears across multiple committees, most often in the context of:
- **Council turnover** every four years erasing informal knowledge
- **Staff transitions** creating gaps in operational continuity
- **Repeated studies** on the same issues due to lack of accessible records of prior deliberations

This is a pattern that structured deliberation records — like the ones in this system — are specifically designed to address.`;

// --- Argument Map Data for the Jan 27 meeting ---

import type { QuestionMap } from "../components/ArgumentMap";

export const roadSafetyArgumentMap: QuestionMap[] = [
  {
    id: "am-q1",
    number: "Q1",
    question:
      "How should the $2.2M provincial road safety funding be deployed?",
    status: "closed",
    claim:
      "Equitable allocation across all 11 wards (~$200K each), focused on school zones and physical traffic calming",
    nodes: [
      {
        tag: "S1",
        type: "support",
        content:
          "ASE data provides objective shortlisting — 5–6 candidate locations per ward",
        speaker: "Max Gill, Staff",
      },
      {
        tag: "S2",
        type: "support",
        content:
          "Physical traffic calming (speed cushions/bumps) is proven effective and cost-efficient",
        speaker: "Max Gill, Staff",
      },
      {
        tag: "S3",
        type: "support",
        content:
          "Equitable ward-by-ward allocation ensures all communities benefit",
        speaker: "Committee Member",
      },
      {
        tag: "N1",
        type: "negate",
        content:
          "Councillor-directed allocation might target highest-need areas more effectively",
        speaker: "Committee Member",
      },
      {
        tag: "M(N1).1",
        type: "mitigate",
        content:
          "Provincial restrictions apply regardless — councillor input is built into the shortlisting process",
        speaker: "Max Gill, Staff",
      },
    ],
    subQuestions: [
      {
        text: "Can lower-cost seasonal measures stretch the budget further?",
        speaker: "Committee Member",
        answers: [
          {
            text: "Yes — seasonal measures complement permanent infrastructure and allow 3–4 projects per ward",
            speaker: "Max Gill, Staff",
          },
        ],
      },
    ],
    referral: "→ Goes to General Committee next month",
  },
  {
    id: "am-q2",
    number: "Q2",
    question: "Should school bus stop arm cameras be revived?",
    status: "open",
    options: [
      {
        label: "O1 — Revive the program with newer, cheaper technology",
        nodes: [
          {
            tag: "S(O1).1",
            type: "support",
            content:
              "Average of 8 stop arm violations per bus per day — the problem is severe",
            speaker: "Staff",
          },
          {
            tag: "S(O1).2",
            type: "support",
            content:
              "Newer camera systems cost 60% less than the 2019 pilot technology",
            speaker: "Staff",
          },
          {
            tag: "S(O1).3",
            type: "support",
            content:
              "I personally witnessed two violations in just two weeks",
            speaker: "Sunil, Citizen Member",
          },
          {
            tag: "N(O1).1",
            type: "negate",
            content:
              "School buses are region-wide — Mississauga cannot implement cameras alone",
            speaker: "Staff",
          },
          {
            tag: "M(N(O1).1).1",
            type: "mitigate",
            content:
              "Brampton is exploring a revival — regional coordination is the path forward",
            speaker: "Councillor Tedjo",
          },
        ],
      },
    ],
    subQuestions: [
      {
        text: "Why did the original program fail?",
        speaker: "Committee Member",
        answers: [
          {
            text: "Procurement fraud by the original vendor killed the initiative around 2019",
            speaker: "Staff",
          },
          {
            text: "Other vendors likely exist now — the market has matured",
            speaker: "Committee Member",
          },
        ],
      },
    ],
    unresolved: [
      {
        text: "Regional coordination timeline — waiting on Brampton and Councillor Tedjo's regional advocacy",
      },
    ],
    referral: "→ Added to committee work plan by Monica",
  },
  {
    id: "am-q3",
    number: "Q3",
    question: "Is Road Watch awareness worth improving?",
    status: "open",
    options: [
      {
        label: "O1 — Invest in awareness and simplify the reporting process",
        nodes: [
          {
            tag: "S(O1).1",
            type: "support",
            content:
              "8.5% year-over-year growth — 3,590 reports in 2025, 2,018 sent to registered owners",
            speaker: "Staff",
          },
          {
            tag: "S(O1).2",
            type: "support",
            content:
              "Reports drive daily officer deployment — direct operational impact",
            speaker: "Staff",
          },
          {
            tag: "N(O1).1",
            type: "negate",
            content:
              "Most residents don't know Road Watch exists",
            speaker: "Committee Member",
          },
          {
            tag: "N(O1).2",
            type: "negate",
            content:
              "The reporting form is too long and people are uncomfortable sharing personal information",
            speaker: "Sunil, Citizen Member",
          },
          {
            tag: "M(N(O1).2).1",
            type: "mitigate",
            content:
              "I personally assure residents their information won't be shared — but we need process change",
            speaker: "Sunil, Citizen Member",
          },
        ],
      },
    ],
    unresolved: [
      { text: "No plan to simplify the reporting form" },
      { text: "Digital promotion strategy not yet defined" },
    ],
    referral: "→ Referred to promotional subcommittee",
  },
  {
    id: "am-q4",
    number: "Q4",
    question: "Is headlight misalignment worth addressing?",
    status: "open",
    options: [
      {
        label: "O1 — Pursue through CAA partnership and public education",
        nodes: [
          {
            tag: "S(O1).1",
            type: "support",
            content:
              "UK MOT model demonstrates successful mandatory inspection approach",
            speaker: "Committee Member",
          },
          {
            tag: "S(O1).2",
            type: "support",
            content:
              "CAA receives complaints regularly — demand for action exists",
            speaker: "CAA Representative",
          },
          {
            tag: "N(O1).1",
            type: "negate",
            content:
              "Province removed license plate renewals — no appetite for additional cost to drivers",
            speaker: "Staff",
          },
          {
            tag: "M(N(O1).1).1",
            type: "mitigate",
            content:
              "CAA can develop guidance and communicate with approved shops — no provincial action needed",
            speaker: "CAA Representative",
          },
        ],
      },
    ],
    unresolved: [{ text: "Needs a qualified presenter — not yet identified" }],
    referral: "→ Referred to promotional subcommittee",
  },
  {
    id: "am-q5",
    number: "Q5",
    question:
      "How do we increase Road Safety Committee event participation?",
    status: "open",
    options: [
      {
        label: "O1 — Improve coordination and expand outreach channels",
        nodes: [
          {
            tag: "S(O1).1",
            type: "support",
            content:
              "Only 12 of 35 planned Road Watch events met minimum attendance in 2025",
            speaker: "Staff",
          },
          {
            tag: "S(O1).2",
            type: "support",
            content:
              "Social media, neighbourhood associations, and integrating into existing events could help",
            speaker: "Committee Member",
          },
          {
            tag: "N(O1).1",
            type: "negate",
            content:
              "Councillor offices aren't providing enough lead time for volunteer coordination",
            speaker: "Committee Chair",
          },
          {
            tag: "M(N(O1).1).1",
            type: "mitigate",
            content:
              "Require 3–4 weeks' notice from councillor offices — formalize the process",
            speaker: "Committee Chair",
          },
        ],
      },
    ],
    referral: "→ Staff/Chair to issue email calls for volunteers",
  },
  {
    id: "am-q6",
    number: "Q6",
    question: "Should the committee meet more frequently?",
    status: "open",
    options: [
      {
        label: "O1 — Move to monthly meetings",
        nodes: [
          {
            tag: "S(O1).1",
            type: "support",
            content:
              "60-day gap means follow-up items wait too long",
            speaker: "Committee Member",
          },
          {
            tag: "S(O1).2",
            type: "support",
            content:
              "Recent agendas have been robust — sufficient business to justify more meetings",
            speaker: "Committee Member",
          },
          {
            tag: "N(O1).1",
            type: "negate",
            content:
              "This is an election year — committee may only meet 2–3 more times",
            speaker: "Committee Member",
          },
          {
            tag: "N(O1).2",
            type: "negate",
            content:
              "Previous rationale for less frequent meetings was lack of agenda items",
            speaker: "Staff",
          },
        ],
      },
    ],
    unresolved: [
      { text: "Decision deferred — review after March agenda" },
    ],
  },
];
