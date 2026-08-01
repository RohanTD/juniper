/**
 * The check-in timeline: the theme's cards-over-tables pattern (icon-in-
 * circle, title, subtitle, chevron) grouped under label-plus-rule month
 * headers. Qualitative by design — no charts, no trends.
 */
import { useTheme } from '@juniper/theme';
import { Redirect, router } from 'expo-router';
import { View } from 'react-native';
import { useCheckIns } from '../src/data/checkins';
import { useMonitoredPatient } from '../src/data/patient';
import { checkInSubtitle, checkInTitle, groupEncountersByMonth } from '../src/data/timeline';
import { Card } from '../src/ui/Card';
import { EmptyState } from '../src/ui/EmptyState';
import { Screen } from '../src/ui/Screen';
import { SectionHeader } from '../src/ui/SectionHeader';
import { ThemedText } from '../src/ui/ThemedText';
import { TopBar } from '../src/ui/TopBar';

export default function CheckIns() {
  const theme = useTheme();
  const { patientRef, signedIn } = useMonitoredPatient();
  const { encounters, loading, error } = useCheckIns(patientRef);

  if (!signedIn) {
    return <Redirect href="/sign-in" />;
  }

  const groups = groupEncountersByMonth(encounters ?? []);

  return (
    <Screen>
      <TopBar />
      <ThemedText variant="h1" style={{ marginTop: theme.spacing.base }}>
        Check-in timeline
      </ThemedText>
      {loading ? (
        <ThemedText variant="body" color={theme.colors.text.secondary}>
          Loading check-ins…
        </ThemedText>
      ) : error ? (
        <EmptyState
          title="Could not load check-ins"
          body="Please try again shortly. If this keeps happening, the care team manages who can follow along."
        />
      ) : groups.length === 0 ? (
        <EmptyState
          title="No check-ins yet"
          body="Calls will appear here as they happen, grouped by month."
        />
      ) : (
        groups.map((group) => (
          <View key={group.key}>
            <SectionHeader title={group.label} />
            <View style={{ gap: theme.spacing.md }}>
              {group.encounters.map((encounter) => (
                <Card
                  key={encounter.id}
                  icon="phone-call"
                  title={checkInTitle(encounter)}
                  subtitle={checkInSubtitle(encounter)}
                  onPress={() => router.push(`/checkin/${encounter.id}`)}
                />
              ))}
            </View>
          </View>
        ))
      )}
    </Screen>
  );
}
