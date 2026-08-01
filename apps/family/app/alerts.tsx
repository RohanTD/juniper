/**
 * Alerts from the urgency filter's escalation Tasks. Each alert is rendered
 * to be self-sufficient: what was said, when, and what has already happened
 * about it (Task.description carries all three by contract). Live arrival via
 * subscription with polling fallback.
 */
import { useTheme } from '@juniper/theme';
import { Redirect } from 'expo-router';
import { View } from 'react-native';
import { useAlerts } from '../src/data/alerts';
import { useMonitoredPatient } from '../src/data/patient';
import { AlertCard } from '../src/ui/AlertCard';
import { EmptyState } from '../src/ui/EmptyState';
import { Screen } from '../src/ui/Screen';
import { ThemedText } from '../src/ui/ThemedText';

export default function Alerts() {
  const theme = useTheme();
  const { patientRef, signedIn } = useMonitoredPatient();
  const { tasks, loading, error } = useAlerts(patientRef);

  if (!signedIn) {
    return <Redirect href="/sign-in" />;
  }

  return (
    <Screen>
      <ThemedText variant="title" style={{ marginTop: theme.spacing.lg }}>
        Alerts
      </ThemedText>
      <ThemedText variant="body" color={theme.colors.text.secondary}>
        When a call raises something urgent, it appears here along with what the care team has
        already done about it.
      </ThemedText>
      {loading ? (
        <ThemedText variant="body" color={theme.colors.text.secondary}>
          Checking for alerts…
        </ThemedText>
      ) : error ? (
        <EmptyState title="Could not load alerts" body="Please try again shortly." />
      ) : (tasks ?? []).length === 0 ? (
        <EmptyState
          title="No alerts"
          body="Nothing has needed urgent attention. If that changes, it will show up here right away."
        />
      ) : (
        <View style={{ gap: theme.spacing.md }}>
          {(tasks ?? []).map((task) => (
            <AlertCard key={task.id} task={task} />
          ))}
        </View>
      )}
    </Screen>
  );
}
