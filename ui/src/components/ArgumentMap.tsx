// Threaded argument map component
// Inspired by the Louie thread-negation-game design

export type ArgNode = {
  tag: string;
  type: "support" | "negate" | "mitigate";
  content: string;
  speaker?: string;
  timestamp?: string;
};

export type SubQuestion = {
  text: string;
  speaker?: string;
  answers: { text: string; speaker?: string }[];
};

export type ArgOption = {
  label: string;
  nodes: ArgNode[];
};

export type UnresolvedItem = {
  text: string;
};

export type QuestionMap = {
  id: string;
  number: string;
  question: string;
  status: "open" | "closed";
  claim?: string; // for closed questions
  options?: ArgOption[];
  nodes?: ArgNode[]; // for closed questions (no options)
  subQuestions?: SubQuestion[];
  unresolved?: UnresolvedItem[];
  referral?: string;
};

// Build a human-readable tooltip for a node tag
const buildTooltip = (node: ArgNode, parentOption?: string): string => {
  const shortOption = parentOption
    ? parentOption.replace(/^O\d+\s*—\s*/, "").toLowerCase()
    : "";

  switch (node.type) {
    case "support":
      return shortOption
        ? `Supports "${shortOption}"`
        : "Supports the main claim";
    case "negate":
      return shortOption
        ? `Disputes "${shortOption}"`
        : "Disputes the main claim";
    case "mitigate": {
      // Parse what it mitigates from the tag, e.g. M(N1).1 mitigates N1
      const mitigates = node.tag.match(/M\(([^)]+)\)/);
      if (mitigates) {
        const target = mitigates[1];
        if (target.startsWith("N")) {
          return `Mitigates the objection (${target}) by offering a counterpoint`;
        }
        return `Mitigates ${target}`;
      }
      return "Mitigates a prior point";
    }
  }
};

const NodeRow = ({
  node,
  parentOption,
}: {
  node: ArgNode;
  parentOption?: string;
}) => {
  const typeClass =
    node.type === "support"
      ? "am-node-s"
      : node.type === "negate"
        ? "am-node-n"
        : "am-node-m";

  const tooltip = buildTooltip(node, parentOption);

  return (
    <div className={`am-node ${typeClass}`}>
      <div className="am-node-tag" title={tooltip}>
        {node.tag}
      </div>
      <div className="am-node-content">
        {node.content}
        {node.speaker && (
          <div className="am-node-speaker">
            {node.speaker}
            {node.timestamp ? ` · ${node.timestamp}` : ""}
          </div>
        )}
      </div>
    </div>
  );
};

const QuestionBlock = ({ q }: { q: QuestionMap }) => {
  return (
    <div className="am-question-block">
      <div className="am-question-header">
        <div className="am-question-number">{q.number}</div>
        <div className="am-question-text">{q.question}</div>
        <div
          className={`am-question-status ${q.status === "closed" ? "am-status-closed" : "am-status-open"}`}
        >
          {q.status === "closed" ? "Resolved" : "Open"}
        </div>
      </div>
      <div className="am-question-body">
        {q.claim && <div className="am-claim-block">{q.claim}</div>}

        {/* Closed question nodes (no options) */}
        {q.nodes &&
          q.nodes.map((node, i) => <NodeRow key={i} node={node} />)}

        {/* Options */}
        {q.options &&
          q.options.map((opt, oi) => (
            <div key={oi} className="am-option-block">
              {oi > 0 && <div className="am-option-divider" />}
              <div className="am-option-label">{opt.label}</div>
              {opt.nodes.map((node, ni) => (
                <NodeRow key={ni} node={node} parentOption={opt.label} />
              ))}
            </div>
          ))}

        {/* Sub-questions */}
        {q.subQuestions &&
          q.subQuestions.map((sq, si) => (
            <div key={si} className="am-subq-block">
              <div className="am-subq-label">Sub-question</div>
              <div className="am-subq-text">
                {sq.text}
                {sq.speaker && (
                  <span className="am-subq-speaker"> — {sq.speaker}</span>
                )}
              </div>
              {sq.answers.map((a, ai) => (
                <div key={ai} className="am-subq-answer">
                  {a.text}
                  {a.speaker && (
                    <span className="am-subq-speaker"> — {a.speaker}</span>
                  )}
                </div>
              ))}
            </div>
          ))}

        {/* Unresolved */}
        {q.unresolved && q.unresolved.length > 0 && (
          <div className="am-unresolved-block">
            <div className="am-unresolved-label">Unresolved</div>
            {q.unresolved.map((u, ui) => (
              <div key={ui} className="am-unresolved-item">
                {u.text}
              </div>
            ))}
          </div>
        )}

        {/* Referral */}
        {q.referral && <div className="am-referral-note">{q.referral}</div>}
      </div>
    </div>
  );
};

type Props = {
  title?: string;
  subtitle?: string;
  questions: QuestionMap[];
};

const ArgumentMap = ({ title, subtitle, questions }: Props) => {
  return (
    <div className="am-container">
      {(title || subtitle) && (
        <div className="am-header">
          {title && <h2 className="am-title">{title}</h2>}
          {subtitle && <div className="am-subtitle">{subtitle}</div>}
        </div>
      )}
      <div className="am-section-label">
        <span>Argument Map</span>
      </div>
      {questions.map((q) => (
        <QuestionBlock key={q.id} q={q} />
      ))}
    </div>
  );
};

export default ArgumentMap;
