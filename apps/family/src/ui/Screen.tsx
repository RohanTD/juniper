/**
 * Screen scaffold: safe area, scroll, sunken background so cards read as
 * paper. Edge padding comes from the theme's `layout` constants.
 *
 * Measure is responsive. The theme's `maxContentWidth` (600) is a phone-first
 * reading measure and is correct on a device, but the family app is used as a
 * DESKTOP DASHBOARD in the browser, where a 600px column stranded in the
 * middle of a 1400px window reads as a broken mobile site rather than a
 * considered one. On a wide viewport the measure opens up; the cards-over-
 * tables pattern still governs, so this widens the column rather than
 * introducing a second layout.
 */
import { useTheme } from '@juniper/theme';
import type { ReactNode } from 'react';
import { ScrollView, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/** Above this viewport width we treat the surface as a dashboard, not a phone. */
export const WIDE_BREAKPOINT = 900;
const WIDE_MEASURE = 1040;

export function useIsWide(): boolean {
  return useWindowDimensions().width >= WIDE_BREAKPOINT;
}

export function Screen({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const isWide = useIsWide();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background.secondary }}>
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          padding: isWide ? theme.spacing['2xl'] : theme.layout.containerPadding,
          paddingBottom: theme.spacing['4xl'],
        }}
      >
        <View
          style={{
            width: '100%',
            maxWidth: isWide ? WIDE_MEASURE : theme.layout.maxContentWidth,
            alignSelf: 'center',
            gap: isWide ? theme.spacing.lg : theme.spacing.md,
            flex: 1,
          }}
        >
          {children}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
