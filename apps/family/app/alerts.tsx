/**
 * Alerts from the urgency filter's escalation Tasks. Each alert is rendered to
 * be self-sufficient: what was said, when, and what has already happened about
 * it (Task.description carries all three by contract). Live arrival via
 * subscription with polling fallback.
 *
 * Open alerts are grouped ahead of resolved ones — a resolved concern is worth
 * keeping visible (it is how a caregiver learns the system followed through)
 * but it must never sit between two things that still need reading.
 *
 * "Mark as seen" writes family-side acknowledgement state, NOT Task.status —
 * see src/ui/AlertCard.tsx and src/acknowledgements.ts for why that boundary
 * matters and where it is enforced.
 */
import { useTheme } from '@juniper/theme';
import { Redirect } from 'expo-router';
import { View } from 'react-native';
import { acknowledgedPhrase, useAcknowledgements } from '../src/data/acknowledgements';
import { openAlerts, useAlerts } from '../src/data/alerts';
import { careContacts } from '../src/data/careteam';
import { useMonitoredPatient } from '../src/data/patient';
import { AlertCard } from '../src/ui/AlertCard';
import { CareTeamCard } from '../src/ui/CareTeamCard';
import { EmptyState } from '../src/ui/EmptyState';
import { Screen } from '../src/ui/Screen';
import { SectionHeader } from '../src/ui/SectionHeader';
import { ThemedText } from '../src/ui/ThemedText';
import { TopBar } from '../src/ui/TopBar';

export default function Alerts() {
  const theme = useTheme();
  const { patientRef, patient, signedIn } = useMonitoredPatient();
  const patientId = patientRef?.split('/')[1];
  const { tasks, loading, error } = useAlerts(patientRef);
  const acks = useAcknowledgements(patientId);

  if (!signedIn) {
    return <Redirect href="/sign-in" />;
  }

  const all = tasks ?? [];
  const open = openAlerts(all);
  const openIds = new Set(open.map((task) => task.id));
  const closed = all.filter((task) => !openIds.has(task.id));
  const canAcknowledge = !acks.errorMessage;

  const renderAlert = (task: (typeof all)[number]) => (
    <AlertCard
      key={task.id}
      task={task}
      {...(canAcknowledge && task.id
        ? {
            acknowledgedPhrase: acknowledgedPhrase(acks.byTaskId[task.id]),
            onAcknowledge: () => void acks.acknowledge(task.id as string),
            onUndoAcknowledge: () => void acks.undo(task.id as string),
            busy: acks.saving,
          }
        : {})}
    />
  );

  return (
    <Screen>
      <TopBar />

      <ThemedText variant="h1" style={{ marginTop: theme.spacing.base }}>
        Alerts
      </ThemedText>
      <ThemedText variant="body" color={theme.colors.text.secondary}>
        When a call raises something urgent, it appears here along with what the care team has
        already done about it.
      </ThemedText>

      {acks.errorMessage ? (
        <ThemedText variant="bodySmall" color={theme.colors.text.secondary}>
          You can read every alert, but “mark as seen” is unavailable right now — {acks.errorMessage}.
        </ThemedText>
      ) : null}

      {loading ? (
        <ThemedText variant="body" color={theme.colors.text.secondary}>
          Checking for alerts…
        </ThemedText>
      ) : error ? (
        <EmptyState title="Could not load alerts" body="Please try again shortly." />
      ) : all.length === 0 ? (
        <EmptyState
          title="No alerts"
          body="Nothing has needed urgent attention. If that changes, it will show up here right away."
        />
      ) : (
        <>
          {open.length > 0 ? (
            <View>
              <SectionHeader title="Open" />
              <View style={{ gap: theme.spacing.md }}>{open.map(renderAlert)}</View>
            </View>
          ) : null}
          {closed.length > 0 ? (
            <View>
              <SectionHeader title="Resolved" />
              <View style={{ gap: theme.spacing.md }}>{closed.map(renderAlert)}</View>
            </View>
          ) : null}
        </>
      )}

      {/* The other half of PLAN.md's alert requirement: someone to contact. */}
      <SectionHeader title="If you need to reach someone" />
      <CareTeamCard contacts={careContacts(patient, tasks)} />
    </Screen>
  );
}
