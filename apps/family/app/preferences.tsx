/**
 * Call preferences — the one screen where the family app writes.
 *
 * Everything here lives in the voice service's app-level store, never FHIR
 * and never the clinical record, so this does not breach the read-only
 * posture that keeps the caregiver away from notes and transcripts.
 *
 * Two product rules shape this screen:
 *
 * 1. The patient outranks the caregiver. Every one of these is also
 *    changeable by voice ("call me in the mornings instead"), and the patient
 *    changing their own care must win. The screen says so plainly rather than
 *    letting a daughter believe she has set something permanent.
 * 2. Topics-to-avoid are a hard prohibition, not a hint. They become negative
 *    constraints the compassion filter enforces independently of the
 *    Companion, so the copy treats them as consequential.
 */
import { useTheme } from '@juniper/theme';
import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import {
  describeWindow,
  usePreferences,
  WEEKDAYS,
  type PreferencesState,
} from '../src/data/preferences';
import { useMonitoredPatient } from '../src/data/patient';
import { describeNextCall, nextCall, NEXT_CALL_CAVEAT } from '../src/data/schedule';
import type { CallWindow, PatientPreferences, Weekday } from '../src/preferences';
import { Screen } from '../src/ui/Screen';
import { SectionHeader } from '../src/ui/SectionHeader';
import { ThemedText } from '../src/ui/ThemedText';
import { TopBar } from '../src/ui/TopBar';

const DEFAULT_WINDOW: CallWindow = {
  days: ['mon', 'tue', 'wed', 'thu', 'fri'],
  start: '09:00',
  end: '11:00',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York',
};

