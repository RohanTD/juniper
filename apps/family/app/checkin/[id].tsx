/**
 * One check-in: the plain-language FAMILY summary (juniper-family-summary
 * category), resolved through its Binary. This app never reads the clinical
 * note or the transcript — the caregiver AccessPolicy excludes them, and no
 * code path here references those categories.
 */
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@juniper/theme';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { Pressable, View } from 'react-native';
import { useFamilySummary } from '../../src/data/checkins';
import { useMonitoredPatient } from '../../src/data/patient';
import { EmptyState } from '../../src/ui/EmptyState';
import { Screen } from '../../src/ui/Screen';
import { SectionHeader } from '../../src/ui/SectionHeader';
import { ThemedText } from '../../src/ui/ThemedText';

export default function CheckInDetail() {
  const theme = useTheme();
  const { signedIn } = useMonitoredPatient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const summary = useFamilySummary(typeof id === 'string' ? id : undefined);

  if (!signedIn) {
    return <Redirect href="/sign-in" />;
  }

  return (
    <Screen>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.back()}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.spacing.xs,
          minHeight: theme.touchTarget.minHeight,
          marginTop: theme.spacing.sm,
        }}
      >
        <Feather name="chevron-left" size={theme.recipes.card.chevron.size} color={theme.colors.text.secondary} />
        <ThemedText variant="body" color={theme.colors.text.secondary}>
          Back
        </ThemedText>
      </Pressable>

      <ThemedText variant="h1">Check-in summary</ThemedText>

      {summary.loading ? (
        <ThemedText variant="body" color={theme.colors.text.secondary}>
          Loading the summary…
        </ThemedText>
      ) : summary.error ? (
        <EmptyState
          title="Could not load this summary"
          body="Please try again shortly."
        />
      ) : summary.notShared ? (
        <EmptyState
          title="No summary for this call"
          body="A summary is only written when your loved one has agreed to share with family. There is nothing else to see for this call."
        />
      ) : (
        <View
          style={{
            backgroundColor: theme.colors.background.primary,
            borderRadius: theme.borderRadius.lg,
            padding: theme.spacing.xl,
            gap: theme.spacing.md,
          }}
        >
          <SectionHeader title="From the call" />
          {(summary.text ?? '')
            .split(/\n{2,}/)
            .filter((paragraph) => paragraph.trim() !== '')
            .map((paragraph) => (
              <ThemedText key={paragraph.slice(0, 40)} variant="bodyLarge">
                {paragraph.trim()}
              </ThemedText>
            ))}
        </View>
      )}
    </Screen>
  );
}
