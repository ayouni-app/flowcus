'use client';

/**
 * Flowline — single-file deep work + exercise scheduler.
 *
 * RULES
 * 1. Target 6 hours of deep work.
 * 2. Focus blocks prefer 90 minutes.
 * 3. Smaller focus blocks are allowed when 90m cannot be packed efficiently.
 * 4. Rest after each focus block is at least 18% of that block.
 * 5. Exercise is ONE continuous block.
 * 6. Exercise is 30–60 minutes.
 * 7. 30 minutes is the minimum exercise allocation.
 * 8. 60 minutes is preferred only when it does not unnecessarily reduce
 *    deep-work time.
 * 9. Exercise should occur 5–6 hours before bedtime.
 * 10. Exercise is placed as close as possible to 6 hours before bedtime.
 * 11. Exercise may be scheduled when at least 90 TOTAL minutes of
 *     deep work remain after exercise.
 * 12. The 90-minute requirement is NOT a hard requirement for one block.
 *     For example, 3 × 30m of deep work = 90m total and can coexist
 *     with 30m exercise.
 * 13. Deep work is optimized before exercise duration.
 * 14. Exercise does not count toward the 6-hour deep-work target.
 *
 * Drop this into app/page.tsx.
 *
 * Requires:
 *   framer-motion
 *   lucide-react
 *
 * No external CSS or Tailwind.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  AlertCircle,
  Check,
  Coffee,
  Clock,
  Dumbbell,
  Edit3,
  Moon,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  TrendingUp,
  X,
  Trash2,
} from 'lucide-react';

import {
  AnimatePresence,
  motion,
} from 'framer-motion';

/* ============================================================================
   TYPES
============================================================================ */

type BlockStatus =
  | 'upcoming'
  | 'active'
  | 'completed'
  | 'interrupted';

type TimelineItemType =
  | 'focus'
  | 'exercise';

interface FreeRange {
  id: string;
  start: string;
  end: string;
}

interface FocusBlock {
  id: string;
  type: 'focus';
  start: number;
  end: number;
  duration: number;
  status: BlockStatus;
  startedAt: number | null;
  actualMinutes: number | null;
}

interface ExerciseBlock {
  id: string;
  type: 'exercise';
  start: number;
  end: number;
  duration: number;
  status: BlockStatus;
  startedAt: number | null;
  actualMinutes: number | null;
}

type TimelineBlock =
  | FocusBlock
  | ExerciseBlock;

interface DayState {
  date: string;
  sleepTime: string;
  freeRanges: FreeRange[];
  blocks: TimelineBlock[];
  onboarded: boolean;
}

interface RawRange {
  start: number;
  end: number;
}

/* ============================================================================
   CONSTANTS
============================================================================ */

const STORAGE_KEY =
  'flowline_day_state_v2';

const IDEAL_BLOCK = 90;
const DAILY_TARGET = 360;

const GAP_RATIO = 0.18;
const MIN_BLOCK = 15;

/* Exercise */
const EXERCISE_MIN = 30;
const EXERCISE_MAX = 60;

const EXERCISE_NEAREST_SLEEP_HOURS = 6;
const EXERCISE_FARTHEST_SLEEP_HOURS = 5;

const EXERCISE_NEAREST_SLEEP_MINUTES =
  EXERCISE_NEAREST_SLEEP_HOURS * 60;

const EXERCISE_FARTHEST_SLEEP_MINUTES =
  EXERCISE_FARTHEST_SLEEP_HOURS * 60;

/* ============================================================================
   COLORS
============================================================================ */

const COLORS = {
  bg: '#12141C',
  surface: '#1A1D29',
  surfaceRaised: '#20242F',

  border: 'rgba(255,255,255,0.08)',
  borderSoft: 'rgba(255,255,255,0.05)',

  textPrimary: '#F2F1ED',
  textSecondary: '#9096AC',
  textTertiary: '#5C6178',

  amber: '#E8A94C',
  amberSoft: 'rgba(232,169,76,0.14)',

  teal: '#5EC8C0',
  tealSoft: 'rgba(94,200,192,0.12)',

  green: '#6FCF97',
  greenSoft: 'rgba(111,207,151,0.12)',

  coral: '#E8615C',
  coralSoft: 'rgba(232,97,92,0.12)',

  exercise: '#8D7BE8',
  exerciseSoft: 'rgba(141,123,232,0.13)',
};

/* ============================================================================
   TIME HELPERS
============================================================================ */

function pad2(n: number): string {
  return Math.max(0, Math.trunc(n))
    .toString()
    .padStart(2, '0');
}

function timeStrToMinutes(
  t: string
): number {
  const parts = t.split(':');

  const h = Number(parts[0]) || 0;
  const m = Number(parts[1]) || 0;

  return h * 60 + m;
}

function minutesToTimeStr(
  mins: number
): string {
  const m =
    ((Math.round(mins) % 1440) + 1440) %
    1440;

  return `${pad2(Math.floor(m / 60))}:${pad2(
    m % 60
  )}`;
}

function formatClock12(
  mins: number
): string {
  const m =
    ((Math.round(mins) % 1440) + 1440) %
    1440;

  let h = Math.floor(m / 60);

  const mm = m % 60;

  const ampm = h >= 12 ? 'PM' : 'AM';

  h %= 12;

  if (h === 0) {
    h = 12;
  }

  return `${h}:${pad2(mm)} ${ampm}`;
}

function formatDuration(
  mins: number
): string {
  const m = Math.round(mins);

  if (m < 60) {
    return `${m}m`;
  }

  const h = Math.floor(m / 60);
  const rem = m % 60;

  if (rem === 0) {
    return `${h}h`;
  }

  return `${h}h ${rem}m`;
}

function formatCountdown(
  totalSeconds: number
): string {
  const s = Math.max(
    0,
    Math.round(totalSeconds)
  );

  const m = Math.floor(s / 60);
  const sec = s % 60;

  return `${m}:${pad2(sec)}`;
}

function todayKey(d: Date): string {
  return [
    d.getFullYear(),
    pad2(d.getMonth() + 1),
    pad2(d.getDate()),
  ].join('-');
}

function currentMinutes(
  d: Date = new Date()
): number {
  return (
    d.getHours() * 60 +
    d.getMinutes()
  );
}

function greetingFor(
  nowMin: number
): string {
  if (nowMin < 12 * 60) {
    return 'Good morning';
  }

  if (nowMin < 18 * 60) {
    return 'Good afternoon';
  }

  return 'Good evening';
}

/* ============================================================================
   IDS
============================================================================ */

let idCounter = 0;

