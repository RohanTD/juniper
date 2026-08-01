/**
 * Screen scaffold: safe area, scroll, background token, generous padding, and
 * a readable column width on web (the magic-link-on-a-laptop flow).
 */
import { useTheme } from '@juniper/theme';
import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/** Readable measure for the web export; tokens govern everything else. */
const CONTENT_MAX_WIDTH = 560;

export function Screen({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background.primary }}>
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          padding: theme.spacing.xl,
          paddingBottom: theme.spacing.xxxl,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View
          style={{
            width: '100%',
            maxWidth: CONTENT_MAX_WIDTH,
            alignSelf: 'center',
            gap: theme.spacing.lg,
            flex: 1,
          }}
        >
          {children}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
