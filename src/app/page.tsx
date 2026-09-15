'use client';

/**
 * Flowline — single-file deep work + exercise scheduler.
 *
 * Rules:
 * 1. Target 6 hours of deep work.
 * 2. Focus blocks prefer 90 minutes.
 * 3. Rest after each focus block is at least 18% of that block.
 * 4. Exercise is continuous, preferably 60 minutes.
 * 5. Exercise minimum is 30 minutes.
 * 6. Exercise must be 5–6 hours before bedtime.
 * 7. Exercise is placed as close as possible to 6 hours before bedtime.
 * 8. 90-minute focus blocks have absolute priority over exercise.
 * 9. If exercise would prevent ANY 90-minute focus block, exercise = 0.
 * 10. Exercise does not count toward the 6-hour focus target.
 *
 * Drop this into app/page.tsx.
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

type TimelineBlock = FocusBlock | ExerciseBlock;

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

const STORAGE_KEY = 'flowline_day_state_v2';

const IDEAL_BLOCK = 90;
const DAILY_TARGET = 360;

const GAP_RATIO = 0.18;
const MIN_BLOCK = 15;

/* Exercise rules */
const EXERCISE_MIN = 30;
const EXERCISE_MAX = 60;

/*
 * Exercise should occur 5–6 hours before bedtime.
 *
 * We optimize around 6 hours before bedtime.
 * The exercise START time is selected so the exercise interval remains
 * entirely inside the 5–6 hour-before-bed window.
 */
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

function timeStrToMinutes(t: string): number {
  const parts = t.split(':');

  const h = Number(parts[0]) || 0;
  const m = Number(parts[1]) || 0;

  return h * 60 + m;
}

function minutesToTimeStr(mins: number): string {
  const m =
    ((Math.round(mins) % 1440) + 1440) % 1440;

  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

function formatClock12(mins: number): string {
  const m =
    ((Math.round(mins) % 1440) + 1440) % 1440;

  let h = Math.floor(m / 60);

  const mm = m % 60;

  const ampm = h >= 12 ? 'PM' : 'AM';

  h %= 12;

  if (h === 0) {
    h = 12;
  }

  return `${h}:${pad2(mm)} ${ampm}`;
}

function formatDuration(mins: number): string {
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

function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));

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

function currentMinutes(d: Date = new Date()): number {
  return d.getHours() * 60 + d.getMinutes();
}

