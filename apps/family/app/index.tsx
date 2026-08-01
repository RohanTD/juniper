/**
 * The "how is Mom doing" summary — the ONE screen that earns the theme's
 * serif-display-plus-mono-eyebrow signature. Reassurance and awareness, not
 * diagnosis: latest check-in, open alerts, and the two places to go deeper.
 * No charts by design — there is no structured data to trend yet.
 */
import { useTheme } from '@juniper/theme';
import { Redirect, router } from 'expo-router';
import { View } from 'react-native';
import { openAlerts, useAlerts } from '../src/data/alerts';
import { useCheckIns } from '../src/data/checkins';
import { patientFirstName, useMonitoredPatient } from '../src/data/patient';
import { checkInSubtitle, lastCheckInPhrase } from '../src/data/timeline';
import { Card } from '../src/ui/Card';
import { EmptyState } from '../src/ui/EmptyState';
import { Hero } from '../src/ui/Hero';
import { Screen } from '../src/ui/Screen';
import { SectionHeader } from '../src/ui/SectionHeader';
import { ThemedText } from '../src/ui/ThemedText';

export default function Summary() {
  const theme = useTheme();
  const { patientRef, patient, signedIn } = useMonitoredPatient();
  const { encounters, loading, error } = useCheckIns(patientRef);
  const alerts = useAlerts(patientRef);

  if (!signedIn) {
    return <Redirect href="/sign-in" />;
  }

  const firstName = patientFirstName(patient);
  const latest = encounters?.[0];
  const open = openAlerts(alerts.tasks);

  return (
    <Screen>
      <Hero eyebrow="Juniper Family" title={`How is ${firstName} doing?`} />

      {open.length > 0 ? (
        <Card
          icon="alert-circle"
          title={open.length === 1 ? 'Something needs attention' : `${open.length} things need attention`}
          subtitle="Read what happened and what has been done"
          iconColor={theme.colors.semantic.error.icon}
          iconBackground={theme.colors.semantic.error.bg}
          onPress={() => router.push('/alerts')}
        />
      ) : null}

      <SectionHeader title="Latest" />
      {loading ? (
        <ThemedText variant="body" color={theme.colors.text.secondary}>
          Checking for recent calls…
        </ThemedText>
      ) : error ? (
        <EmptyState
          title="Nothing to show right now"
          body="We could not load check-ins. If this keeps happening, your access may have changed — the care team manages who can follow along."
        />
      ) : latest ? (
        <Card
          icon="check"
          title={lastCheckInPhrase(encounters ?? [])}
          subtitle={checkInSubtitle(latest)}
          iconColor={theme.colors.semantic.success.icon}
          iconBackground={theme.colors.semantic.success.bg}
          onPress={() => router.push(`/checkin/${latest.id}`)}
        />
      ) : (
        <EmptyState
          title="No check-ins yet"
          body={`When Juniper starts calling ${firstName}, each call will show up here with a plain-language summary.`}
        />
      )}

      <SectionHeader title="Explore" />
      <View style={{ gap: theme.spacing.md }}>
        <Card
          icon="phone"
          title="Check-in timeline"
          subtitle="Every call, month by month"
          onPress={() => router.push('/checkins')}
        />
        <Card
          icon="bell"
          title="Alerts"
          subtitle="Concerns raised and what happened next"
          onPress={() => router.push('/alerts')}
        />
      </View>
    </Screen>
  );
}