function genId(): string {
  idCounter += 1;

  return `${Date.now().toString(36)}-${idCounter}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

/* ============================================================================
   RANGE HELPERS
============================================================================ */

function mergeRanges(
  ranges: RawRange[]
): RawRange[] {
  const valid = ranges
    .filter(
      (r) => r.end - r.start >= 1
    )
    .sort(
      (a, b) => a.start - b.start
    );

  const merged: RawRange[] = [];

  for (const r of valid) {
    const last =
      merged[merged.length - 1];

    if (
      last &&
      r.start <= last.end
    ) {
      last.end = Math.max(
        last.end,
        r.end
      );
    } else {
      merged.push({
        start: r.start,
        end: r.end,
      });
    }
  }

  return merged;
}

/* ============================================================================
   FOCUS PACKING
============================================================================ */

/**
 * Packs focus sessions.
 *
 * Priority:
 * - Prefer 90m blocks.
 * - Respect 18% recovery gap after each focus block.
 * - Allow shorter blocks when a 90m block cannot fit.
 * - Never create blocks shorter than 15m.
 *
 * This intentionally does NOT require one 90m block.
 *
 * Example:
 *
 * 2h available
 * -> 90m + 30m
 *
 * Multiple separate windows can also produce:
 *
 * 30m + 30m + 30m
 */
function packFocusRanges(
  ranges: RawRange[],
  targetTotal: number
): RawRange[] {
  let remaining = Math.max(
    0,
    targetTotal
  );

  const out: RawRange[] = [];

  for (const range of ranges) {
    let cursor = range.start;

    while (
      cursor < range.end &&
      remaining >= MIN_BLOCK
    ) {
      const availableHere =
        range.end - cursor;

      if (
        availableHere <
        MIN_BLOCK
      ) {
        break;
      }

      let duration: number;

      /*
       * Prefer 90 minutes whenever
       * the current window and target
       * can support it.
       */
      if (
        remaining >= IDEAL_BLOCK &&
        availableHere >= IDEAL_BLOCK
      ) {
        duration = IDEAL_BLOCK;
      } else {
        /*
         * Otherwise use the available
         * amount as a smaller final block.
         */
        duration = Math.min(
          remaining,
          availableHere
        );
      }

      if (duration < MIN_BLOCK) {
        break;
      }

      out.push({
        start: cursor,
        end: cursor + duration,
      });

      remaining -= duration;

      const gap = Math.ceil(
        duration * GAP_RATIO
      );

      cursor +=
        duration + gap;
    }

    if (remaining < MIN_BLOCK) {
      break;
    }
  }

  return out;
}

/* ============================================================================
   RANGE SUBTRACTION
============================================================================ */

function subtractRange(
  ranges: RawRange[],
  blocked: RawRange
): RawRange[] {
  const result: RawRange[] = [];

  for (const range of ranges) {
    /*
     * No overlap.
     */
    if (
      blocked.end <= range.start ||
      blocked.start >= range.end
    ) {
      result.push({
        start: range.start,
        end: range.end,
      });

      continue;
    }

    /*
     * Left fragment.
     */
    if (
      blocked.start > range.start
    ) {
      result.push({
        start: range.start,
        end: Math.min(
          blocked.start,
          range.end
        ),
      });
    }

    /*
     * Right fragment.
     */
    if (
      blocked.end < range.end
    ) {
      result.push({
        start: Math.max(
          blocked.end,
          range.start
        ),
        end: range.end,
      });
    }
  }

  return result.filter(
    (r) =>
      r.end - r.start >= MIN_BLOCK
  );
}

/* ============================================================================
   FOCUS BLOCK HELPERS
============================================================================ */

function rawFocusToBlocks(
  ranges: RawRange[]
): FocusBlock[] {
  return ranges.map((range) => ({
    id: genId(),
    type: 'focus',
    start: range.start,
    end: range.end,
    duration:
      range.end - range.start,
    status: 'upcoming',
    startedAt: null,
    actualMinutes: null,
  }));
}

function focusMinutes(
  blocks: FocusBlock[]
): number {
  return blocks.reduce(
    (sum, block) =>
      sum + block.duration,
    0
  );
}

/* ============================================================================
   EXERCISE CANDIDATES
============================================================================ */

/**
 * Generates possible exercise placements.
 *
 * The entire exercise interval must fit inside:
 *
 *     sleep - 6h
 * to
 *     sleep - 5h
 *
 * This gives:
 *
 * 60m:
 *     exactly the 6h -> 5h window
 *
 * 45m:
 *     can move slightly inside the window
 *
 * 30m:
 *     can move more freely while still remaining
 *     inside the desired timing window.
 */
function findExerciseCandidates(
  freeRanges: RawRange[],
  sleepMin: number
): {
  start: number;
  duration: number;
}[] {
  const earliestStart =
    sleepMin -
    EXERCISE_NEAREST_SLEEP_MINUTES;

  const latestEnd =
    sleepMin -
    EXERCISE_FARTHEST_SLEEP_MINUTES;

  const durations = [
    EXERCISE_MAX,
    45,
    EXERCISE_MIN,
  ];

  const candidates: {
    start: number;
    duration: number;
  }[] = [];

  for (const duration of durations) {
    for (const range of freeRanges) {
      const minimumStart =
        Math.max(
          range.start,
          earliestStart
        );

      const maximumStart =
        Math.min(
          range.end - duration,
          latestEnd - duration
        );

      if (
        maximumStart <
        minimumStart
      ) {
        continue;
      }

      /*
       * Candidate closest to the
       * 6-hour point.
       */
      const targetStart =
        earliestStart;

      const targetStartClamped =
        Math.min(
          maximumStart,
          Math.max(
            minimumStart,
            targetStart
          )
        );

      candidates.push({
        start: targetStartClamped,
        duration,
      });

      /*
       * Also test both boundaries.
       * This helps when free windows
       * partially overlap the ideal
       * exercise window.
       */
      if (
        minimumStart !==
        targetStartClamped
      ) {
        candidates.push({
          start: minimumStart,
          duration,
        });
      }

      if (
        maximumStart !==
        targetStartClamped
      ) {
        candidates.push({
          start: maximumStart,
          duration,
        });
      }
    }
  }

  /*
   * Remove duplicate candidates.
   */
  const unique = new Map<
    string,
    {
      start: number;
      duration: number;
    }
  >();

  for (const candidate of candidates) {
    unique.set(
      `${candidate.start}-${candidate.duration}`,
      candidate
    );
  }

  return Array.from(
    unique.values()
  );
}

/* ============================================================================
   EXERCISE + FOCUS OPTIMIZATION
============================================================================ */

/**
 * The scheduler evaluates the complete day.
 *
 * Important change:
 *
 * We NO LONGER require a single 90m
 * focus block before exercise can exist.
 *
 * Instead:
 *
 * 1. Exercise must be at least 30m.
 * 2. After exercise, at least 90 TOTAL
 *    minutes of focus must remain.
 * 3. Deep-work minutes are optimized first.
 * 4. If deep-work totals are equal,
 *    longer exercise is preferred.
 * 5. If still equal,
 *    exercise closer to 6h before sleep wins.
 *
 * Therefore:
 *
 * 2h free:
 *     90m focus + 30m exercise
 *
 * 2h 30m free:
 *     90m focus + 60m exercise
 *     when this preserves the best
 *     available focus allocation.
 *
 * 3 × 30m focus windows:
 *     30m + 30m + 30m focus
 *     + 30m exercise
 *
 * is valid.
 */
function buildOptimizedSchedule(
  availableRanges: RawRange[],
  sleepMin: number,
  targetTotal: number
): TimelineBlock[] {
  const baseFocusRanges =
    packFocusRanges(
      availableRanges,
      targetTotal
    );

  const baseFocusBlocks =
    rawFocusToBlocks(
      baseFocusRanges
    );

  const baseFocusMinutes =
    focusMinutes(
      baseFocusBlocks
    );

  const candidates =
    findExerciseCandidates(
      availableRanges,
      sleepMin
    );

  let best:
    | {
        exercise: ExerciseBlock;
        focus: FocusBlock[];
        focusMinutes: number;
        exerciseMinutes: number;
        timingDistance: number;
      }
    | null = null;

  const targetExerciseStart =
    sleepMin -
    EXERCISE_NEAREST_SLEEP_MINUTES;

  for (const candidate of candidates) {
    const afterExercise =
      subtractRange(
        availableRanges,
        {
          start: candidate.start,
          end:
            candidate.start +
            candidate.duration,
        }
      );

    const focusRanges =
      packFocusRanges(
        afterExercise,
        targetTotal
      );

    const focusBlocks =
      rawFocusToBlocks(
        focusRanges
      );

    const totalFocus =
      focusMinutes(
        focusBlocks
      );

    /*
     * Hard minimum:
     *
     * Exercise is only worth adding
     * when at least 90 TOTAL minutes
     * of deep work remain.
     *
     * This is total deep work, NOT
     * one continuous 90m block.
     */
    if (
      totalFocus < IDEAL_BLOCK
    ) {
      continue;
    }

    const exercise: ExerciseBlock =
      {
        id: genId(),
        type: 'exercise',
        start: candidate.start,
        end:
          candidate.start +
          candidate.duration,
        duration:
          candidate.duration,
        status: 'upcoming',
        startedAt: null,
        actualMinutes: null,
      };

    const timingDistance =
      Math.abs(
        candidate.start -
          targetExerciseStart
      );

    const current = {
      exercise,
      focus: focusBlocks,
      focusMinutes: totalFocus,
      exerciseMinutes:
        candidate.duration,
      timingDistance,
    };

    /*
     * Optimization hierarchy:
     *
     * 1. Maximize deep-work minutes.
     * 2. If equal, maximize exercise duration.
     * 3. If equal, get closer to 6h before sleep.
     */
    if (!best) {
      best = current;
      continue;
    }

    if (
      current.focusMinutes >
      best.focusMinutes
    ) {
      best = current;
      continue;
    }

    if (
      current.focusMinutes <
      best.focusMinutes
    ) {
      continue;
    }

    if (
      current.exerciseMinutes >
      best.exerciseMinutes
    ) {
      best = current;
      continue;
    }

    if (
      current.exerciseMinutes <
      best.exerciseMinutes
    ) {
      continue;
    }

    if (
      current.timingDistance <
      best.timingDistance
    ) {
      best = current;
    }
  }

  /*
   * No valid exercise placement.
   *
   * In this case we simply return
   * the best focus-only schedule.
   */
  if (!best) {
    return baseFocusBlocks.sort(
      (a, b) => a.start - b.start
    );
  }

  /*
   * If adding exercise would reduce
   * focus below the minimum threshold,
   * it was already rejected above.
   *
   * Otherwise use the optimized result.
   */
  return [
    ...best.focus,
    best.exercise,
  ].sort(
    (a, b) => a.start - b.start
  );
}

/* ============================================================================
   BUILD SCHEDULE
============================================================================ */

function buildSchedule(
  freeRanges: FreeRange[],
  sleepTime: string,
  nowMin: number,
  targetTotal: number
): TimelineBlock[] {
  const sleepMin =
    timeStrToMinutes(
      sleepTime
    );

  let availableRanges: RawRange[] =
    freeRanges
      .map((r) => ({
        start: Math.max(
          timeStrToMinutes(
            r.start
          ),
          nowMin
        ),
        end: Math.min(
          timeStrToMinutes(
            r.end
          ),
          sleepMin
        ),
      }))
      .filter(
        (r) =>
          r.end - r.start >=
          MIN_BLOCK
      );

  availableRanges =
    mergeRanges(
      availableRanges
    );

  return buildOptimizedSchedule(
    availableRanges,
    sleepMin,
    Math.max(0, targetTotal)
  );
}

/* ============================================================================
   RECOMPUTE SCHEDULE
============================================================================ */

/**
 * Keeps completed/interrupted/active history
 * and rebuilds upcoming work.
 */
function recalcSchedule(
  state: DayState,
  nowMin: number
): TimelineBlock[] {
  const kept =
    state.blocks.filter(
      (b) =>
        b.status !== 'upcoming'
    );

  const doneMinutes =
    kept.reduce(
      (sum, b) => {
        if (
          b.type !== 'focus'
        ) {
          return sum;
        }

        if (
          b.status === 'active'
        ) {
          return sum;
        }

        return (
          sum +
          (b.actualMinutes ??
            b.duration)
        );
      },
      0
    );

  const activeBlock =
    kept.find(
      (b) =>
        b.status === 'active'
    );

  const startFrom =
    activeBlock
      ? Math.max(
          activeBlock.end,
          nowMin
        )
      : nowMin;

  const remainingTarget =
    Math.max(
      0,
      DAILY_TARGET -
        doneMinutes
    );

  /*
   * If an exercise has already
   * been completed or interrupted,
   * do not automatically create
   * another exercise block.
   */
  const exerciseAlreadyUsed =
    kept.some(
      (b) =>
        b.type ===
        'exercise'
    );

  const upcomingRanges =
    state.freeRanges
      .map((r) => ({
        id: r.id,
        start: minutesToTimeStr(
          Math.max(
            timeStrToMinutes(
              r.start
            ),
            startFrom
          )
        ),
        end: minutesToTimeStr(
          timeStrToMinutes(
            r.end
          )
        ),
      }))
      .filter(
        (r) =>
          timeStrToMinutes(
            r.end
          ) >
          timeStrToMinutes(
            r.start
          )
      );

  let fresh: TimelineBlock[] =
    [];

  if (
    exerciseAlreadyUsed
  ) {
    /*
     * Once exercise has been
     * completed/interrupted, only
     * rebuild focus.
     */
    const focusOnlyRanges =
      upcomingRanges
        .map((r) => ({
          start:
            timeStrToMinutes(
              r.start
            ),
          end:
            timeStrToMinutes(
              r.end
            ),
        }));

    const merged =
      mergeRanges(
        focusOnlyRanges
      );

    const focus =
      packFocusRanges(
        merged,
        remainingTarget
      );

    fresh =
      rawFocusToBlocks(
        focus
      );
  } else {
    fresh =
      buildSchedule(
        upcomingRanges,
        state.sleepTime,
        startFrom,
        remainingTarget
      );
  }

  return [
    ...kept,
    ...fresh,
  ].sort(
    (a, b) =>
      a.start - b.start
  );
}

/* ============================================================================
   DEFAULT RANGE
============================================================================ */

function defaultFirstRange(
  nowMin: number
): FreeRange {
  const start = Math.min(
    Math.ceil(nowMin / 15) * 15,
    23 * 60
  );

  const end = Math.min(
    start + 120,
    23 * 60 + 59
  );

  return {
    id: genId(),
    start:
      minutesToTimeStr(start),
    end:
      minutesToTimeStr(end),
  };
}

/* ============================================================================
   COLORS BY STATUS
============================================================================ */

function statusColor(
  status: BlockStatus
): string {
  switch (status) {
    case 'active':
      return COLORS.amber;

    case 'completed':
      return COLORS.green;

    case 'interrupted':
      return COLORS.coral;

    default:
      return COLORS.textSecondary;
  }
}

/* ============================================================================
   STYLES
============================================================================ */

const S: Record<
  string,
  React.CSSProperties
> = {
  page: {
    minHeight: '100vh',
    width: '100%',
    background:
      `linear-gradient(180deg, ${COLORS.bg} 0%, #15171F 100%)`,
    color: COLORS.textPrimary,
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    WebkitFontSmoothing:
      'antialiased',
    display: 'flex',
    justifyContent: 'center',
    padding:
      'clamp(16px, 5vw, 32px) clamp(14px, 5vw, 24px) 48px',
  },

  container: {
    width: '100%',
    maxWidth: 480,
  },

  label: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginBottom: 8,
    display: 'block',
  },

  input: {
    background: COLORS.surface,
    border:
      `1px solid ${COLORS.border}`,
    borderRadius: 10,
    color: COLORS.textPrimary,
    fontSize: 16,
    padding: '10px 12px',
    fontFamily: 'inherit',
    fontVariantNumeric:
      'tabular-nums',
    width: '100%',
  },

  card: {
    background: COLORS.surface,
    border:
      `1px solid ${COLORS.border}`,
    borderRadius: 14,
    padding: 16,
  },

  primaryButton: {
    background: COLORS.amber,
    color: '#1A1204',
    border: 'none',
    borderRadius: 12,
    padding: '13px 18px',
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    width: '100%',
    fontFamily: 'inherit',
  },

  ghostButton: {
    background: 'transparent',
    color: COLORS.textSecondary,
    border:
      `1px solid ${COLORS.border}`,
    borderRadius: 10,
    padding: '9px 14px',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontFamily: 'inherit',
  },

  iconButton: {
    background: 'transparent',
    border: 'none',
    color: COLORS.textTertiary,
    cursor: 'pointer',
    padding: 6,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
};

