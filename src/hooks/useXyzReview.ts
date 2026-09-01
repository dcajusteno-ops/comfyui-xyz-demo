import { useCallback, useRef, useState } from "react";
import type { XyzAxis, XyzAxisInsight, XyzRunItem } from "../types";
import { runXyzReview, type XyzReviewOutcome } from "../lib/xyzReview";

export type XyzReviewState = {
  reviewing: boolean;
  progress: { done: number; total: number } | null;
  scoresByUrl: Record<string, number>;
  bestUrls: string[];
  insights: XyzAxisInsight[];
  overlayOn: boolean;
  reviewedAt: number;
  outcome: XyzReviewOutcome | null;
};

const INITIAL_STATE: XyzReviewState = {
  reviewing: false,
  progress: null,
  scoresByUrl: {},
  bestUrls: [],
  insights: [],
  overlayOn: true,
  reviewedAt: 0,
  outcome: null,
};

export function useXyzReview() {
  const [state, setState] = useState<XyzReviewState>(INITIAL_STATE);
  const tokenRef = useRef(0);

  const startReview = useCallback(
    async (
      items: XyzRunItem[],
      axes: XyzAxis[],
      lorasOfTarget: { name: string; displayName?: string }[]
    ) => {
      const token = ++tokenRef.current;
      setState((prev) => ({ ...prev, reviewing: true, progress: { done: 0, total: 0 } }));
      try {
        const outcome = await runXyzReview(items, axes, lorasOfTarget, (done, total) => {
          if (tokenRef.current === token) {
            setState((prev) => ({ ...prev, progress: { done, total } }));
          }
        });
        if (tokenRef.current !== token) return;
        setState((prev) => ({
          ...prev,
          reviewing: false,
          progress: null,
          scoresByUrl: outcome.scoresByUrl,
          bestUrls: outcome.bestUrls,
          insights: outcome.insights,
          reviewedAt: Date.now(),
          outcome,
        }));
      } catch (error) {
        if (tokenRef.current !== token) return;
        setState((prev) => ({ ...prev, reviewing: false, progress: null }));
      }
    },
    []
  );

  const clearReview = useCallback(() => {
    tokenRef.current += 1;
    setState((prev) => ({ ...prev, reviewing: false, progress: null, scoresByUrl: {}, bestUrls: [], insights: [], reviewedAt: 0, outcome: null }));
  }, []);

  const toggleOverlay = useCallback(() => {
    setState((prev) => ({ ...prev, overlayOn: !prev.overlayOn }));
  }, []);

  return { ...state, startReview, clearReview, toggleOverlay };
}