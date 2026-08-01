/**
 * The two responsive layout primitives the dashboard needs, and nothing more.
 *
 * The family app runs primarily as a WEB dashboard, and `Screen` already opens
 * the measure to 1040px above a 900px viewport. A single 1040px column of
 * stacked cards is not a dashboard though — it is a long phone screen that got
 * wider. `Columns` is what turns the extra measure into information density:
 * the timeline (which people read) keeps the wide column, and the things people
 * glance at (next call, care team, settings) sit beside it instead of below the
 * fold.
 *
 * Below the breakpoint both collapse to a plain vertical stack, because on a
 * phone reading order IS the layout.
 */
import { useTheme } from '@juniper/theme';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useIsWide } from './Screen';

export interface ColumnsProps {
  /** The reading column — timeline, alerts. Gets the greater share. */
  main: ReactNode;
  /** The glance column — next call, care team, links. */
  side: ReactNode;
  /**
   * Narrow order. `side` first puts the next-call card above a long timeline
   * on a phone, which is the right call when the answer to "what's coming up"
   * would otherwise be four scrolls down.
   */
  narrowOrder?: 'main-first' | 'side-first';
}

export function Columns({ main, side, narrowOrder = 'main-first' }: ColumnsProps) {
  const theme = useTheme();
  const isWide = useIsWide();

  if (!isWide) {
    const stack = narrowOrder === 'side-first' ? [side, main] : [main, side];
    return (
      <View style={{ gap: theme.spacing.lg }}>
        {stack.map((node, index) => (
          <View key={index} style={{ gap: theme.spacing.md }}>
            {node}
          </View>
        ))}
      </View>
    );
  }

  return (
    <View style={{ flexDirection: 'row', gap: theme.spacing['2xl'], alignItems: 'flex-start' }}>
      {/* flexBasis 0 makes the ratio hold regardless of content width — without
          it a long alert description would push the side column off-balance. */}
      <View style={{ flexGrow: 5, flexShrink: 1, flexBasis: 0, gap: theme.spacing.md }}>
        {main}
      </View>
      <View style={{ flexGrow: 3, flexShrink: 1, flexBasis: 0, gap: theme.spacing.md }}>
        {side}
      </View>
    </View>
  );
}

/**
 * A wrapping row of equal-width tiles: one row of four on a dashboard, two rows
 * of two on a phone. `flexBasis` carries the breakpoint rather than a media
 * query so the tiles reflow at any intermediate width too.
 */
export function TileRow({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const isWide = useIsWide();
  return (
    <View
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: isWide ? theme.spacing.base : theme.spacing.md,
      }}
    >
      {children}
    </View>
  );
}
