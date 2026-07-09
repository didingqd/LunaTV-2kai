'use client';

import type { ReactNode } from 'react';

interface SimpleMarkdownProps {
  content: string;
  className?: string;
}

const INLINE_MARKDOWN_PATTERN =
  /(`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*)/g;

function isSafeHref(href: string) {
  return (
    href.startsWith('/') ||
    href.startsWith('#') ||
    /^https?:\/\//i.test(href) ||
    /^mailto:/i.test(href) ||
    /^tel:/i.test(href)
  );
}

function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  INLINE_MARKDOWN_PATTERN.lastIndex = 0;
  while ((match = INLINE_MARKDOWN_PATTERN.exec(text)) !== null) {
    const [raw, , code, linkText, href, boldText, italicText] = match;
    const index = match.index;

    if (index > lastIndex) {
      nodes.push(text.slice(lastIndex, index));
    }

    const key = `${keyPrefix}-${index}`;
    if (code) {
      nodes.push(
        <code
          key={key}
          className='rounded bg-black/5 px-1 py-0.5 text-[0.92em] dark:bg-white/10'
        >
          {code}
        </code>,
      );
    } else if (linkText && href && isSafeHref(href)) {
      nodes.push(
        <a
          key={key}
          href={href}
          target={href.startsWith('http') ? '_blank' : undefined}
          rel={href.startsWith('http') ? 'noreferrer' : undefined}
          className='font-medium text-green-700 underline underline-offset-2 hover:text-green-800 dark:text-green-300 dark:hover:text-green-200'
        >
          {linkText}
        </a>,
      );
    } else if (boldText) {
      nodes.push(<strong key={key}>{boldText}</strong>);
    } else if (italicText) {
      nodes.push(<em key={key}>{italicText}</em>);
    } else {
      nodes.push(raw);
    }

    lastIndex = index + raw.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function renderLines(block: string, keyPrefix: string) {
  return block.split('\n').flatMap((line, index, lines) => {
    const nodes = renderInlineMarkdown(line, `${keyPrefix}-line-${index}`);
    if (index < lines.length - 1) {
      nodes.push(<br key={`${keyPrefix}-br-${index}`} />);
    }
    return nodes;
  });
}

export default function SimpleMarkdown({
  content,
  className = '',
}: SimpleMarkdownProps) {
  const blocks = content.trim().split(/\n{2,}/).filter(Boolean);

  return (
    <div className={className}>
      {blocks.map((block, blockIndex) => {
        const lines = block.split('\n');
        const isList = lines.every((line) => /^[-*]\s+/.test(line.trim()));

        if (isList) {
          return (
            <ul
              key={`block-${blockIndex}`}
              className='my-2 list-disc space-y-1 pl-5'
            >
              {lines.map((line, lineIndex) => (
                <li key={`block-${blockIndex}-item-${lineIndex}`}>
                  {renderInlineMarkdown(
                    line.trim().replace(/^[-*]\s+/, ''),
                    `block-${blockIndex}-item-${lineIndex}`,
                  )}
                </li>
              ))}
            </ul>
          );
        }

        return (
          <p key={`block-${blockIndex}`} className='my-2 first:mt-0 last:mb-0'>
            {renderLines(block, `block-${blockIndex}`)}
          </p>
        );
      })}
    </div>
  );
}