export default function Preferences() {
  const theme = useTheme();
  const { patientRef, patient, signedIn } = useMonitoredPatient();
  // The store is keyed by bare patient id; patientRef is "Patient/<id>".
  const patientId = patientRef?.split('/')[1];
  const patientName = patient?.name?.[0]?.given?.[0];
  const state = usePreferences(patientId);
  const [draft, setDraft] = useState<PatientPreferences>();
  const [newTopic, setNewTopic] = useState('');

  useEffect(() => {
    if (state.preferences) setDraft(structuredClone(state.preferences));
  }, [state.preferences]);

  if (!signedIn) return <Redirect href="/sign-in" />;

  const windows = draft?.callWindows ?? [];
  const topics = draft?.topicsToAvoid ?? [];
  const dirty = draft && JSON.stringify(draft) !== JSON.stringify(state.preferences);

  const update = (next: Partial<PatientPreferences>) =>
    setDraft((d) => (d ? { ...d, ...next } : d));

  const setWindow = (index: number, patch: Partial<CallWindow>) =>
    update({ callWindows: windows.map((w, i) => (i === index ? { ...w, ...patch } : w)) });

  const toggleDay = (index: number, day: Weekday) => {
    const current = windows[index]?.days ?? [];
    setWindow(index, {
      days: current.includes(day) ? current.filter((d) => d !== day) : [...current, day],
    });
  };

  return (
    <Screen>
      <TopBar />
      <ThemedText variant="h1" style={{ marginTop: theme.spacing.base }}>
        Call settings
      </ThemedText>
      <ThemedText variant="body" color={theme.colors.text.secondary}>
        When Juniper calls {patientName ?? 'your loved one'}, and what to steer clear of.
      </ThemedText>

      {/* The single most important thing on this screen. */}
      <View
        style={{
          backgroundColor: theme.colors.semantic.info?.bg ?? theme.colors.background.tertiary,
          borderRadius: theme.borderRadius.md,
          padding: theme.spacing.base,
          marginTop: theme.spacing.md,
        }}
      >
        <ThemedText variant="bodySmall" color={theme.colors.text.secondary}>
          {patientName ?? 'Your loved one'} can change any of this simply by saying so during a
          call — “call me in the mornings instead”. If they do, their choice stays.
        </ThemedText>
      </View>

      {state.loading ? (
        <ThemedText variant="body" color={theme.colors.text.secondary}>
          Loading call settings…
        </ThemedText>
      ) : null}

      {state.errorMessage ? (
        <ThemedText variant="body" color={theme.colors.semantic.error.text}>
          We couldn’t load these — {state.errorMessage}.
        </ThemedText>
      ) : null}

      {draft ? (
        <>
          <SectionHeader title="Good times to call" />
          {windows.length === 0 ? (
            <ThemedText variant="bodySmall" color={theme.colors.text.secondary}>
              No times set yet — Juniper will use its default schedule.
            </ThemedText>
          ) : (
            /* Computed from the DRAFT, so the consequence of an edit is visible
               before it is saved. A schedule editor that only shows you what
               you typed makes you do the weekday arithmetic yourself. */
            <NextCallPreview windows={windows} dirty={Boolean(dirty)} />
          )}

          {windows.map((window, index) => (
            <View
              key={index}
              style={{
                borderWidth: 1,
                borderColor: theme.colors.rule,
                borderRadius: theme.borderRadius.lg,
                padding: theme.spacing.base,
                gap: theme.spacing.sm,
              }}
            >
              <ThemedText variant="h4">{describeWindow(window)}</ThemedText>

              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.xs }}>
                {WEEKDAYS.map(({ key, label }) => {
                  const on = (window.days ?? []).includes(key);
                  return (
                    <Pressable
                      key={key}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      accessibilityLabel={label}
                      onPress={() => toggleDay(index, key)}
                      style={{
                        paddingVertical: theme.spacing.sm,
                        paddingHorizontal: theme.spacing.md,
                        borderRadius: theme.borderRadius.full,
                        backgroundColor: on ? theme.colors.primary[500] : 'transparent',
                        borderWidth: 1,
                        borderColor: on ? theme.colors.primary[500] : theme.colors.rule,
                        minHeight: 44,
                        justifyContent: 'center',
                      }}
                    >
                      <ThemedText
                        variant="bodySmall"
                        color={on ? theme.colors.text.inverse : theme.colors.text.primary}
                      >
                        {label}
                      </ThemedText>
                    </Pressable>
                  );
                })}
              </View>

              <View style={{ flexDirection: 'row', gap: theme.spacing.md }}>
                {(['start', 'end'] as const).map((field) => (
                  <View key={field} style={{ flex: 1 }}>
                    <ThemedText variant="meta" color={theme.colors.text.secondary}>
                      {field === 'start' ? 'FROM' : 'UNTIL'}
                    </ThemedText>
                    <TextInput
                      value={window[field]}
                      onChangeText={(text) => setWindow(index, { [field]: text })}
                      placeholder="09:00"
                      accessibilityLabel={`${field === 'start' ? 'From' : 'Until'} time, 24 hour`}
                      style={{
                        borderWidth: 1,
                        borderColor: theme.colors.rule,
                        borderRadius: theme.borderRadius.md,
                        padding: theme.spacing.md,
                        minHeight: 44,
                        color: theme.colors.text.primary,
                        fontFamily: theme.typography.fonts.regular,
                        fontSize: theme.typography.sizes.md,
                      }}
                    />
                  </View>
                ))}
              </View>

              <Pressable
                accessibilityRole="button"
                onPress={() => update({ callWindows: windows.filter((_, i) => i !== index) })}
                style={{ minHeight: 44, justifyContent: 'center' }}
              >
                <ThemedText variant="bodySmall" color={theme.colors.semantic.error.text}>
                  Remove this time
                </ThemedText>
              </Pressable>
            </View>
          ))}

          <Pressable
            accessibilityRole="button"
            onPress={() => update({ callWindows: [...windows, { ...DEFAULT_WINDOW }] })}
            style={{
              borderWidth: 1,
              borderColor: theme.colors.rule,
              borderRadius: theme.borderRadius.md,
              padding: theme.spacing.base,
              alignItems: 'center',
              minHeight: 44,
            }}
          >
            <ThemedText variant="button">Add another time</ThemedText>
          </Pressable>

          <SectionHeader title="Topics to avoid" />
          <ThemedText variant="bodySmall" color={theme.colors.text.secondary}>
            Juniper will never raise these, and will steer away if they come up. Useful for things
            that are painful to talk about.
          </ThemedText>

          {topics.map((topic, index) => (
            <View
              key={`${topic}-${index}`}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderWidth: 1,
                borderColor: theme.colors.rule,
                borderRadius: theme.borderRadius.md,
                padding: theme.spacing.base,
                gap: theme.spacing.md,
              }}
            >
              <ThemedText variant="body" style={{ flex: 1 }}>
                {topic}
              </ThemedText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${topic}`}
                onPress={() => update({ topicsToAvoid: topics.filter((_, i) => i !== index) })}
                style={{ minHeight: 44, justifyContent: 'center' }}
              >
                <ThemedText variant="bodySmall" color={theme.colors.semantic.error.text}>
                  Remove
                </ThemedText>
              </Pressable>
            </View>
          ))}

          <View style={{ flexDirection: 'row', gap: theme.spacing.sm }}>
            <TextInput
              value={newTopic}
              onChangeText={setNewTopic}
              placeholder="e.g. her late husband Robert"
              accessibilityLabel="New topic to avoid"
              style={{
                flex: 1,
                borderWidth: 1,
                borderColor: theme.colors.rule,
                borderRadius: theme.borderRadius.md,
                padding: theme.spacing.md,
                minHeight: 44,
                color: theme.colors.text.primary,
                fontFamily: theme.typography.fonts.regular,
                fontSize: theme.typography.sizes.md,
              }}
            />
            <Pressable
              accessibilityRole="button"
              disabled={!newTopic.trim()}
              onPress={() => {
                update({ topicsToAvoid: [...topics, newTopic.trim()] });
                setNewTopic('');
              }}
              style={{
                borderRadius: theme.borderRadius.md,
                paddingHorizontal: theme.spacing.lg,
                justifyContent: 'center',
                minHeight: 44,
                backgroundColor: newTopic.trim()
                  ? theme.colors.primary[500]
                  : theme.colors.background.tertiary,
              }}
            >
              <ThemedText
                variant="button"
                color={newTopic.trim() ? theme.colors.text.inverse : theme.colors.text.secondary}
              >
                Add
              </ThemedText>
            </Pressable>
          </View>

          <SaveBar state={state} draft={draft} dirty={Boolean(dirty)} />
        </>
      ) : null}
    </Screen>
  );
}

/** "Next call: Tomorrow · 9:00 AM – 11:00 AM EDT", derived from the draft. */
function NextCallPreview({ windows, dirty }: { windows: CallWindow[]; dirty: boolean }) {
  const theme = useTheme();
  const copy = describeNextCall(nextCall(windows));
  return (
    <View style={{ gap: theme.spacing.xs }}>
      <ThemedText variant="bodySmall" color={theme.colors.text.secondary}>
        {copy
          ? `${dirty ? 'Would be' : 'Next call'}: ${copy.day} · ${copy.range}`
          : 'These times don’t describe a call yet — pick at least one day and a valid start and end.'}
      </ThemedText>
      {copy ? (
        <ThemedText variant="caption" color={theme.colors.text.secondary}>
          {NEXT_CALL_CAVEAT}
        </ThemedText>
      ) : null}
    </View>
  );
}

function SaveBar({
  state,
  draft,
  dirty,
}: {
  state: PreferencesState;
  draft: PatientPreferences;
  dirty: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.spacing.sm, marginTop: theme.spacing.base }}>
      <Pressable
        accessibilityRole="button"
        disabled={!dirty || state.saving}
        onPress={() => state.save(draft)}
        style={{
          borderRadius: theme.borderRadius.md,
          padding: theme.spacing.base,
          alignItems: 'center',
          minHeight: 44,
          justifyContent: 'center',
          backgroundColor:
            dirty && !state.saving ? theme.colors.primary[500] : theme.colors.background.tertiary,
        }}
      >
        <ThemedText
          variant="button"
          color={
            dirty && !state.saving ? theme.colors.text.inverse : theme.colors.text.secondary
          }
        >
          {state.saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
        </ThemedText>
      </Pressable>
      {state.justSaved ? (
        <ThemedText variant="bodySmall" color={theme.colors.semantic.success.text}>
          Saved. Juniper will use these from the next call.
        </ThemedText>
      ) : null}
      {state.errorMessage && dirty ? (
        <ThemedText variant="bodySmall" color={theme.colors.semantic.error.text}>
          Not saved — {state.errorMessage}. Your changes are still here.
        </ThemedText>
      ) : null}
    </View>
  );
}
