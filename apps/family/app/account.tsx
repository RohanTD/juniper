/**
 * Your account — who Juniper thinks you are, and what that lets you see.
 *
 * Every other screen is about the patient. This one is about the reader, and
 * it exists because the alternative to answering these questions on a page is
 * answering them in a browser console:
 *
 *  - **Who am I signed in as?** A caregiver, the patient, or clinic staff. The
 *    app behaves quite differently for each, and until now nothing said which
 *    one you were. A dashboard that renders empty because you signed in as the
 *    wrong person is indistinguishable from one that is broken.
 *  - **Whose calls am I following, and why am I allowed to?** Access is derived
 *    from CareTeam membership, not granted per person, so "because you are on
 *    Peggy's care team" is the honest answer and the one that explains how to
 *    change it.
 *  - **What can I NOT see?** Stated plainly rather than discovered. A caregiver
 *    reading about an app that listens to their parent's phone calls deserves
 *    the boundary in writing, and it is a product decision rather than a
 *    limitation to bury.
 *
 * Read-only by design. Nothing here is editable, because none of it is the
 * caregiver's to change: their name and contact details belong to the record
 * the clinic keeps, and their access belongs to the care team. Call settings —
 * the one thing they may change — live on their own screen.
 */
import { useTheme } from '@juniper/theme';
import { useMedplumProfile } from '@medplum/react-hooks';
import { Redirect, router } from 'expo-router';
import { View } from 'react-native';
import { patientFirstName, useMonitoredPatient, type ProfileKind } from '../src/data/patient';
import { Card } from '../src/ui/Card';
import { Columns } from '../src/ui/Layout';
import { Screen } from '../src/ui/Screen';
import { SectionHeader } from '../src/ui/SectionHeader';
import { ThemedText } from '../src/ui/ThemedText';
import { TopBar } from '../src/ui/TopBar';

/** How each kind of sign-in should be described to the person holding it. */
const ROLE_COPY: Record<ProfileKind, { label: string; body: string }> = {
  caregiver: {
    label: 'Family member',
    body: 'You can follow one person’s check-in calls, because you are on their care team.',
  },
  patient: {
    label: 'Patient',
    body: 'You are signed in as yourself. This app is built for the family member following along.',
  },
  staff: {
    label: 'Clinic staff',
    body: 'You are not linked to one patient, so you choose whose dashboard to view.',
  },
  'signed-out': { label: 'Signed out', body: '' },
};

/** Best display name for a RelatedPerson / Patient / Practitioner profile. */
function profileName(profile: { name?: { text?: string; given?: string[]; family?: string }[] }) {
  const name = profile?.name?.[0];
  if (!name) return undefined;
  if (name.text) return name.text;
  return [name.given?.join(' '), name.family].filter(Boolean).join(' ').trim() || undefined;
}

function contactValue(
  profile: { telecom?: { system?: string; value?: string }[] },
  system: string
): string | undefined {
  return profile?.telecom?.find((t) => t.system === system)?.value;
}

export default function Account() {
  const theme = useTheme();
  const profile = useMedplumProfile();
  const { patient, signedIn, profileKind } = useMonitoredPatient();

  if (!signedIn) {
    return <Redirect href="/sign-in" />;
  }

  const role = ROLE_COPY[profileKind];
  const name = profileName(profile as never);
  const email = contactValue(profile as never, 'email');
  const phone = contactValue(profile as never, 'phone');
  const relationship =
    (profile as { relationship?: { text?: string; coding?: { display?: string }[] }[] })
      ?.relationship?.[0]?.text ??
    (profile as { relationship?: { coding?: { display?: string }[] }[] })?.relationship?.[0]
      ?.coding?.[0]?.display;

  const details = (
    <View>
      <SectionHeader title="Your details" />
      <View style={{ gap: theme.spacing.md }}>
        <Row label="Name" value={name ?? 'Not recorded'} />
        <Row label="Signed in as" value={role.label} />
        {email ? <Row label="Email" value={email} /> : null}
        {phone ? <Row label="Phone" value={phone} /> : null}
        {relationship ? <Row label="Relationship" value={relationship} /> : null}
      </View>

      {/* Said plainly rather than left to be discovered. */}
      <SectionHeader title="What you can see" />
      <ThemedText variant="body" color={theme.colors.text.secondary}>
        A plain-language summary written for family after each call, when it has been agreed to;
        anything urgent that was raised; and when the next call is due.
      </ThemedText>
      <ThemedText
        variant="body"
        color={theme.colors.text.secondary}
        style={{ marginTop: theme.spacing.sm }}
      >
        You do not see the clinical note, and you never see a recording or a transcript of the
        conversation. Those stay between {patientFirstName(patient)} and their care team.
      </ThemedText>

      <ThemedText
        variant="bodySmall"
        color={theme.colors.text.secondary}
        style={{ marginTop: theme.spacing.base }}
      >
        Your name and contact details come from the record the clinic keeps, so they are not
        editable here — ask the care team to correct anything that is wrong.
      </ThemedText>
    </View>
  );

  const side = (
    <>
      {profileKind === 'caregiver' && patient ? (
        <View
          style={{
            backgroundColor: theme.colors.background.primary,
            borderRadius: theme.borderRadius.lg,
            padding: theme.spacing.lg,
            gap: theme.spacing.xs,
          }}
        >
          <ThemedText variant="meta" color={theme.colors.text.secondary}>
            FOLLOWING
          </ThemedText>
          <ThemedText variant="h3">{patientFirstName(patient)}</ThemedText>
          {/* The honest reason, and the one that explains how to change it:
              access is CareTeam-derived, never granted person by person. */}
          <ThemedText variant="bodySmall" color={theme.colors.text.secondary}>
            You can follow {patientFirstName(patient)}’s calls because you are on their care team.
            To change who has access, the care team is where that is decided.
          </ThemedText>
        </View>
      ) : null}

      <Card
        icon="settings"
        title="Call settings"
        subtitle="When Juniper calls, and what to steer clear of"
        onPress={() => router.push('/preferences')}
      />
    </>
  );

  return (
    <Screen>
      <TopBar />
      <ThemedText variant="h1" style={{ marginTop: theme.spacing.base }}>
        Your account
      </ThemedText>
      <ThemedText variant="body" color={theme.colors.text.secondary}>
        {role.body}
      </ThemedText>
      <Columns main={details} side={side} />
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View
      style={{
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.rule,
        paddingBottom: theme.spacing.sm,
        gap: theme.spacing.xs,
      }}
    >
      <ThemedText variant="meta" color={theme.colors.text.secondary}>
        {label.toUpperCase()}
      </ThemedText>
      <ThemedText variant="body">{value}</ThemedText>
    </View>
  );
}
