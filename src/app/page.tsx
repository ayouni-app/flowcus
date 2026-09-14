'use client';

/**
 * Flowline — a single-file deep work scheduler.
 * Drop this in as app/page.tsx in a Next.js (App Router) project that already
 * has framer-motion and lucide-react installed. No external CSS is used.
 */

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play,
  Check,
  X,
  Clock,
  Plus,
  Trash2,
  Moon,
  TrendingUp,
  AlertCircle,
  Edit3,
  RotateCcw,
  Coffee,
  Sparkles,
} from 'lucide-react';

/* ============================================================================
   TYPES
============================================================================ */

type BlockStatus = 'upcoming' | 'active' | 'completed' | 'interrupted';

interface FreeRange {
  id: string;
  start: string; // "HH:MM"
  end: string; // "HH:MM"
}

interface FocusBlock {
  id: string;
  start: number; // minutes since midnight
  end: number; // minutes since midnight
  duration: number; // planned minutes
  status: BlockStatus;
  startedAt: number | null; // epoch ms, set when the block is started
  actualMinutes: number | null; // set once completed or interrupted
}

interface DayState {
  date: string; // YYYY-MM-DD, used to detect a new day
  sleepTime: string; // "HH:MM"
  freeRanges: FreeRange[];
  blocks: FocusBlock[];
  onboarded: boolean;
}

interface RawRange {
  start: number;
  end: number;
}

/* ============================================================================
   CONSTANTS
============================================================================ */

const STORAGE_KEY = 'flowline_day_state_v1';
const IDEAL_BLOCK = 90; // minutes, target size for a single focus block
const DAILY_TARGET = 360; // minutes, 6 hours of total focus
const GAP_RATIO = 0.18; // minimum rest between blocks, as a share of the block just finished
const MIN_BLOCK = 15; // minutes, smallest fragment worth scheduling

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
};

/* ============================================================================
   PURE HELPERS — time math, formatting, ids
============================================================================ */

function pad2(n: number): string {
  return Math.max(0, Math.trunc(n)).toString().padStart(2, '0');
}

function timeStrToMinutes(t: string): number {
  const parts = t.split(':');
  const h = Number(parts[0]) || 0;
  const m = Number(parts[1]) || 0;
  return h * 60 + m;
}

