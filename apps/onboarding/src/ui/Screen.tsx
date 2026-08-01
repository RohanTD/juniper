/**
 * Screen scaffold: safe area, scroll, background token, generous padding, and
 * a readable column width on web (the magic-link-on-a-laptop flow) taken from
 * the theme's `layout.maxContentWidth`.
 */
import { useTheme } from '@juniper/theme';
import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export function Screen({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          // Generous edge padding: one question per screen, read at arm's length.
          padding: theme.spacing.xl,
          paddingBottom: theme.spacing['4xl'],
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View
          style={{
            width: '100%',
            maxWidth: theme.layout.maxContentWidth,
            alignSelf: 'center',
            gap: theme.spacing.base,
            flex: 1,
          }}
        >
          {children}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