/* ============================================================================
   RANGE EDITOR
============================================================================ */

function RangeEditorRow({
  range,
  onChange,
  onRemove,
  canRemove,
}: {
  range: FreeRange;
  onChange: (
    next: FreeRange
  ) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  return (
    <motion.div
      layout
      initial={{
        opacity: 0,
        height: 0,
      }}
      animate={{
        opacity: 1,
        height: 'auto',
      }}
      exit={{
        opacity: 0,
        height: 0,
      }}
      style={{
        display: 'flex',
        gap: 10,
        alignItems: 'center',
        marginBottom: 10,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          flex: 1,
        }}
      >
        <input
          type="time"
          value={range.start}
          onChange={(e) =>
            onChange({
              ...range,
              start:
                e.target.value,
            })
          }
          style={S.input}
          aria-label="Free window start"
        />
      </div>

      <span
        style={{
          color:
            COLORS.textTertiary,
          fontSize: 13,
        }}
      >
        to
      </span>

      <div
        style={{
          flex: 1,
        }}
      >
        <input
          type="time"
          value={range.end}
          onChange={(e) =>
            onChange({
              ...range,
              end:
                e.target.value,
            })
          }
          style={S.input}
          aria-label="Free window end"
        />
      </div>

      <button
        type="button"
        onClick={onRemove}
        disabled={!canRemove}
        style={{
          ...S.iconButton,
          opacity:
            canRemove ? 1 : 0.25,
          cursor:
            canRemove
              ? 'pointer'
              : 'default',
        }}
        aria-label="Remove window"
      >
        <Trash2 size={17} />
      </button>
    </motion.div>
  );
}

/* ============================================================================
   CIRCULAR TIMER
============================================================================ */

function CircularTimer({
  progress,
  size = 84,
}: {
  progress: number;
  size?: number;
}) {
  const r =
    (size - 10) / 2;

  const circumference =
    2 * Math.PI * r;

  const clamped = Math.min(
    1,
    Math.max(0, progress)
  );

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{
        transform:
          'rotate(-90deg)',
        flexShrink: 0,
      }}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={
          COLORS.borderSoft
        }
        strokeWidth={6}
        fill="none"
      />

      <motion.circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={COLORS.amber}
        strokeWidth={6}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={
          circumference
        }
        animate={{
          strokeDashoffset:
            circumference *
            (1 - clamped),
        }}
        transition={{
          duration: 0.8,
          ease: 'linear',
        }}
      />
    </svg>
  );
}