function greetingFor(nowMin: number): string {
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
    .filter((r) => r.end - r.start >= 1)
    .sort((a, b) => a.start - b.start);

  const merged: RawRange[] = [];

  for (const r of valid) {
    const last = merged[merged.length - 1];

    if (last && r.start <= last.end) {
      last.end = Math.max(last.end, r.end);
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
 * Important:
 * - A full 90m block is preferred.
 * - A final partial block is allowed only when a 90m block cannot fit.
 * - Exercise is handled separately.
 */
function packFocusRanges(
  ranges: RawRange[],
  targetTotal: number
): RawRange[] {
  let remaining = targetTotal;

  const out: RawRange[] = [];

  for (const range of ranges) {
    let cursor = range.start;

    while (
      cursor < range.end &&
      remaining >= MIN_BLOCK
    ) {
      const availableHere = range.end - cursor;

      if (availableHere < MIN_BLOCK) {
        break;
      }

      /*
       * Always prefer 90m.
       *
       * If enough time exists for a 90m block and the target still needs
       * at least 90m, take 90m.
       *
       * Otherwise use the remaining available amount as a final fragment.
       */
      let duration: number;

      if (
        remaining >= IDEAL_BLOCK &&
        availableHere >= IDEAL_BLOCK
      ) {
        duration = IDEAL_BLOCK;
      } else {
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

      cursor += duration + gap;
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
    if (blocked.start > range.start) {
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
    if (blocked.end < range.end) {
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
    (r) => r.end - r.start >= MIN_BLOCK
  );
}

/* ============================================================================
   EXERCISE SCHEDULER
============================================================================ */

/**
 * Exercise must:
 *
 * - be continuous
 * - be 30–60 minutes
 * - preferably be 60 minutes
 * - occur 5–6 hours before bedtime
 * - be as close as possible to the 6-hour point
 *
 * Most importantly:
 *
 * A 90-minute focus block always beats exercise.
 *
 * Therefore we first determine whether the day has at least one 90-minute
 * focus opportunity without exercise.
 *
 * If not, exercise is disabled entirely.
 */
function findExerciseBlock(
  freeRanges: RawRange[],
  sleepMin: number
): ExerciseBlock | null {
  /*
   * Candidate exercise window:
   *
   * [sleep - 6h, sleep - 5h]
   *
   * This means the exercise START should be >= sleep - 6h,
   * and exercise END should be <= sleep - 5h.
   */
  const preferredStart =
    sleepMin - EXERCISE_NEAREST_SLEEP_MINUTES;

  const latestEnd =
    sleepMin - EXERCISE_FARTHEST_SLEEP_MINUTES;

  /*
   * We require a 30–60 minute continuous exercise block.
   *
   * For a 60m exercise session:
   *
   * start >= sleep - 6h
   * end <= sleep - 5h
   *
   * Since the window is exactly 60m wide, a 60m exercise session has
   * exactly one ideal position.
   */
  const candidates: {
    start: number;
    duration: number;
  }[] = [];

  for (const range of freeRanges) {
    const start = Math.max(
      range.start,
      preferredStart
    );

    /*
     * First try the maximum 60m.
     */
    const maxDuration = Math.min(
      EXERCISE_MAX,
      range.end - start,
      latestEnd - start
    );

    if (maxDuration >= EXERCISE_MIN) {
      /*
       * Prefer the largest possible continuous exercise block.
       */
      const duration =
        maxDuration >= EXERCISE_MAX
          ? EXERCISE_MAX
          : Math.floor(maxDuration);

      if (duration >= EXERCISE_MIN) {
        candidates.push({
          start,
          duration,
        });
      }
    }

    /*
     * Also consider a later position inside the range if the initial
     * position cannot provide the maximum amount.
     */
    const latestPossibleStart = Math.min(
      range.end - EXERCISE_MIN,
      latestEnd - EXERCISE_MIN
    );

    if (
      latestPossibleStart >=
      Math.max(range.start, preferredStart)
    ) {
      const alternativeStart =
        latestPossibleStart;

      const alternativeDuration = Math.min(
        EXERCISE_MAX,
        range.end - alternativeStart,
        latestEnd - alternativeStart
      );

      if (
        alternativeDuration >=
        EXERCISE_MIN
      ) {
        candidates.push({
          start: alternativeStart,
          duration: Math.floor(
            alternativeDuration
          ),
        });
      }
    }
  }

  if (!candidates.length) {
    return null;
  }

  /*
   * Ranking:
   *
   * 1. Longer exercise is better.
   * 2. Start closer to sleep - 6h is better.
   */
  candidates.sort((a, b) => {
    if (b.duration !== a.duration) {
      return b.duration - a.duration;
    }

    return (
      Math.abs(
        a.start - preferredStart
      ) -
      Math.abs(
        b.start - preferredStart
      )
    );
  });

  const selected = candidates[0];

  return {
    id: genId(),
    type: 'exercise',
    start: selected.start,
    end: selected.start + selected.duration,
    duration: selected.duration,
    status: 'upcoming',
    startedAt: null,
    actualMinutes: null,
  };
}

/* ============================================================================
   CHECK FOR 90-MINUTE FOCUS OPPORTUNITY
============================================================================ */

/**
 * This is the key priority rule.
 *
 * Exercise is only allowed if at least one complete 90-minute focus block
 * remains possible after reserving the exercise slot.
 */
function has90MinuteFocusOpportunity(
  ranges: RawRange[],
  targetTotal: number
): boolean {
  if (targetTotal < IDEAL_BLOCK) {
    return false;
  }

  const merged = mergeRanges(ranges);

  return merged.some(
    (range) =>
      range.end - range.start >=
      IDEAL_BLOCK
  );
}

/* ============================================================================
   BUILD COMPLETE SCHEDULE
============================================================================ */

function buildSchedule(
  freeRanges: FreeRange[],
  sleepTime: string,
  nowMin: number,
  targetTotal: number
): TimelineBlock[] {
  const sleepMin =
    timeStrToMinutes(sleepTime);

  /*
   * Start from now and never schedule after bedtime.
   */
  let availableRanges: RawRange[] =
    freeRanges
      .map((r) => ({
        start: Math.max(
          timeStrToMinutes(r.start),
          nowMin
        ),
        end: Math.min(
          timeStrToMinutes(r.end),
          sleepMin
        ),
      }))
      .filter(
        (r) =>
          r.end - r.start >= MIN_BLOCK
      );

  availableRanges =
    mergeRanges(availableRanges);

  /*
   * ---------------------------------------------------------------
   * FIRST: determine whether exercise is allowed.
   * ---------------------------------------------------------------
   *
   * Exercise must never destroy the possibility of a 90m focus block.
   */
  let exercise: ExerciseBlock | null = null;

  const exerciseCandidate =
    findExerciseBlock(
      availableRanges,
      sleepMin
    );

  if (exerciseCandidate) {
    const afterExercise =
      subtractRange(
        availableRanges,
        {
          start: exerciseCandidate.start,
          end: exerciseCandidate.end,
        }
      );

    /*
     * Exercise is allowed if:
     *
     * A 90m block exists after reserving exercise.
     */
    if (
      has90MinuteFocusOpportunity(
        afterExercise,
        targetTotal
      )
    ) {
      exercise =
        exerciseCandidate;

      availableRanges =
        afterExercise;
    }
  }

  /*
   * ---------------------------------------------------------------
   * SECOND: schedule focus.
   * ---------------------------------------------------------------
   */
  const focusRanges =
    packFocusRanges(
      availableRanges,
      Math.max(0, targetTotal)
    );

  const focusBlocks: FocusBlock[] =
    focusRanges.map((p) => ({
      id: genId(),
      type: 'focus',
      start: p.start,
      end: p.end,
      duration: p.end - p.start,
      status: 'upcoming',
      startedAt: null,
      actualMinutes: null,
    }));

  /*
   * ---------------------------------------------------------------
   * THIRD: combine timeline.
   * ---------------------------------------------------------------
   */
  const all: TimelineBlock[] = [
    ...focusBlocks,
  ];

  if (exercise) {
    all.push(exercise);
  }

  return all.sort(
    (a, b) => a.start - b.start
  );
}

/* ============================================================================
   RECOMPUTE SCHEDULE
============================================================================ */

/**
 * Keeps completed/interrupted/active history.
 *
 * Rebuilds upcoming work.
 */
function recalcSchedule(
  state: DayState,
  nowMin: number
): TimelineBlock[] {
  const kept =
    state.blocks.filter(
      (b) => b.status !== 'upcoming'
    );

  const doneMinutes =
    kept.reduce((sum, b) => {
      if (b.type !== 'focus') {
        return sum;
      }

      if (b.status === 'active') {
        return sum;
      }

      return (
        sum +
        (b.actualMinutes ??
          b.duration)
      );
    }, 0);

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
      DAILY_TARGET - doneMinutes
    );

  /*
   * Upcoming availability is generated from the user's free windows,
   * starting from now.
   */
  const upcomingRanges =
    state.freeRanges
      .map((r) => ({
        id: r.id,
        start: minutesToTimeStr(
          Math.max(
            timeStrToMinutes(r.start),
            startFrom
          )
        ),
        end: minutesToTimeStr(
          timeStrToMinutes(r.end)
        ),
      }))
      .filter(
        (r) =>
          timeStrToMinutes(r.end) >
          timeStrToMinutes(r.start)
      );

  /*
   * IMPORTANT:
   * Exercise is only considered if it can coexist with a 90m block.
   */
  const fresh =
    buildSchedule(
      upcomingRanges,
      state.sleepTime,
      startFrom,
      remainingTarget
    );

  return [
    ...kept,
    ...fresh,
  ].sort(
    (a, b) => a.start - b.start
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
    start: minutesToTimeStr(start),
    end: minutesToTimeStr(end),
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
    WebkitFontSmoothing: 'antialiased',
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

  const clamped =
    Math.min(
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
                  : 'Missed · rescheduled')}

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
        const parsed: DayState =
          JSON.parse(raw);

        if (
          parsed.date ===
          todayKey(new Date())
        ) {
          /*
           * Backward safety for malformed/old states.
           */
          const normalized: DayState =
            {
              ...parsed,

              blocks:
                Array.isArray(
                  parsed.blocks
                )
                  ? parsed.blocks
                  : [],
            };

          setAppState(
            normalized
          );
        }
      }
    } catch {
      // Ignore unavailable/corrupted storage.
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
      // Ignore storage errors.
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
                   * Upcoming block passed its end without being started.
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

      const base: DayState =
        {
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

          const next =
            {
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
             * Do not allow two active blocks.
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

            /*
             * Recalculate remaining upcoming schedule.
             */
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
          // Ignore.
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
                  Flowline prioritizes
                  90-minute focus
                  sessions, then adds
                  30–60 minutes of
                  continuous exercise
                  5–6 hours before
                  bedtime when it can
                  do so without
                  sacrificing a 90-minute
                  focus block.
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
