import React from "react";

export function handlePromptWeightAdjustment(
  e: React.KeyboardEvent<HTMLTextAreaElement>,
  value: string,
  onChange: (val: string) => void
) {
  if ((e.ctrlKey || e.metaKey) && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
    e.preventDefault();
    const delta = e.key === "ArrowUp" ? 0.1 : -0.1;
    const target = e.target as HTMLTextAreaElement;
    let start = target.selectionStart;
    let end = target.selectionEnd;
    const text = value;

    const regex = /\(([^:()]+):([0-9.]+)\)/g;
    let match;
    let foundMatch = null;
    while ((match = regex.exec(text)) !== null) {
      const matchStart = match.index;
      const matchEnd = matchStart + match[0].length;
      if (start >= matchStart && start <= matchEnd) {
        foundMatch = { matchStart, matchEnd, word: match[1], weight: parseFloat(match[2]) };
        break;
      }
    }

    if (foundMatch) {
      let newWeight = Math.round((foundMatch.weight + delta) * 100) / 100;
      let newStr = newWeight === 1.0 ? foundMatch.word : `(${foundMatch.word}:${newWeight})`;
      const newText = text.slice(0, foundMatch.matchStart) + newStr + text.slice(foundMatch.matchEnd);
      onChange(newText);
      setTimeout(() => {
        target.setSelectionRange(foundMatch.matchStart, foundMatch.matchStart + newStr.length);
      }, 0);
      return;
    }

    if (start === end) {
      const isSpaceOrBoundary = (char?: string) => !char || /[\s,()\n]/.test(char);
      if (isSpaceOrBoundary(text[start - 1]) && isSpaceOrBoundary(text[start])) {
        return;
      }

      while (start > 0 && !/[,()\n]/.test(text[start - 1])) start--;
      while (end < text.length && !/[,()\n]/.test(text[end])) end++;
      
      while (start < end && /\s/.test(text[start])) start++;
      while (end > start && /\s/.test(text[end - 1])) end--;
      
      if (start === end) return;
    }

    let selected = text.slice(start, end);
    if (selected.startsWith('(') && selected.endsWith(')')) {
      selected = selected.slice(1, -1);
    }

    let weight = Math.round((1.0 + delta) * 100) / 100;
    let newStr = weight === 1.0 ? selected : `(${selected}:${weight})`;
    
    const newText = text.slice(0, start) + newStr + text.slice(end);
    onChange(newText);
    
    setTimeout(() => {
      target.setSelectionRange(start, start + newStr.length);
    }, 0);
  }
}

export interface PromptTag {
  text: string;
  word: string;
  weight: number;
  start: number;
  end: number;
}

export function parsePromptTags(text: string): PromptTag[] {
  const tags: PromptTag[] = [];
  let depth = 0;
  let start = 0;
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    
    if (char === '\\' && (text[i + 1] === '(' || text[i + 1] === ')')) {
      i++; 
      continue;
    }
    
    if (char === '(') depth++;
    else if (char === ')') depth = Math.max(0, depth - 1);
    else if (char === ',' && depth === 0) {
      const chunk = text.slice(start, i);
      processChunk(chunk, start, tags);
      start = i + 1;
    }
  }
  
  if (start < text.length) {
    const chunk = text.slice(start);
    processChunk(chunk, start, tags);
  }
  
  return tags;
}

function processChunk(chunk: string, offset: number, tags: PromptTag[]) {
  let trimStart = 0;
  while (trimStart < chunk.length && /\s/.test(chunk[trimStart])) trimStart++;
  let trimEnd = chunk.length;
  while (trimEnd > trimStart && /\s/.test(chunk[trimEnd - 1])) trimEnd--;
  
  if (trimStart === trimEnd) return;
  
  const selected = chunk.slice(trimStart, trimEnd);
  const match = selected.match(/^\((.+):([0-9.]+)\)$/);
  
  let word = selected;
  let weight = 1.0;
  
  if (match) {
    word = match[1];
    weight = parseFloat(match[2]);
  } else if (selected.startsWith('(') && selected.endsWith(')')) {
    word = selected.slice(1, -1);
  }
  
  tags.push({
    text: selected,
    word,
    weight,
    start: offset + trimStart,
    end: offset + trimEnd,
  });
}

export function adjustWeightForTag(text: string, tag: PromptTag, delta: number): string {
  let newWeight = Math.round((tag.weight + delta) * 100) / 100;
  let newStr = newWeight === 1.0 ? tag.word : `(${tag.word}:${newWeight})`;
  return text.slice(0, tag.start) + newStr + text.slice(tag.end);
}

