/**
 * The caregiver dashboard — the answer to "how is Mom doing?", above the fold.
 *
 * ## Why it is laid out this way
 *
 * The app runs primarily as a WEB dashboard, so the wide layout is the real
 * one and the phone layout is the graceful fallback (`Screen` opens the measure
 * to 1040px above 900px; `Columns` and `TileRow` do the rest).
 *
 * Reading order top to bottom is deliberately the order of a caregiver's
 * questions, and each band earns its place by answering one:
 *
 * 1. **How is she?** — the status hero: one sentence and a semantic pill. This
 *    is the screen that earns the theme's serif/mono signature.
 * 2. **Does anything need me right now?** — unseen alerts, rendered in full and
 *    at the FULL measure. Not a "1 alert" chip that hides the context, and
 *    deliberately ABOVE the statistics: an alert raised at 11pm must not sit
 *    underneath "calls this month". PLAN.md is explicit that an alert without
 *    context and without someone to contact is worse than useless, and putting
 *    it below a row of counts is the same mistake by a different route.
 * 3. **The facts at a glance** — four tiles: calls this month, last call, next
 *    call, open alerts. Counts and dates, never trends: writes are limited to
 *    notes, so there is no structured data behind a chart and mocking one is
 *    explicitly rejected in PLAN.md.
 * 4. **So what do I do about it?** — family guidance, also at the full measure.
 *    Everything above reports state and everything below reports history; this
 *    is the only band that suggests an action, and burying it in a column would
 *    make the question the product exists to answer the easiest thing to skip.
 * 5. **What's been happening, and who do I call?** — two columns. Left, the
 *    things you read: the check-in timeline INLINE rather than behind a tap,
 *    since "what did they talk about" is the next question and a tap to find
 *    out is a tap too many. Right, the things you glance at: next call, care
 *    team, and the way into settings.
 *
 * On a phone the columns collapse in place. The side column no longer needs to
 * jump ahead of the timeline — "what's coming up" is already answered by a tile
 * four bands above it.
 */
import { useTheme } from '@juniper/theme';
import { Redirect, router } from 'expo-router';
import { View } from 'react-native';
import { useAcknowledgements, acknowledgedPhrase } from '../src/data/acknowledgements';
import { openAlerts, useAlerts } from '../src/data/alerts';
import { careContacts } from '../src/data/careteam';
import { useCheckIns } from '../src/data/checkins';
import { useGuidance } from '../src/data/guidance';
import { patientFirstName as firstNameOf, useMonitoredPatient } from '../src/data/patient';
import { usePreferences } from '../src/data/preferences';
import { describeNextCall, nextCall, nextCallSummary } from '../src/data/schedule';
import { overallStatus, latestCheckInDate, unseenAlerts } from '../src/data/status';
import {
  callsThisMonth,
  checkInSubtitle,
  checkInTitle,
  encounterDate,
  relativeDayPhrase,
} from '../src/data/timeline';
import { AlertCard } from '../src/ui/AlertCard';
import { Card } from '../src/ui/Card';
import { CareTeamCard } from '../src/ui/CareTeamCard';
import { EmptyState } from '../src/ui/EmptyState';
import { GuidanceCard } from '../src/ui/GuidanceCard';
import { Hero } from '../src/ui/Hero';
import { Columns, TileRow } from '../src/ui/Layout';
import { NextCallCard } from '../src/ui/NextCallCard';
import { PatientPicker } from '../src/ui/PatientPicker';
import { Screen } from '../src/ui/Screen';
import { SectionHeader } from '../src/ui/SectionHeader';
import { StatTile } from '../src/ui/StatTile';
import { StatusPill } from '../src/ui/StatusPill';
import { ThemedText } from '../src/ui/ThemedText';
import { TopBar } from '../src/ui/TopBar';

/** Enough recent calls to see a rhythm; the rest live on the timeline screen. */
const INLINE_CHECKINS = 5;
/** Open alerts shown in full on the dashboard before deferring to /alerts. */
const INLINE_ALERTS = 3;

