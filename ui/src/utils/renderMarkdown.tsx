import { Box, Typography, Link } from "@mui/material";
import type { ReactNode } from "react";

const inlineMarkdownNodes = (text: string): ReactNode[] => {
  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const parts = text.split(
    /(\[([^\]]+)\]\(([^)]+)\)|https?:\/\/\S+|\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/,
  );

  return parts
    .filter((el) => !!el)
    .map((part, idx) => {
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      const [, label, url] = linkMatch;
      return (
        <Link
          key={`ln-${idx}`}
          href={url}
          target="_blank"
          rel="noreferrer"
          underline="hover"
        >
          {label}
        </Link>
      );
    }

    const autoLink = part.match(/^https?:\/\/\S+$/);
    if (autoLink) {
      return (
        <Link
          key={`al-${idx}`}
          href={autoLink[0]}
          target="_blank"
          rel="noreferrer"
          underline="hover"
        >
          {autoLink[0]}
        </Link>
      );
    }

    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <Box component="strong" key={`b-${idx}`} sx={{ fontWeight: 700 }}>
          {part.slice(2, -2)}
        </Box>
      );
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <Box
          component="code"
          key={`c-${idx}`}
          sx={{
            bgcolor: "grey.100",
            borderRadius: 0.75,
            px: 0.75,
            py: 0.25,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: "0.9em",
          }}
        >
          {part.slice(1, -1)}
        </Box>
      );
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      return (
        <Box component="em" key={`i-${idx}`} sx={{ fontStyle: "italic" }}>
          {part.slice(1, -1)}
        </Box>
      );
    }
    return <span key={`t-${idx}`}>{escape(part)}</span>;
    });
};

export const renderMarkdown = (md: string): ReactNode[] => {
  const lines = md.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  let inCode = false;
  let codeLines: string[] = [];

  const flushList = () => {
    if (!list.length) return;
    blocks.push(
      <Box
        component="ul"
        key={`list-${blocks.length}`}
        sx={{ pl: 3, my: 0.5, color: "text.primary" }}
      >
        {list.map((item, idx) => (
          <Box component="li" key={`li-${idx}`} sx={{ mb: 0.5 }}>
            <Typography variant="body2" component="span">
              {inlineMarkdownNodes(item)}
            </Typography>
          </Box>
        ))}
      </Box>,
    );
    list = [];
  };

  const flushCode = () => {
    if (!codeLines.length) return;
    blocks.push(
      <Box
        key={`code-${blocks.length}`}
        component="pre"
        sx={{
          bgcolor: "grey.100",
          borderRadius: 1.25,
          p: 1.25,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: "0.9em",
          overflow: "auto",
          border: "1px solid",
          borderColor: "grey.200",
        }}
      >
        <code>{codeLines.join("\n")}</code>
      </Box>,
    );
    codeLines = [];
  };

  lines.forEach((rawLine) => {
    const line = rawLine.trimEnd();

    if (line.startsWith("```")) {
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        flushList();
        inCode = true;
      }
      return;
    }

    if (inCode) {
      codeLines.push(rawLine);
      return;
    }

    if (!line.trim()) {
      flushList();
      return;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushList();
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      const variant =
        level <= 2
          ? "h6"
          : level === 3
            ? "subtitle1"
            : "subtitle2";
      blocks.push(
        <Typography
          key={`h-${blocks.length}`}
          variant={variant as "h6" | "subtitle1" | "subtitle2"}
          fontWeight={700}
          sx={{ mt: 0.75 }}
        >
          {inlineMarkdownNodes(text)}
        </Typography>,
      );
      return;
    }

    const listMatch = line.match(/^[-*]\s+(.*)$/);
    if (listMatch) {
      list.push(listMatch[1]);
      return;
    }

    flushList();
    blocks.push(
      <Typography
        key={`p-${blocks.length}`}
        variant="body2"
        sx={{ lineHeight: 1.6, whiteSpace: "pre-wrap", mb: 0.75 }}
      >
        {inlineMarkdownNodes(line)}
      </Typography>,
    );
  });

  flushList();
  flushCode();

  return blocks;
};
