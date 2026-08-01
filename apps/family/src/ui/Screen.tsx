/**
 * Screen scaffold: safe area, scroll, sunken background so cards read as
 * paper, readable column width on web.
 */
import { useTheme } from '@juniper/theme';
import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const CONTENT_MAX_WIDTH = 640;

export function Screen({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background.secondary }}>
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          padding: theme.spacing.lg,
          paddingBottom: theme.spacing.xxxl,
        }}
      >
        <View
          style={{
            width: '100%',
            maxWidth: CONTENT_MAX_WIDTH,
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