function minutesToTimeStr(mins: number): string {
  const m = ((Math.round(mins) % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

function formatClock12(mins: number): string {
  const m = ((Math.round(mins) % 1440) + 1440) % 1440;
  let h = Math.floor(m / 60);
  const mm = m % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${pad2(mm)} ${ampm}`;
}

function formatDuration(mins: number): string {
  const m = Math.round(mins);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`;
}

function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${pad2(sec)}`;
}

function todayKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function currentMinutes(d: Date = new Date()): number {
  return d.getHours() * 60 + d.getMinutes();
}

function greetingFor(nowMin: number): string {
  if (nowMin < 12 * 60) return 'Good morning';
  if (nowMin < 18 * 60) return 'Good afternoon';
  return 'Good evening';
}

let idCounter = 0;
function genId(): string {
  idCounter += 1;
  return `${Date.now().toString(36)}-${idCounter}-${Math.random().toString(36).slice(2, 7)}`;
}

/* ============================================================================
   SCHEDULING ALGORITHM
   Pack focus blocks as close to 90 minutes as possible into the free ranges,
   leaving at least 18% of a block's length as rest before the next one,
   aiming for a 360-minute total across the whole day.
============================================================================ */

function mergeRanges(ranges: RawRange[]): RawRange[] {
  const valid = ranges.filter((r) => r.end - r.start >= 1).sort((a, b) => a.start - b.start);
  const merged: RawRange[] = [];
  for (const r of valid) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) {
      last.end = Math.max(last.end, r.end);
    } else {
      merged.push({ start: r.start, end: r.end });
    }
  }
  return merged;
}

function packRanges(ranges: RawRange[], targetTotal: number): RawRange[] {
  let remaining = targetTotal;
  const out: RawRange[] = [];
  for (const range of ranges) {
    let cursor = range.start;
    while (cursor < range.end && remaining >= MIN_BLOCK) {
      const availableHere = range.end - cursor;
      if (availableHere < MIN_BLOCK) break;
      const desired = Math.min(IDEAL_BLOCK, remaining);
      const duration = Math.min(desired, availableHere);
      if (duration < MIN_BLOCK) break;
      out.push({ start: cursor, end: cursor + duration });
      remaining -= duration;
      const gap = Math.ceil(duration * GAP_RATIO);
      cursor += duration + gap;
    }
    if (remaining < MIN_BLOCK) break;
  }
  return out;
}

function buildSchedule(
  freeRanges: FreeRange[],
  sleepTime: string,
  nowMin: number,
  targetTotal: number
): FocusBlock[] {
  const sleepMin = timeStrToMinutes(sleepTime);
  const raw: RawRange[] = freeRanges
    .map((r) => ({ start: timeStrToMinutes(r.start), end: timeStrToMinutes(r.end) }))
    .map((r) => ({ start: Math.max(r.start, nowMin), end: Math.min(r.end, sleepMin) }))
    .filter((r) => r.end - r.start >= MIN_BLOCK);
  const merged = mergeRanges(raw);
  const packed = packRanges(merged, Math.max(0, targetTotal));
  return packed.map((p) => ({
    id: genId(),
    start: p.start,
    end: p.end,
    duration: p.end - p.start,
    status: 'upcoming',
    startedAt: null,
    actualMinutes: null,
  }));
}

/** Recompute the schedule, keeping history (completed/interrupted/active) intact
 *  and regenerating everything still upcoming from this point forward. */
function recalcSchedule(state: DayState, nowMin: number): FocusBlock[] {
  const kept = state.blocks.filter((b) => b.status !== 'upcoming');
  const doneMinutes = kept.reduce((sum, b) => {
    if (b.status === 'active') return sum;
    return sum + (b.actualMinutes ?? b.duration);
  }, 0);
  const activeBlock = kept.find((b) => b.status === 'active');
  const startFrom = activeBlock ? Math.max(activeBlock.end, nowMin) : nowMin;
  const remainingTarget = Math.max(0, DAILY_TARGET - doneMinutes);
  const fresh = buildSchedule(state.freeRanges, state.sleepTime, startFrom, remainingTarget);
  return [...kept, ...fresh].sort((a, b) => a.start - b.start);
}

function defaultFirstRange(nowMin: number): FreeRange {
  const start = Math.min(Math.ceil(nowMin / 15) * 15, 23 * 60);
  const end = Math.min(start + 120, 23 * 60 + 59);
  return { id: genId(), start: minutesToTimeStr(start), end: minutesToTimeStr(end) };
}

/* ============================================================================
   SMALL PRESENTATIONAL HELPERS
============================================================================ */

const statusColor = (status: BlockStatus) => {
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
};

/* ============================================================================
   REUSABLE STYLE OBJECTS (all inline — no CSS classes, no Tailwind)
============================================================================ */

const S: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    width: '100%',
    background: `linear-gradient(180deg, ${COLORS.bg} 0%, #15171F 100%)`,
    color: COLORS.textPrimary,
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    WebkitFontSmoothing: 'antialiased',
    display: 'flex',
    justifyContent: 'center',
    padding: 'clamp(16px, 5vw, 32px) clamp(14px, 5vw, 24px) 48px',
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
    border: `1px solid ${COLORS.border}`,
    borderRadius: 10,
    color: COLORS.textPrimary,
    fontSize: 16,
    padding: '10px 12px',
    fontFamily: 'inherit',
    fontVariantNumeric: 'tabular-nums',
    width: '100%',
  },
  card: {
    background: COLORS.surface,
    border: `1px solid ${COLORS.border}`,
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
    border: `1px solid ${COLORS.border}`,
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
   SUBCOMPONENTS
============================================================================ */

function RangeEditorRow({
  range,
  onChange,
  onRemove,
  canRemove,
}: {
  range: FreeRange;
  onChange: (next: FreeRange) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10, overflow: 'hidden' }}
    >
      <div style={{ flex: 1 }}>
        <input
          type="time"
          value={range.start}
          onChange={(e) => onChange({ ...range, start: e.target.value })}
          style={S.input}
          aria-label="Free window start"
        />
      </div>
      <span style={{ color: COLORS.textTertiary, fontSize: 13 }}>to</span>
      <div style={{ flex: 1 }}>
        <input
          type="time"
          value={range.end}
          onChange={(e) => onChange({ ...range, end: e.target.value })}
          style={S.input}
          aria-label="Free window end"
        />
      </div>
      <button
        type="button"
        onClick={onRemove}
        disabled={!canRemove}
        style={{ ...S.iconButton, opacity: canRemove ? 1 : 0.25, cursor: canRemove ? 'pointer' : 'default' }}
        aria-label="Remove window"
      >
        <Trash2 size={17} />
      </button>
    </motion.div>
  );
}

function CircularTimer({ progress, size = 84 }: { progress: number; size?: number }) {
  const r = (size - 10) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.min(1, Math.max(0, progress));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} stroke={COLORS.borderSoft} strokeWidth={6} fill="none" />
      <motion.circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={COLORS.amber}
        strokeWidth={6}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={c}
        animate={{ strokeDashoffset: c * (1 - clamped) }}
        transition={{ duration: 0.8, ease: 'linear' }}
      />
    </svg>
  );
}

