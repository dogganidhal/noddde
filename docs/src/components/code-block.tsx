import {
  CodeBlock as FumaCodeBlock,
  Pre,
  type CodeBlockProps,
} from "fumadocs-ui/components/codeblock";
import { isValidElement } from "react";
import type { HTMLAttributes, ReactElement, ReactNode } from "react";

const LANGUAGE_LABELS: Record<string, string> = {
  ts: "TypeScript",
  typescript: "TypeScript",
  tsx: "TypeScript",
  js: "JavaScript",
  javascript: "JavaScript",
  jsx: "JavaScript",
  json: "JSON",
  bash: "Shell",
  sh: "Shell",
  shell: "Shell",
  zsh: "Shell",
  console: "Shell",
  yaml: "YAML",
  yml: "YAML",
  toml: "TOML",
  md: "Markdown",
  mdx: "MDX",
  sql: "SQL",
  html: "HTML",
  css: "CSS",
  prisma: "Prisma schema",
  graphql: "GraphQL",
  dockerfile: "Dockerfile",
  diff: "Diff",
  txt: "Text",
  text: "Text",
};

function extractLanguage(children: ReactNode): string | undefined {
  if (!isValidElement(children)) return;
  const props = (children as ReactElement<{ className?: string }>).props;
  const className = props?.className;
  if (typeof className !== "string") return;
  const match = /language-(\w+)/.exec(className);
  return match?.[1];
}

export function PreWithTitle({
  title,
  children,
  icon,
  ...props
}: HTMLAttributes<HTMLPreElement> & CodeBlockProps) {
  const language = extractLanguage(children);
  const resolvedTitle =
    title ?? (language ? LANGUAGE_LABELS[language] ?? language : undefined);

  return (
    <FumaCodeBlock {...props} title={resolvedTitle} icon={icon}>
      <Pre>{children}</Pre>
    </FumaCodeBlock>
  );
}
