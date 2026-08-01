/**
 * Screen scaffold: safe area, scroll, sunken background so cards read as
 * paper, readable column width on web. Edge padding and measure both come from
 * the theme's `layout` constants.
 */
import { useTheme } from '@juniper/theme';
import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export function Screen({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background.secondary }}>
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          padding: theme.layout.containerPadding,
          paddingBottom: theme.spacing['4xl'],
        }}
      >
        <View
          style={{
            width: '100%',
            maxWidth: theme.layout.maxContentWidth,
            alignSelf: 'center',
            gap: theme.spacing.md,
            flex: 1,
          }}
        >
          {children}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