function ConnectorGap({ minutes }: { minutes: number }) {
  const isBreak = minutes <= 180;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0 4px 24px', margin: '2px 0' }}>
      <div style={{ width: 1, alignSelf: 'stretch', minHeight: 18, background: COLORS.borderSoft }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: COLORS.textTertiary, fontSize: 12 }}>
        {isBreak ? <Coffee size={13} /> : <Clock size={13} />}
        <span>{isBreak ? `${formatDuration(minutes)} break` : `${formatDuration(minutes)} free`}</span>
      </div>
    </div>
  );
}

function BlockCard({
  block,
  now,
  hasActiveElsewhere,
  onStart,
  onCompleteEarly,
  onInterrupt,
}: {
  block: FocusBlock;
  now: number;
  hasActiveElsewhere: boolean;
  onStart: (id: string) => void;
  onCompleteEarly: (id: string) => void;
  onInterrupt: (id: string) => void;
}) {
  const color = statusColor(block.status);
  const isActive = block.status === 'active';

  const remainingSeconds =
    isActive && block.startedAt != null
      ? Math.max(0, block.duration * 60 - (now - block.startedAt) / 1000)
      : block.duration * 60;
  const progress = isActive ? 1 - remainingSeconds / (block.duration * 60) : 0;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.25 }}
      style={{
        ...S.card,
        borderColor: isActive ? 'rgba(232,169,76,0.4)' : COLORS.border,
        background: isActive ? COLORS.surfaceRaised : COLORS.surface,
        boxShadow: isActive ? `0 0 0 1px rgba(232,169,76,0.15), 0 8px 24px rgba(232,169,76,0.08)` : 'none',
        opacity: block.status === 'completed' || block.status === 'interrupted' ? 0.7 : 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        {isActive && <CircularTimer progress={progress} />}

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: 999,
                background: color,
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: 15, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
              {formatClock12(block.start)} – {formatClock12(block.end)}
            </span>
          </div>

          {isActive ? (
            <div style={{ fontSize: 26, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: COLORS.amber, letterSpacing: 0.5 }}>
              {formatCountdown(remainingSeconds)}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: COLORS.textSecondary }}>
              {block.status === 'completed' && `Done · ${formatDuration(block.actualMinutes ?? block.duration)}`}
              {block.status === 'interrupted' &&
                (block.actualMinutes && block.actualMinutes > 0
                  ? `Interrupted · ${formatDuration(block.actualMinutes)} logged`
                  : 'Missed · rescheduled')}
              {block.status === 'upcoming' && `${formatDuration(block.duration)} focus session`}
            </div>
          )}
        </div>

        {block.status === 'completed' && <Check size={20} color={COLORS.green} style={{ flexShrink: 0 }} />}
        {block.status === 'interrupted' && <X size={20} color={COLORS.coral} style={{ flexShrink: 0 }} />}
      </div>

      {block.status === 'upcoming' && (
        <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
          {!hasActiveElsewhere && (
            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              onClick={() => onStart(block.id)}
              style={{ ...S.primaryButton, width: 'auto', flex: 1, padding: '10px 16px' }}
            >
              <Play size={16} fill="#1A1204" /> Start
            </motion.button>
          )}
          <button type="button" onClick={() => onInterrupt(block.id)} style={S.iconButton} aria-label="Skip this session">
            <X size={18} />
          </button>
        </div>
      )}

      {isActive && (
        <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
          <motion.button
            type="button"
            whileTap={{ scale: 0.96 }}
            onClick={() => onCompleteEarly(block.id)}
            style={{ ...S.ghostButton, flex: 1, justifyContent: 'center', borderColor: 'rgba(111,207,151,0.3)', color: COLORS.green }}
          >
            <Check size={15} /> Done early
          </motion.button>
          <motion.button
            type="button"
            whileTap={{ scale: 0.96 }}
            onClick={() => onInterrupt(block.id)}
            style={{ ...S.ghostButton, flex: 1, justifyContent: 'center', borderColor: 'rgba(232,97,92,0.3)', color: COLORS.coral }}
          >
            <X size={15} /> Interrupted
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
  const [mounted, setMounted] = useState(false);
  const [appState, setAppState] = useState<DayState | null>(null);
  const [now, setNow] = useState<number>(() => Date.now());
  const [editing, setEditing] = useState(false);

  const [draftSleep, setDraftSleep] = useState('23:00');
  const [draftRanges, setDraftRanges] = useState<FreeRange[]>([]);

  // ---- load from localStorage on mount ----
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: DayState = JSON.parse(raw);
        if (parsed.date === todayKey(new Date())) {
          setAppState(parsed);
        }
      }
    } catch {
      // ignore corrupted / unavailable storage
    }
    setMounted(true);
  }, []);

  // ---- persist whenever state changes ----
  useEffect(() => {
    if (!mounted || !appState) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
    } catch {
      // ignore quota / privacy-mode errors
    }
  }, [appState, mounted]);

  // ---- seed onboarding drafts once we know there is no saved plan ----
  useEffect(() => {
    if (mounted && appState === null) {
      const nowMin = currentMinutes();
      setDraftSleep('23:00');
      setDraftRanges([defaultFirstRange(nowMin)]);
    }
  }, [mounted, appState]);

  // ---- live clock + timer tick, and automatic rearrangement ----
  useEffect(() => {
    const interval = setInterval(() => {
      const nowMs = Date.now();
      setNow(nowMs);
      setAppState((prev) => {
        if (!prev || !prev.onboarded) return prev;
        const nowMin = currentMinutes(new Date(nowMs));
        let changed = false;
        const blocks = prev.blocks.map((b) => {
          if (b.status === 'active' && b.startedAt != null) {
            const elapsedMin = (nowMs - b.startedAt) / 60000;
            if (elapsedMin >= b.duration) {
              changed = true;
              return { ...b, status: 'completed' as BlockStatus, actualMinutes: b.duration };
            }
          }
          if (b.status === 'upcoming' && b.end <= nowMin) {
            changed = true;
            return { ...b, status: 'interrupted' as BlockStatus, actualMinutes: 0 };
          }
          return b;
        });
        if (!changed) return prev;
        const next = { ...prev, blocks };
        const recalculated = recalcSchedule(next, nowMin);
        return { ...next, blocks: recalculated };
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const nowMin = currentMinutes(new Date(now));

  const completedMinutes = useMemo(() => {
    if (!appState) return 0;
    return appState.blocks
      .filter((b) => b.status === 'completed' || b.status === 'interrupted')
      .reduce((sum, b) => sum + (b.actualMinutes ?? 0), 0);
  }, [appState]);

  const sessionsDone = useMemo(() => {
    if (!appState) return 0;
    return appState.blocks.filter((b) => b.status === 'completed').length;
  }, [appState]);

  const totalSessions = appState?.blocks.length ?? 0;
  const hasActive = useMemo(() => appState?.blocks.some((b) => b.status === 'active') ?? false, [appState]);

  // ---- handlers ----
  const handleGenerate = useCallback(() => {
    const cleanRanges = draftRanges.filter((r) => timeStrToMinutes(r.end) > timeStrToMinutes(r.start));
    const base: DayState = {
      date: todayKey(new Date()),
      sleepTime: draftSleep,
      freeRanges: cleanRanges,
      blocks: [],
      onboarded: true,
    };
    const blocks = recalcSchedule(base, currentMinutes());
    setAppState({ ...base, blocks });
  }, [draftRanges, draftSleep]);

  const openEditor = useCallback(() => {
    if (!appState) return;
    setDraftSleep(appState.sleepTime);
    setDraftRanges(appState.freeRanges.length ? appState.freeRanges : [defaultFirstRange(currentMinutes())]);
    setEditing(true);
  }, [appState]);

  const handleSaveEdits = useCallback(() => {
    const cleanRanges = draftRanges.filter((r) => timeStrToMinutes(r.end) > timeStrToMinutes(r.start));
    setAppState((prev) => {
      if (!prev) return prev;
      const next = { ...prev, sleepTime: draftSleep, freeRanges: cleanRanges };
      const recalculated = recalcSchedule(next, currentMinutes());
      return { ...next, blocks: recalculated };
    });
    setEditing(false);
  }, [draftRanges, draftSleep]);

  const handleStartBlock = useCallback((id: string) => {
    setAppState((prev) => {
      if (!prev) return prev;
      const nowMs = Date.now();
      const nowM = currentMinutes(new Date(nowMs));
      const blocks = prev.blocks.map((b) =>
        b.id === id ? { ...b, status: 'active' as BlockStatus, startedAt: nowMs, start: nowM, end: nowM + b.duration } : b
      );
      const next = { ...prev, blocks };
      const recalculated = recalcSchedule(next, nowM);
      return { ...next, blocks: recalculated };
    });
  }, []);

  const handleCompleteEarly = useCallback((id: string) => {
    setAppState((prev) => {
      if (!prev) return prev;
      const nowMs = Date.now();
      const nowM = currentMinutes(new Date(nowMs));
      const blocks = prev.blocks.map((b) => {
        if (b.id !== id) return b;
        const elapsedMin = b.startedAt != null ? Math.min(b.duration, Math.round((nowMs - b.startedAt) / 60000)) : b.duration;
        return { ...b, status: 'completed' as BlockStatus, actualMinutes: elapsedMin, end: b.startedAt != null ? nowM : b.end };
      });
      const next = { ...prev, blocks };
      const recalculated = recalcSchedule(next, nowM);
      return { ...next, blocks: recalculated };
    });
  }, []);

  const handleInterrupt = useCallback((id: string) => {
    setAppState((prev) => {
      if (!prev) return prev;
      const nowMs = Date.now();
      const nowM = currentMinutes(new Date(nowMs));
      const blocks = prev.blocks.map((b) => {
        if (b.id !== id) return b;
        const elapsedMin = b.startedAt != null ? Math.max(0, Math.round((nowMs - b.startedAt) / 60000)) : 0;
        return {
          ...b,
          status: 'interrupted' as BlockStatus,
          actualMinutes: Math.min(elapsedMin, b.duration),
          end: b.startedAt != null ? nowM : b.end,
        };
      });
      const next = { ...prev, blocks };
      const recalculated = recalcSchedule(next, nowM);
      return { ...next, blocks: recalculated };
    });
  }, []);

  const handleReset = useCallback(() => {
    if (typeof window !== 'undefined' && window.confirm("Start over and clear today's plan?")) {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }
      setAppState(null);
      setEditing(false);
    }
  }, []);

  const addDraftRange = useCallback(() => {
    setDraftRanges((prev) => {
      const lastEnd = prev.length ? timeStrToMinutes(prev[prev.length - 1].end) : currentMinutes();
      const start = Math.min(lastEnd + 30, 23 * 60);
      const end = Math.min(start + 90, 23 * 60 + 59);
      return [...prev, { id: genId(), start: minutesToTimeStr(start), end: minutesToTimeStr(end) }];
    });
  }, []);

  const updateDraftRange = useCallback((id: string, next: FreeRange) => {
    setDraftRanges((prev) => prev.map((r) => (r.id === id ? next : r)));
  }, []);

  const removeDraftRange = useCallback((id: string) => {
    setDraftRanges((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== id) : prev));
  }, []);

  /* ---------------------------------------------------------------------- */

  if (!mounted) {
    return <div style={S.page} />;
  }

  const showOnboarding = !appState || !appState.onboarded;
  const rangesEditorValid = draftRanges.some((r) => timeStrToMinutes(r.end) > timeStrToMinutes(r.start));

  return (
    <div style={S.page}>
      <style>{`
        * { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; background: ${COLORS.bg}; }
        input[type="time"] { color-scheme: dark; }
        ::selection { background: ${COLORS.amberSoft}; }
        button { font-family: inherit; }
        *:focus-visible { outline: 2px solid ${COLORS.amber}; outline-offset: 2px; border-radius: 6px; }
        @media (prefers-reduced-motion: reduce) {
          * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
        }
      `}</style>

      <div style={S.container}>
        <AnimatePresence mode="wait">
          {showOnboarding ? (
            <motion.div
              key="onboarding"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.25 }}
            >
              <div style={{ marginBottom: 28 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: COLORS.textTertiary, fontSize: 13, marginBottom: 10 }}>
                  <Clock size={14} />
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatClock12(nowMin)} right now</span>
                </div>
                <h1 style={{ fontSize: 26, fontWeight: 700, margin: '0 0 8px' }}>Plan today's deep work</h1>
                <p style={{ fontSize: 14.5, lineHeight: 1.5, color: COLORS.textSecondary, margin: 0 }}>
                  Add the windows you're free today and the time you're going to sleep. Flowline lays out focus
                  sessions close to 90 minutes each, with real rest between them, aiming for 6 hours total.
                </p>
              </div>

              <div style={{ marginBottom: 22 }}>
                <label style={S.label}>Bedtime tonight</label>
                <input
                  type="time"
                  value={draftSleep}
                  onChange={(e) => setDraftSleep(e.target.value)}
                  style={{ ...S.input, maxWidth: 160 }}
                />
              </div>

              <div style={{ marginBottom: 24 }}>
                <label style={S.label}>When are you free?</label>
                <AnimatePresence initial={false}>
                  {draftRanges.map((r) => (
                    <RangeEditorRow
                      key={r.id}
                      range={r}
                      onChange={(next) => updateDraftRange(r.id, next)}
                      onRemove={() => removeDraftRange(r.id)}
                      canRemove={draftRanges.length > 1}
                    />
                  ))}
                </AnimatePresence>
                <button type="button" onClick={addDraftRange} style={{ ...S.ghostButton, marginTop: 4 }}>
                  <Plus size={15} /> Add a window
                </button>
              </div>

              <motion.button
                type="button"
                whileTap={{ scale: 0.98 }}
                onClick={handleGenerate}
                disabled={!rangesEditorValid}
                style={{ ...S.primaryButton, opacity: rangesEditorValid ? 1 : 0.5, cursor: rangesEditorValid ? 'pointer' : 'default' }}
              >
                <Sparkles size={17} /> Build my schedule
              </motion.button>
            </motion.div>
          ) : (
            <motion.div
              key="dashboard"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.25 }}
            >
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
                <div>
                  <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 4px' }}>{greetingFor(nowMin)}</h1>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: COLORS.textSecondary, fontSize: 13.5 }}>
                    <Clock size={13} />
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatClock12(nowMin)}</span>
                  </div>
                </div>
                <button type="button" onClick={handleReset} style={S.iconButton} aria-label="Start over">
                  <RotateCcw size={18} />
                </button>
              </div>

              {/* Progress */}
              <div style={{ ...S.card, marginBottom: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                    <span style={{ fontSize: 24, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                      {formatDuration(completedMinutes)}
                    </span>
                    <span style={{ fontSize: 13.5, color: COLORS.textSecondary }}>of {formatDuration(DAILY_TARGET)} focus</span>
                  </div>
                  <span style={{ fontSize: 12.5, color: COLORS.textTertiary }}>
                    {sessionsDone} of {totalSessions} sessions
                  </span>
                </div>
                <div style={{ height: 8, borderRadius: 999, background: COLORS.borderSoft, overflow: 'hidden' }}>
                  <motion.div
                    animate={{ width: `${Math.min(100, (completedMinutes / DAILY_TARGET) * 100)}%` }}
                    transition={{ duration: 0.5, ease: 'easeOut' }}
                    style={{ height: '100%', background: COLORS.amber, borderRadius: 999 }}
                  />
                </div>
              </div>

              {completedMinutes >= DAILY_TARGET && (
                <div
                  style={{
                    ...S.card,
                    marginBottom: 16,
                    background: COLORS.greenSoft,
                    border: `1px solid rgba(111,207,151,0.25)`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    color: COLORS.green,
                    fontSize: 13.5,
                  }}
                >
                  <TrendingUp size={17} />
                  <span>Goal reached — 6 hours of focus logged today.</span>
                </div>
              )}

              {/* Editor overlay */}
              <AnimatePresence>
                {editing && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    style={{ overflow: 'hidden', marginBottom: 16 }}
                  >
                    <div style={S.card}>
                      <label style={S.label}>Bedtime tonight</label>
                      <input
                        type="time"
                        value={draftSleep}
                        onChange={(e) => setDraftSleep(e.target.value)}
                        style={{ ...S.input, maxWidth: 160, marginBottom: 18 }}
                      />
                      <label style={S.label}>Free windows</label>
                      <AnimatePresence initial={false}>
                        {draftRanges.map((r) => (
                          <RangeEditorRow
                            key={r.id}
                            range={r}
                            onChange={(next) => updateDraftRange(r.id, next)}
                            onRemove={() => removeDraftRange(r.id)}
                            canRemove={draftRanges.length > 1}
                          />
                        ))}
                      </AnimatePresence>
                      <button type="button" onClick={addDraftRange} style={{ ...S.ghostButton, marginTop: 4, marginBottom: 16 }}>
                        <Plus size={15} /> Add a window
                      </button>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <motion.button
                          type="button"
                          whileTap={{ scale: 0.98 }}
                          onClick={handleSaveEdits}
                          disabled={!rangesEditorValid}
                          style={{ ...S.primaryButton, opacity: rangesEditorValid ? 1 : 0.5 }}
                        >
                          Save and recalculate
                        </motion.button>
                        <button type="button" onClick={() => setEditing(false)} style={{ ...S.ghostButton, padding: '13px 18px' }}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Timeline */}
              {!editing && (
                <>
                  {appState.blocks.length === 0 ? (
                    <div style={{ ...S.card, display: 'flex', gap: 10, alignItems: 'flex-start', color: COLORS.textSecondary, fontSize: 13.5 }}>
                      <AlertCircle size={18} color={COLORS.coral} style={{ flexShrink: 0, marginTop: 1 }} />
                      <span>No sessions fit before bedtime. Try adding a longer window or pushing your bedtime later.</span>
                    </div>
                  ) : (
                    <div>
                      <AnimatePresence initial={false}>
                        {appState.blocks.map((block, i) => (
                          <React.Fragment key={block.id}>
                            <BlockCard
                              block={block}
                              now={now}
                              hasActiveElsewhere={hasActive && block.status !== 'active'}
                              onStart={handleStartBlock}
                              onCompleteEarly={handleCompleteEarly}
                              onInterrupt={handleInterrupt}
                            />
                            {i < appState.blocks.length - 1 && (
                              <ConnectorGap minutes={Math.max(0, appState.blocks[i + 1].start - block.end)} />
                            )}
                          </React.Fragment>
                        ))}
                      </AnimatePresence>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 0 0 24px', color: COLORS.textTertiary, fontSize: 13 }}>
                        <Moon size={15} />
                        <span>Bedtime · {formatClock12(timeStrToMinutes(appState.sleepTime))}</span>
                      </div>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={openEditor}
                    style={{ ...S.ghostButton, marginTop: 20, width: '100%', justifyContent: 'center' }}
                  >
                    <Edit3 size={15} /> Edit availability
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