/* ============================================================================
   CONNECTOR
============================================================================ */

function ConnectorGap({
  minutes,
}: {
  minutes: number;
}) {
  const isBreak =
    minutes <= 180;

  if (minutes <= 0) {
    return null;
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding:
          '4px 0 4px 24px',
        margin: '2px 0',
      }}
    >
      <div
        style={{
          width: 1,
          alignSelf: 'stretch',
          minHeight: 18,
          background:
            COLORS.borderSoft,
        }}
      />

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          color:
            COLORS.textTertiary,
          fontSize: 12,
        }}
      >
        {isBreak ? (
          <Coffee size={13} />
        ) : (
          <Clock size={13} />
        )}

        <span>
          {isBreak
            ? `${formatDuration(
                minutes
              )} break`
            : `${formatDuration(
                minutes
              )} free`}
        </span>
      </div>
    </div>
  );
}

/* ============================================================================
   BLOCK CARD
============================================================================ */

function BlockCard({
  block,
  now,
  hasActiveElsewhere,
  onStart,
  onCompleteEarly,
  onInterrupt,
}: {
  block: TimelineBlock;
  now: number;
  hasActiveElsewhere: boolean;
  onStart: (
    id: string
  ) => void;
  onCompleteEarly: (
    id: string
  ) => void;
  onInterrupt: (
    id: string
  ) => void;
}) {
  const isExercise =
    block.type === 'exercise';

  const color = isExercise
    ? COLORS.exercise
    : statusColor(
        block.status
      );

  const isActive =
    block.status === 'active';

  const remainingSeconds =
    isActive &&
    block.startedAt != null
      ? Math.max(
          0,
          block.duration * 60 -
            (now -
              block.startedAt) /
              1000
        )
      : block.duration * 60;

  const progress =
    isActive
      ? 1 -
        remainingSeconds /
          (block.duration * 60)
      : 0;

  return (
    <motion.div
      layout
      initial={{
        opacity: 0,
        y: 8,
      }}
      animate={{
        opacity: 1,
        y: 0,
      }}
      exit={{
        opacity: 0,
        y: -8,
      }}
      transition={{
        duration: 0.25,
      }}
      style={{
        ...S.card,

        borderColor:
          isActive
            ? isExercise
              ? 'rgba(141,123,232,0.45)'
              : 'rgba(232,169,76,0.4)'
            : COLORS.border,

        background:
          isActive
            ? COLORS.surfaceRaised
            : COLORS.surface,

        boxShadow:
          isActive
            ? isExercise
              ? `0 0 0 1px rgba(141,123,232,0.15), 0 8px 24px rgba(141,123,232,0.08)`
              : `0 0 0 1px rgba(232,169,76,0.15), 0 8px 24px rgba(232,169,76,0.08)`
            : 'none',

        opacity:
          block.status ===
            'completed' ||
          block.status ===
            'interrupted'
            ? 0.7
            : 1,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
        }}
      >
        {isActive && (
          <CircularTimer
            progress={progress}
          />
        )}

        <div
          style={{
            flex: 1,
            minWidth: 0,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 4,
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: 999,
                background: color,
                flexShrink: 0,
              }}
            />

            <span
              style={{
                fontSize: 15,
                fontWeight: 600,
                fontVariantNumeric:
                  'tabular-nums',
              }}
            >
              {formatClock12(
                block.start
              )}{' '}
              –{' '}
              {formatClock12(
                block.end
              )}
            </span>
          </div>

          {isExercise && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                color:
                  COLORS.exercise,
                fontSize: 12,
                fontWeight: 600,
                marginBottom: 4,
              }}
            >
              <Dumbbell
                size={13}
              />

              <span>
                Exercise
              </span>
            </div>
          )}

          {!isExercise &&
            isActive && (
              <div
                style={{
                  fontSize: 26,
                  fontWeight: 700,
                  fontVariantNumeric:
                    'tabular-nums',
                  color:
                    COLORS.amber,
                  letterSpacing: 0.5,
                }}
              >
                {formatCountdown(
                  remainingSeconds
                )}
              </div>
            )}

          {isExercise &&
            isActive && (
              <div
                style={{
                  fontSize: 26,
                  fontWeight: 700,
                  fontVariantNumeric:
                    'tabular-nums',
                  color:
                    COLORS.exercise,
                  letterSpacing: 0.5,
                }}
              >
                {formatCountdown(
                  remainingSeconds
                )}
              </div>
            )}

          {!isActive && (
            <div
              style={{
                fontSize: 13,
                color:
                  COLORS.textSecondary,
              }}
            >
              {block.status ===
                'completed' &&
                `Done · ${formatDuration(
                  block.actualMinutes ??
                    block.duration
                )}`}

              {block.status ===
                'interrupted' &&
                (block.actualMinutes &&
                block.actualMinutes >
                  0
                  ? `Interrupted · ${formatDuration(
                      block.actualMinutes
                    )} logged`
                  : 'Missed · not logged')}

              {block.status ===
                'upcoming' &&
                (isExercise
                  ? `${formatDuration(
                      block.duration
                    )} continuous exercise`
                  : `${formatDuration(
                      block.duration
                    )} focus session`)}
            </div>
          )}
        </div>

        {block.status ===
          'completed' && (
          <Check
            size={20}
            color={
              isExercise
                ? COLORS.exercise
                : COLORS.green
            }
            style={{
              flexShrink: 0,
            }}
          />
        )}

        {block.status ===
          'interrupted' && (
          <X
            size={20}
            color={COLORS.coral}
            style={{
              flexShrink: 0,
            }}
          />
        )}
      </div>

      {block.status ===
        'upcoming' && (
        <div
          style={{
            marginTop: 14,
            display: 'flex',
            gap: 8,
          }}
        >
          {!hasActiveElsewhere && (
            <motion.button
              type="button"
              whileTap={{
                scale: 0.96,
              }}
              onClick={() =>
                onStart(
                  block.id
                )
              }
              style={{
                ...S.primaryButton,
                width: 'auto',
                flex: 1,
                padding:
                  '10px 16px',
                background:
                  isExercise
                    ? COLORS.exercise
                    : COLORS.amber,
                color:
                  isExercise
                    ? '#120F1E'
                    : '#1A1204',
              }}
            >
              <Play
                size={16}
                fill="currentColor"
              />

              Start
            </motion.button>
          )}

          <button
            type="button"
            onClick={() =>
              onInterrupt(
                block.id
              )
            }
            style={S.iconButton}
            aria-label={
              isExercise
                ? 'Skip exercise'
                : 'Skip this session'
            }
          >
            <X size={18} />
          </button>
        </div>
      )}

      {block.status ===
        'active' && (
        <div
          style={{
            marginTop: 14,
            display: 'flex',
            gap: 8,
          }}
        >
          <motion.button
            type="button"
            whileTap={{
              scale: 0.96,
            }}
            onClick={() =>
              onCompleteEarly(
                block.id
              )
            }
            style={{
              ...S.ghostButton,
              flex: 1,
              justifyContent:
                'center',
              borderColor:
                'rgba(111,207,151,0.3)',
              color:
                COLORS.green,
            }}
          >
            <Check size={15} />

            Done early
          </motion.button>

          <motion.button
            type="button"
            whileTap={{
              scale: 0.96,
            }}
            onClick={() =>
              onInterrupt(
                block.id
              )
            }
            style={{
              ...S.ghostButton,
              flex: 1,
              justifyContent:
                'center',
              borderColor:
                'rgba(232,97,92,0.3)',
              color:
                COLORS.coral,
            }}
          >
            <X size={15} />

            Interrupted
          </motion.button>
        </div>
      )}
    </motion.div>
  );
}

