import { kittyRequest } from "./managedBridge";
import type { Citation, KittyRequest, WebSource } from "./types";

export type SearchResults = {
  provider: string;
  sources: WebSource[];
  notice?: string;
};
export function searchForSelection(request: KittyRequest, signal: AbortSignal) {
  const query = [request.question?.trim(), request.text.trim().slice(0, 240)]
    .filter(Boolean)
    .join(" ")
    .slice(0, 400);
  return kittyRequest<SearchResults>("web-search", { query }, () => {}, signal);
}
export function sourceCitations(
  text: string,
  sources: WebSource[],
): Citation[] {
  return [...text.matchAll(/\[(\d+)\]/g)].flatMap((match) => {
    const source = sources[Number(match[1]) - 1];
    return source
      ? [
          {
            url: source.url,
            title: source.title,
            start: match.index!,
            end: match.index! + match[0].length,
          },
        ]
      : [];
  });
}