export default function Dashboard() {
  const theme = useTheme();
  const { patientRef, patient, signedIn, profileKind, canChoosePatient, choosePatient } =
    useMonitoredPatient();
  const patientId = patientRef?.split('/')[1];
  const checkIns = useCheckIns(patientRef);
  const alerts = useAlerts(patientRef);
  const preferences = usePreferences(patientId);
  const acks = useAcknowledgements(patientId);
  const guidance = useGuidance(patientRef);

  if (!signedIn) {
    return <Redirect href="/sign-in" />;
  }

  // A patient signed into the CAREGIVER app, looking at their own record.
  //
  // This is not the app's audience, and the failure is silent: every query
  // succeeds, returns nothing, and the dashboard renders in full and empty.
  // It is indistinguishable from a patient who has never been called, and it
  // cost real debugging time to tell the two apart — the only visible symptom
  // was a 403 on the alert Subscription, which their AccessPolicy correctly
  // denies. Say it plainly instead.
  if (profileKind === 'patient') {
    return (
      <Screen>
        <TopBar />
        <EmptyState
          title="This is the family view"
          body={`You're signed in as ${firstNameOf(patient)}, the patient. This app shows a caregiver what has been happening on someone else's check-in calls, so signed in as yourself there is nothing here to follow. If you meant to review your own setup, use the Juniper setup link instead.`}
        />
      </Screen>
    );
  }

  // Staff sign-in with nothing picked yet. Every hook above treats an absent
  // patientRef as "don't query", so without this the dashboard would render in
  // full and be uniformly empty — reading exactly like a patient who has never
  // been called, which is the most misleading thing this screen could say.
  if (!patientRef) {
    return (
      <Screen>
        <TopBar />
        {canChoosePatient ? (
          <PatientPicker selected={patientRef} onSelect={choosePatient} />
        ) : (
          <EmptyState
            title="No patient is linked to this account"
            body="Juniper shows a dashboard to family members on a patient’s care team. This sign-in isn’t linked to anyone yet — ask whoever set up the account to add you to the care team."
          />
        )}
      </Screen>
    );
  }

  const firstName = firstNameOf(patient);
  const encounters = checkIns.encounters ?? [];
  const open = openAlerts(alerts.tasks);
  const unseen = unseenAlerts(open, acks.isAcknowledged);
  const status = overallStatus({
    firstName,
    encounters: checkIns.encounters,
    openAlerts: open,
    unseenAlerts: unseen,
    loading: checkIns.loading || alerts.loading,
    error: checkIns.error || alerts.error,
  });

  const upcoming = describeNextCall(nextCall(preferences.preferences?.callWindows));
  const contacts = careContacts(patient, alerts.tasks);
  const latestEncounter = encounters.find((e) => encounterDate(e) !== undefined);
  const lastCall = latestCheckInDate(checkIns.encounters);
  const recent = encounters.slice(0, INLINE_CHECKINS);

  // Acknowledgement is a nicety layered on the voice service; if that service
  // is unreachable the alerts themselves must still render, so the controls
  // simply do not appear rather than the screen failing.
  const canAcknowledge = !acks.errorMessage;

  const alertControls = (taskId: string | undefined) =>
    canAcknowledge && taskId
      ? {
          acknowledgedPhrase: acknowledgedPhrase(acks.byTaskId[taskId]),
          onAcknowledge: () => void acks.acknowledge(taskId),
          onUndoAcknowledge: () => void acks.undo(taskId),
          busy: acks.saving,
        }
      : {};

  // ---- full-measure band: anything urgent ---------------------------------
  //
  // Driven by UNSEEN alerts, not open ones. "I've seen this" has to actually
  // do something, or it is a button that lies: an alert you have read and
  // decided about should stop being the first thing you see every time you
  // open the dashboard, otherwise the band trains you to ignore it and the one
  // that matters gets ignored with it.
  //
  // Acknowledging is NOT resolving, so nothing is deleted or hidden from the
  // record — the alert stays open, stays on /alerts with its full context, and
  // the count below says how many are still open with the care team. This band
  // answers "what needs me right now", which is a different question.
  const acknowledgedOpen = open.length - unseen.length;
  const urgent =
    unseen.length === 0 ? null : (
      <View>
        <SectionHeader title="Needs attention" />
        {/* Answers "am I looking at current information?" on the page rather
            than in the console. Polling is the normal mode for a caregiver:
            live delivery needs Subscription access the AccessPolicy does not
            grant, which is an access-model decision, not a bug. */}
        {!alerts.live ? (
          <ThemedText variant="meta" color={theme.colors.text.secondary}>
            CHECKING FOR NEW ALERTS EVERY MINUTE
          </ThemedText>
        ) : null}
        <View style={{ gap: theme.spacing.md }}>
          {unseen.slice(0, INLINE_ALERTS).map((task) => (
            <AlertCard key={task.id} task={task} {...alertControls(task.id)} />
          ))}
          {unseen.length > INLINE_ALERTS ? (
            <Card
              icon="bell"
              title={`${unseen.length - INLINE_ALERTS} more to look at`}
              subtitle="See every alert and what happened next"
              onPress={() => router.push('/alerts')}
            />
          ) : null}
          {/* What acknowledging moved out of the way — stated, so the band
              emptying never reads as alerts having disappeared. */}
          {acknowledgedOpen > 0 ? (
            <ThemedText variant="bodySmall" color={theme.colors.text.secondary}>
              {acknowledgedOpen === 1
                ? '1 more alert you’ve marked as seen is still open with the care team.'
                : `${acknowledgedOpen} more alerts you’ve marked as seen are still open with the care team.`}
            </ThemedText>
          ) : null}
        </View>
      </View>
    );


  // ---- left column: what you read ----------------------------------------
  const main = (
    <View>
        <SectionHeader title="Recent check-ins" />
        {checkIns.loading ? (
          <ThemedText variant="body" color={theme.colors.text.secondary}>
            Checking for recent calls…
          </ThemedText>
        ) : checkIns.error ? (
          <EmptyState
            title="We couldn’t load check-ins"
            body="This is a problem reading the record, not a sign that anything is wrong. If it keeps happening, your access may have changed — the care team manages who can follow along."
          />
        ) : recent.length === 0 ? (
          <EmptyState
            title="No check-ins yet"
            body={`When Juniper starts calling ${firstName}, each call will appear here with a plain-language summary.`}
          />
        ) : (
          <View style={{ gap: theme.spacing.md }}>
            {recent.map((encounter) => (
              <Card
                key={encounter.id}
                icon="phone-call"
                title={checkInTitle(encounter)}
                subtitle={checkInSubtitle(encounter)}
                iconColor={theme.colors.semantic.success.icon}
                iconBackground={theme.colors.semantic.success.bg}
                onPress={() => router.push(`/checkin/${encounter.id}`)}
              />
            ))}
            {encounters.length > recent.length ? (
              <Card
                icon="clock"
                title="Full check-in timeline"
                subtitle={`All ${encounters.length} calls, month by month`}
                onPress={() => router.push('/checkins')}
              />
            ) : null}
          </View>
        )}
    </View>
  );

  // ---- right column: what you glance at ----------------------------------
  const side = (
    <>
      <NextCallCard
        copy={upcoming}
        loading={preferences.loading}
        errorMessage={preferences.errorMessage}
        onPressSettings={() => router.push('/preferences')}
      />
      <CareTeamCard contacts={contacts} />
      <Card
        icon="bell"
        title="All alerts"
        subtitle={
          open.length === 0
            ? 'Nothing open — past concerns and how they resolved'
            : `${open.length} open · everything raised so far`
        }
        onPress={() => router.push('/alerts')}
      />
    </>
  );

  return (
    <Screen>
      <TopBar />

      <Hero eyebrow="Juniper Family" title={`How is ${firstName} doing?`}>
        <StatusPill tone={status.tone} label={status.badge} />
        <ThemedText variant="h3">{status.headline}</ThemedText>
        <ThemedText variant="body" color={theme.colors.text.secondary}>
          {status.detail}
        </ThemedText>
      </Hero>

      {/* Before the statistics, not after. An alert raised at 11pm must not
          sit underneath "calls this month" — urgency outranks summary, and
          this is the one band on the page that can require action tonight. */}
      {urgent}

      <TileRow>
        <StatTile
          label="Calls this month"
          value={String(callsThisMonth(encounters))}
          caption={encounters.length === 0 ? 'None recorded yet' : `${encounters.length} in total`}
        />
        <StatTile
          label="Last call"
          value={relativeDayPhrase(lastCall)}
          caption={latestEncounter ? checkInSubtitle(latestEncounter) : 'No calls recorded yet'}
        />
        <StatTile
          label="Next call"
          value={upcoming?.day ?? 'Not set'}
          caption={upcoming ? upcoming.range : nextCallSummary(undefined)}
        />
        <StatTile
          label="Open alerts"
          value={String(open.length)}
          caption={
            open.length === 0
              ? 'Nothing needs attention'
              : unseen.length === 0
                ? // With the attention band empty, this line is the only thing
                  // distinguishing "you have read them all" from "none exist".
                  'You’ve seen them all — still open with the care team'
                : `${unseen.length} not yet seen by you`
          }
          valueColor={open.length > 0 ? theme.colors.semantic.error.text : undefined}
        />
      </TileRow>

      {/* Full measure, like the alerts above it. Everything below reports what
          HAPPENED; this is the only part of the page that answers "so what do
          I do about it?", and burying it in a column would make the question
          the dashboard exists to answer the easiest thing to scroll past. */}
      <GuidanceCard state={guidance} firstName={firstName} />

      <Columns main={main} side={side} />
    </Screen>
  );
}