/* ============================================================================
   MAIN PAGE
============================================================================ */

export default function Page() {
  const [
    mounted,
    setMounted,
  ] = useState(false);

  const [
    appState,
    setAppState,
  ] = useState<DayState | null>(
    null
  );

  const [
    now,
    setNow,
  ] = useState<number>(
    () => Date.now()
  );

  const [
    editing,
    setEditing,
  ] = useState(false);

  const [
    draftSleep,
    setDraftSleep,
  ] = useState('23:00');

  const [
    draftRanges,
    setDraftRanges,
  ] = useState<
    FreeRange[]
  >([]);

  /* ------------------------------------------------------------------------
     LOAD
  ------------------------------------------------------------------------ */

  useEffect(() => {
    try {
      const raw =
        window.localStorage.getItem(
          STORAGE_KEY
        );

      if (raw) {
        const parsed =
          JSON.parse(raw) as Partial<DayState>;

        if (
          parsed.date ===
          todayKey(new Date())
        ) {
          const normalizedBlocks =
            Array.isArray(
              parsed.blocks
            )
              ? parsed.blocks.map(
                  (block) => {
                    /*
                     * Backward safety:
                     * old focus blocks are
                     * automatically treated
                     * as focus blocks.
                     */
                    if (
                      block &&
                      typeof block ===
                        'object'
                    ) {
                      return {
                        ...block,
                        type:
                          block.type ===
                          'exercise'
                            ? 'exercise'
                            : 'focus',
                      } as TimelineBlock;
                    }

                    return block;
                  }
                )
              : [];

          const normalized:
            DayState = {
            date:
              parsed.date,
            sleepTime:
              parsed.sleepTime ??
              '23:00',
            freeRanges:
              Array.isArray(
                parsed.freeRanges
              )
                ? parsed.freeRanges
                : [],
            blocks:
              normalizedBlocks,
            onboarded:
              Boolean(
                parsed.onboarded
              ),
          };

          setAppState(
            normalized
          );
        }
      }
    } catch {
      /*
       * Ignore unavailable or
       * corrupted storage.
       */
    }

    setMounted(true);
  }, []);

  /* ------------------------------------------------------------------------
     PERSIST
  ------------------------------------------------------------------------ */

  useEffect(() => {
    if (
      !mounted ||
      !appState
    ) {
      return;
    }

    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(
          appState
        )
      );
    } catch {
      /*
       * Ignore storage errors.
       */
    }
  }, [
    appState,
    mounted,
  ]);

  /* ------------------------------------------------------------------------
     INITIAL DRAFT
  ------------------------------------------------------------------------ */

  useEffect(() => {
    if (
      mounted &&
      appState === null
    ) {
      const nowMin =
        currentMinutes();

      setDraftSleep('23:00');

      setDraftRanges([
        defaultFirstRange(
          nowMin
        ),
      ]);
    }
  }, [
    mounted,
    appState,
  ]);

  /* ------------------------------------------------------------------------
     LIVE CLOCK + AUTOMATIC TIMER
  ------------------------------------------------------------------------ */

  useEffect(() => {
    const interval =
      setInterval(() => {
        const nowMs =
          Date.now();

        setNow(nowMs);

        setAppState(
          (prev) => {
            if (
              !prev ||
              !prev.onboarded
            ) {
              return prev;
            }

            const nowMin =
              currentMinutes(
                new Date(
                  nowMs
                )
              );

            let changed =
              false;

            const blocks =
              prev.blocks.map(
                (b) => {
                  /*
                   * Active timer completed.
                   */
                  if (
                    b.status ===
                      'active' &&
                    b.startedAt !=
                      null
                  ) {
                    const elapsedMin =
                      (nowMs -
                        b.startedAt) /
                      60000;

                    if (
                      elapsedMin >=
                      b.duration
                    ) {
                      changed =
                        true;

                      return {
                        ...b,
                        status:
                          'completed' as BlockStatus,
                        actualMinutes:
                          b.duration,
                      };
                    }
                  }

                  /*
                   * Upcoming block passed
                   * its end without starting.
                   */
                  if (
                    b.status ===
                      'upcoming' &&
                    b.end <=
                      nowMin
                  ) {
                    changed =
                      true;

                    return {
                      ...b,
                      status:
                        'interrupted' as BlockStatus,
                      actualMinutes: 0,
                    };
                  }

                  return b;
                }
              );

            if (!changed) {
              return prev;
            }

            const next = {
              ...prev,
              blocks,
            };

            const recalculated =
              recalcSchedule(
                next,
                nowMin
              );

            return {
              ...next,
              blocks:
                recalculated,
            };
          }
        );
      }, 1000);

    return () =>
      clearInterval(
        interval
      );
  }, []);

  /* ------------------------------------------------------------------------
     DERIVED STATE
  ------------------------------------------------------------------------ */

  const nowMin =
    currentMinutes(
      new Date(now)
    );

  const completedMinutes =
    useMemo(() => {
      if (!appState) {
        return 0;
      }

      return appState.blocks
        .filter(
          (b) =>
            b.type ===
              'focus' &&
            (b.status ===
              'completed' ||
              b.status ===
                'interrupted')
        )
        .reduce(
          (sum, b) =>
            sum +
            (b.actualMinutes ??
              0),
          0
        );
    }, [appState]);

  const sessionsDone =
    useMemo(() => {
      if (!appState) {
        return 0;
      }

      return appState.blocks.filter(
        (b) =>
          b.type ===
            'focus' &&
          b.status ===
            'completed'
      ).length;
    }, [appState]);

  const totalFocusSessions =
    useMemo(() => {
      if (!appState) {
        return 0;
      }

      return appState.blocks.filter(
        (b) =>
          b.type ===
          'focus'
      ).length;
    }, [appState]);

  const exerciseMinutes =
    useMemo(() => {
      if (!appState) {
        return 0;
      }

      return appState.blocks
        .filter(
          (b) =>
            b.type ===
              'exercise' &&
            (b.status ===
              'completed' ||
              b.status ===
                'interrupted')
        )
        .reduce(
          (sum, b) =>
            sum +
            (b.actualMinutes ??
              0),
          0
        );
    }, [appState]);

  const scheduledExercise =
    useMemo(() => {
      if (!appState) {
        return null;
      }

      return (
        appState.blocks.find(
          (b) =>
            b.type ===
            'exercise'
        ) ?? null
      );
    }, [appState]);

  const hasActive =
    useMemo(() => {
      return (
        appState?.blocks.some(
          (b) =>
            b.status ===
            'active'
        ) ?? false
      );
    }, [appState]);

  /* ------------------------------------------------------------------------
     GENERATE
  ------------------------------------------------------------------------ */

  const handleGenerate =
    useCallback(() => {
      const cleanRanges =
        draftRanges.filter(
          (r) =>
            timeStrToMinutes(
              r.end
            ) >
            timeStrToMinutes(
              r.start
            )
        );

      const base: DayState = {
        date: todayKey(
          new Date()
        ),
        sleepTime:
          draftSleep,
        freeRanges:
          cleanRanges,
        blocks: [],
        onboarded: true,
      };

      const blocks =
        recalcSchedule(
          base,
          currentMinutes()
        );

      setAppState({
        ...base,
        blocks,
      });
    }, [
      draftRanges,
      draftSleep,
    ]);

  /* ------------------------------------------------------------------------
     EDITOR
  ------------------------------------------------------------------------ */

  const openEditor =
    useCallback(() => {
      if (!appState) {
        return;
      }

      setDraftSleep(
        appState.sleepTime
      );

      setDraftRanges(
        appState.freeRanges
          .length
          ? appState.freeRanges
          : [
              defaultFirstRange(
                currentMinutes()
              ),
            ]
      );

      setEditing(true);
    }, [appState]);

  const handleSaveEdits =
    useCallback(() => {
      const cleanRanges =
        draftRanges.filter(
          (r) =>
            timeStrToMinutes(
              r.end
            ) >
            timeStrToMinutes(
              r.start
            )
        );

      setAppState(
        (prev) => {
          if (!prev) {
            return prev;
          }

          const next = {
            ...prev,
            sleepTime:
              draftSleep,
            freeRanges:
              cleanRanges,
          };

          const recalculated =
            recalcSchedule(
              next,
              currentMinutes()
            );

          return {
            ...next,
            blocks:
              recalculated,
          };
        }
      );

      setEditing(false);
    }, [
      draftRanges,
      draftSleep,
    ]);

  /* ------------------------------------------------------------------------
     START
  ------------------------------------------------------------------------ */

  const handleStartBlock =
    useCallback(
      (id: string) => {
        setAppState(
          (prev) => {
            if (!prev) {
              return prev;
            }

            /*
             * Do not allow two active
             * blocks.
             */
            if (
              prev.blocks.some(
                (b) =>
                  b.status ===
                  'active'
              )
            ) {
              return prev;
            }

            const nowMs =
              Date.now();

            const nowM =
              currentMinutes(
                new Date(
                  nowMs
                )
              );

            const blocks =
              prev.blocks.map(
                (b) => {
                  if (
                    b.id !== id
                  ) {
                    return b;
                  }

                  return {
                    ...b,
                    status:
                      'active' as BlockStatus,
                    startedAt:
                      nowMs,
                    start: nowM,
                    end:
                      nowM +
                      b.duration,
                  };
                }
              );

            const next = {
              ...prev,
              blocks,
            };

            const recalculated =
              recalcSchedule(
                next,
                nowM
              );

            return {
              ...next,
              blocks:
                recalculated,
            };
          }
        );
      },
      []
    );

  /* ------------------------------------------------------------------------
     COMPLETE EARLY
  ------------------------------------------------------------------------ */

  const handleCompleteEarly =
    useCallback(
      (id: string) => {
        setAppState(
          (prev) => {
            if (!prev) {
              return prev;
            }

            const nowMs =
              Date.now();

            const nowM =
              currentMinutes(
                new Date(
                  nowMs
                )
              );

            const blocks =
              prev.blocks.map(
                (b) => {
                  if (
                    b.id !== id
                  ) {
                    return b;
                  }

                  const elapsedMin =
                    b.startedAt !=
                    null
                      ? Math.min(
                          b.duration,
                          Math.round(
                            (nowMs -
                              b.startedAt) /
                              60000
                          )
                        )
                      : b.duration;

                  return {
                    ...b,
                    status:
                      'completed' as BlockStatus,
                    actualMinutes:
                      elapsedMin,
                    end:
                      b.startedAt !=
                      null
                        ? nowM
                        : b.end,
                  };
                }
              );

            const next = {
              ...prev,
              blocks,
            };

            const recalculated =
              recalcSchedule(
                next,
                nowM
              );

            return {
              ...next,
              blocks:
                recalculated,
            };
          }
        );
      },
      []
    );

  /* ------------------------------------------------------------------------
     INTERRUPT
  ------------------------------------------------------------------------ */

  const handleInterrupt =
    useCallback(
      (id: string) => {
        setAppState(
          (prev) => {
            if (!prev) {
              return prev;
            }

            const nowMs =
              Date.now();

            const nowM =
              currentMinutes(
                new Date(
                  nowMs
                )
              );

            const blocks =
              prev.blocks.map(
                (b) => {
                  if (
                    b.id !== id
                  ) {
                    return b;
                  }

                  const elapsedMin =
                    b.startedAt !=
                    null
                      ? Math.max(
                          0,
                          Math.round(
                            (nowMs -
                              b.startedAt) /
                              60000
                          )
                        )
                      : 0;

                  return {
                    ...b,
                    status:
                      'interrupted' as BlockStatus,
                    actualMinutes:
                      Math.min(
                        elapsedMin,
                        b.duration
                      ),
                    end:
                      b.startedAt !=
                      null
                        ? nowM
                        : b.end,
                  };
                }
              );

            const next = {
              ...prev,
              blocks,
            };

            const recalculated =
              recalcSchedule(
                next,
                nowM
              );

            return {
              ...next,
              blocks:
                recalculated,
            };
          }
        );
      },
      []
    );

  /* ------------------------------------------------------------------------
     RESET
  ------------------------------------------------------------------------ */

  const handleReset =
    useCallback(() => {
      if (
        typeof window !==
          'undefined' &&
        window.confirm(
          "Start over and clear today's plan?"
        )
      ) {
        try {
          window.localStorage.removeItem(
            STORAGE_KEY
          );
        } catch {
          /*
           * Ignore.
           */
        }

        setAppState(null);
        setEditing(false);
      }
    }, []);

  /* ------------------------------------------------------------------------
     ADD RANGE
  ------------------------------------------------------------------------ */

  const addDraftRange =
    useCallback(() => {
      setDraftRanges(
        (prev) => {
          const lastEnd =
            prev.length
              ? timeStrToMinutes(
                  prev[
                    prev.length -
                      1
                  ].end
                )
              : currentMinutes();

          const start =
            Math.min(
              lastEnd + 30,
              23 * 60
            );

          const end =
            Math.min(
              start + 90,
              23 * 60 + 59
            );

          return [
            ...prev,
            {
              id: genId(),
              start:
                minutesToTimeStr(
                  start
                ),
              end:
                minutesToTimeStr(
                  end
                ),
            },
          ];
        }
      );
    }, []);

  const updateDraftRange =
    useCallback(
      (
        id: string,
        next: FreeRange
      ) => {
        setDraftRanges(
          (prev) =>
            prev.map(
              (r) =>
                r.id === id
                  ? next
                  : r
            )
        );
      },
      []
    );

  const removeDraftRange =
    useCallback(
      (id: string) => {
        setDraftRanges(
          (prev) =>
            prev.length > 1
              ? prev.filter(
                  (r) =>
                    r.id !== id
                )
              : prev
        );
      },
      []
    );

  /* ------------------------------------------------------------------------
     MOUNT
  ------------------------------------------------------------------------ */

  if (!mounted) {
    return (
      <div
        style={S.page}
      />
    );
  }

  const showOnboarding =
    !appState ||
    !appState.onboarded;

  const rangesEditorValid =
    draftRanges.some(
      (r) =>
        timeStrToMinutes(
          r.end
        ) >
        timeStrToMinutes(
          r.start
        )
    );

  /* ==========================================================================
     RENDER
  ========================================================================== */

  return (
    <div style={S.page}>
      <style>{`
        * {
          box-sizing: border-box;
        }

        html,
        body {
          margin: 0;
          padding: 0;
          background: ${COLORS.bg};
        }

        input[type="time"] {
          color-scheme: dark;
        }

        ::selection {
          background: ${COLORS.amberSoft};
        }

        button {
          font-family: inherit;
        }

        *:focus-visible {
          outline: 2px solid ${COLORS.amber};
          outline-offset: 2px;
          border-radius: 6px;
        }

        @media (prefers-reduced-motion: reduce) {
          * {
            animation-duration: 0.01ms !important;
            transition-duration: 0.01ms !important;
          }
        }
      `}</style>

      <div style={S.container}>
        <AnimatePresence mode="wait">
          {showOnboarding ? (
            /* ================================================================
               ONBOARDING
            ================================================================ */

            <motion.div
              key="onboarding"
              initial={{
                opacity: 0,
                y: 6,
              }}
              animate={{
                opacity: 1,
                y: 0,
              }}
              exit={{
                opacity: 0,
                y: -6,
              }}
              transition={{
                duration: 0.25,
              }}
            >
              <div
                style={{
                  marginBottom: 28,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems:
                      'center',
                    gap: 8,
                    color:
                      COLORS.textTertiary,
                    fontSize: 13,
                    marginBottom: 10,
                  }}
                >
                  <Clock
                    size={14}
                  />

                  <span
                    style={{
                      fontVariantNumeric:
                        'tabular-nums',
                    }}
                  >
                    {formatClock12(
                      nowMin
                    )}{' '}
                    right now
                  </span>
                </div>

                <h1
                  style={{
                    fontSize: 26,
                    fontWeight: 700,
                    margin:
                      '0 0 8px',
                  }}
                >
                  Plan today's
                  deep work
                </h1>

                <p
                  style={{
                    fontSize: 14.5,
                    lineHeight: 1.5,
                    color:
                      COLORS.textSecondary,
                    margin: 0,
                  }}
                >
                  Add the windows
                  you're free today
                  and the time you're
                  going to sleep.
                  Flowline prefers
                  90-minute focus
                  sessions while
                  allowing shorter
                  blocks when needed.
                  It also tries to
                  add 30–60 minutes
                  of continuous
                  exercise 5–6 hours
                  before bedtime,
                  prioritizing deep
                  work while ensuring
                  at least 90 total
                  minutes of focus
                  can remain.
                </p>
              </div>

              <div
                style={{
                  marginBottom: 22,
                }}
              >
                <label
                  style={S.label}
                >
                  Bedtime tonight
                </label>

                <input
                  type="time"
                  value={
                    draftSleep
                  }
                  onChange={(e) =>
                    setDraftSleep(
                      e.target.value
                    )
                  }
                  style={{
                    ...S.input,
                    maxWidth: 160,
                  }}
                />
              </div>

              <div
                style={{
                  marginBottom: 24,
                }}
              >
                <label
                  style={S.label}
                >
                  When are you
                  free?
                </label>

                <AnimatePresence
                  initial={false}
                >
                  {draftRanges.map(
                    (r) => (
                      <RangeEditorRow
                        key={r.id}
                        range={r}
                        onChange={(
                          next
                        ) =>
                          updateDraftRange(
                            r.id,
                            next
                          )
                        }
                        onRemove={() =>
                          removeDraftRange(
                            r.id
                          )
                        }
                        canRemove={
                          draftRanges.length >
                          1
                        }
                      />
                    )
                  )}
                </AnimatePresence>

                <button
                  type="button"
                  onClick={
                    addDraftRange
                  }
                  style={{
                    ...S.ghostButton,
                    marginTop: 4,
                  }}
                >
                  <Plus size={15} />

                  Add a window
                </button>
              </div>

              <motion.button
                type="button"
                whileTap={{
                  scale: 0.98,
                }}
                onClick={
                  handleGenerate
                }
                disabled={
                  !rangesEditorValid
                }
                style={{
                  ...S.primaryButton,
                  opacity:
                    rangesEditorValid
                      ? 1
                      : 0.5,
                  cursor:
                    rangesEditorValid
                      ? 'pointer'
                      : 'default',
                }}
              >
                <Sparkles
                  size={17}
                />

                Build my
                schedule
              </motion.button>
            </motion.div>
          ) : (
            /* ================================================================
               DASHBOARD
            ================================================================ */

            <motion.div
              key="dashboard"
              initial={{
                opacity: 0,
                y: 6,
              }}
              animate={{
                opacity: 1,
                y: 0,
              }}
              exit={{
                opacity: 0,
                y: -6,
              }}
              transition={{
                duration: 0.25,
              }}
            >
              {/* HEADER */}

              <div
                style={{
                  display: 'flex',
                  justifyContent:
                    'space-between',
                  alignItems:
                    'flex-start',
                  marginBottom: 20,
                }}
              >
                <div>
                  <h1
                    style={{
                      fontSize: 24,
                      fontWeight: 700,
                      margin:
                        '0 0 4px',
                    }}
                  >
                    {greetingFor(
                      nowMin
                    )}
                  </h1>

                  <div
                    style={{
                      display:
                        'flex',
                      alignItems:
                        'center',
                      gap: 6,
                      color:
                        COLORS.textSecondary,
                      fontSize: 13.5,
                    }}
                  >
                    <Clock
                      size={13}
                    />

                    <span
                      style={{
                        fontVariantNumeric:
                          'tabular-nums',
                      }}
                    >
                      {formatClock12(
                        nowMin
                      )}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={
                    handleReset
                  }
                  style={
                    S.iconButton
                  }
                  aria-label="Start over"
                >
                  <RotateCcw
                    size={18}
                  />
                </button>
              </div>

              {/* PROGRESS */}

              <div
                style={{
                  ...S.card,
                  marginBottom: 20,
                }}
              >
                <div
                  style={{
                    display:
                      'flex',
                    justifyContent:
                      'space-between',
                    alignItems:
                      'baseline',
                    marginBottom: 10,
                  }}
                >
                  <div
                    style={{
                      display:
                        'flex',
                      alignItems:
                        'baseline',
                      gap: 6,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 24,
                        fontWeight: 700,
                        fontVariantNumeric:
                          'tabular-nums',
                      }}
                    >
                      {formatDuration(
                        completedMinutes
                      )}
                    </span>

                    <span
                      style={{
                        fontSize: 13.5,
                        color:
                          COLORS.textSecondary,
                      }}
                    >
                      of{' '}
                      {formatDuration(
                        DAILY_TARGET
                      )}{' '}
                      focus
                    </span>
                  </div>

                  <span
                    style={{
                      fontSize: 12.5,
                      color:
                        COLORS.textTertiary,
                    }}
                  >
                    {sessionsDone}{' '}
                    of{' '}
                    {
                      totalFocusSessions
                    }{' '}
                    sessions
                  </span>
                </div>

                <div
                  style={{
                    height: 8,
                    borderRadius:
                      999,
                    background:
                      COLORS.borderSoft,
                    overflow:
                      'hidden',
                  }}
                >
                  <motion.div
                    animate={{
                      width: `${Math.min(
                        100,
                        (completedMinutes /
                          DAILY_TARGET) *
                          100
                      )}%`,
                    }}
                    transition={{
                      duration: 0.5,
                      ease:
                        'easeOut',
                    }}
                    style={{
                      height:
                        '100%',
                      background:
                        COLORS.amber,
                      borderRadius:
                        999,
                    }}
                  />
                </div>

                <div
                  style={{
                    display:
                      'flex',
                    alignItems:
                      'center',
                    gap: 6,
                    marginTop: 12,
                    color:
                      COLORS.textSecondary,
                    fontSize: 12.5,
                  }}
                >
                  <Dumbbell
                    size={14}
                    color={
                      COLORS.exercise
                    }
                  />

                  <span>
                    Exercise:{' '}
                    {formatDuration(
                      exerciseMinutes
                    )}
                  </span>
                </div>

                {scheduledExercise && (
                  <div
                    style={{
                      marginTop: 6,
                      paddingLeft: 20,
                      color:
                        COLORS.textTertiary,
                      fontSize: 11.5,
                    }}
                  >
                    Planned:{' '}
                    {formatClock12(
                      scheduledExercise.start
                    )}{' '}
                    ·{' '}
                    {formatDuration(
                      scheduledExercise.duration
                    )}
                  </div>
                )}
              </div>

              {/* GOAL */}

              {completedMinutes >=
                DAILY_TARGET && (
                <div
                  style={{
                    ...S.card,
                    marginBottom: 16,
                    background:
                      COLORS.greenSoft,
                    border:
                      '1px solid rgba(111,207,151,0.25)',
                    display:
                      'flex',
                    alignItems:
                      'center',
                    gap: 10,
                    color:
                      COLORS.green,
                    fontSize: 13.5,
                  }}
                >
                  <TrendingUp
                    size={17}
                  />

                  <span>
                    Goal reached —
                    6 hours of
                    focus logged
                    today.
                  </span>
                </div>
              )}

              {/* EDITOR */}

              <AnimatePresence>
                {editing && (
                  <motion.div
                    initial={{
                      opacity: 0,
                      height: 0,
                    }}
                    animate={{
                      opacity: 1,
                      height: 'auto',
                    }}
                    exit={{
                      opacity: 0,
                      height: 0,
                    }}
                    style={{
                      overflow:
                        'hidden',
                      marginBottom: 16,
                    }}
                  >
                    <div
                      style={S.card}
                    >
                      <label
                        style={
                          S.label
                        }
                      >
                        Bedtime tonight
                      </label>

                      <input
                        type="time"
                        value={
                          draftSleep
                        }
                        onChange={(
                          e
                        ) =>
                          setDraftSleep(
                            e.target
                              .value
                          )
                        }
                        style={{
                          ...S.input,
                          maxWidth: 160,
                          marginBottom:
                            18,
                        }}
                      />

                      <label
                        style={
                          S.label
                        }
                      >
                        Free windows
                      </label>

                      <AnimatePresence
                        initial={
                          false
                        }
                      >
                        {draftRanges.map(
                          (r) => (
                            <RangeEditorRow
                              key={
                                r.id
                              }
                              range={
                                r
                              }
                              onChange={(
                                next
                              ) =>
                                updateDraftRange(
                                  r.id,
                                  next
                                )
                              }
                              onRemove={() =>
                                removeDraftRange(
                                  r.id
                                )
                              }
                              canRemove={
                                draftRanges.length >
                                1
                              }
                            />
                          )
                        )}
                      </AnimatePresence>

                      <button
                        type="button"
                        onClick={
                          addDraftRange
                        }
                        style={{
                          ...S.ghostButton,
                          marginTop: 4,
                          marginBottom:
                            16,
                        }}
                      >
                        <Plus
                          size={15}
                        />

                        Add a window
                      </button>

                      <div
                        style={{
                          display:
                            'flex',
                          gap: 8,
                        }}
                      >
                        <motion.button
                          type="button"
                          whileTap={{
                            scale: 0.98,
                          }}
                          onClick={
                            handleSaveEdits
                          }
                          disabled={
                            !rangesEditorValid
                          }
                          style={{
                            ...S.primaryButton,
                            opacity:
                              rangesEditorValid
                                ? 1
                                : 0.5,
                          }}
                        >
                          Save and
                          recalculate
                        </motion.button>

                        <button
                          type="button"
                          onClick={() =>
                            setEditing(
                              false
                            )
                          }
                          style={{
                            ...S.ghostButton,
                            padding:
                              '13px 18px',
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* TIMELINE */}

              {!editing && (
                <>
                  {appState.blocks
                    .length ===
                  0 ? (
                    <div
                      style={{
                        ...S.card,
                        display:
                          'flex',
                        gap: 10,
                        alignItems:
                          'flex-start',
                        color:
                          COLORS.textSecondary,
                        fontSize: 13.5,
                      }}
                    >
                      <AlertCircle
                        size={18}
                        color={
                          COLORS.coral
                        }
                        style={{
                          flexShrink: 0,
                          marginTop: 1,
                        }}
                      />

                      <span>
                        No sessions fit
                        before bedtime.
                        Try adding a
                        longer window
                        or pushing
                        your bedtime
                        later.
                      </span>
                    </div>
                  ) : (
                    <div>
                      <AnimatePresence
                        initial={
                          false
                        }
                      >
                        {appState.blocks.map(
                          (
                            block,
                            i
                          ) => (
                            <React.Fragment
                              key={
                                block.id
                              }
                            >
                              <BlockCard
                                block={
                                  block
                                }
                                now={
                                  now
                                }
                                hasActiveElsewhere={
                                  hasActive &&
                                  block.status !==
                                    'active'
                                }
                                onStart={
                                  handleStartBlock
                                }
                                onCompleteEarly={
                                  handleCompleteEarly
                                }
                                onInterrupt={
                                  handleInterrupt
                                }
                              />

                              {i <
                                appState
                                  .blocks
                                  .length -
                                  1 && (
                                <ConnectorGap
                                  minutes={Math.max(
                                    0,
                                    appState
                                      .blocks[
                                      i +
                                        1
                                    ]
                                      .start -
                                      block.end
                                  )}
                                />
                              )}
                            </React.Fragment>
                          )
                        )}
                      </AnimatePresence>

                      <div
                        style={{
                          display:
                            'flex',
                          alignItems:
                            'center',
                          gap: 10,
                          padding:
                            '14px 0 0 24px',
                          color:
                            COLORS.textTertiary,
                          fontSize: 13,
                        }}
                      >
                        <Moon
                          size={15}
                        />

                        <span>
                          Bedtime ·{' '}
                          {formatClock12(
                            timeStrToMinutes(
                              appState.sleepTime
                            )
                          )}
                        </span>
                      </div>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={
                      openEditor
                    }
                    style={{
                      ...S.ghostButton,
                      marginTop: 20,
                      width: '100%',
                      justifyContent:
                        'center',
                    }}
                  >
                    <Edit3
                      size={15}
                    />

                    Edit availability
                  </button>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
