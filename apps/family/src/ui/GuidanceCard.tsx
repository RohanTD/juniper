/**
 * "Ideas for this week" — the dashboard's only forward-looking surface.
 *
 * Everything else on this screen reports what happened. This is the one place
 * that answers the question a caregiver actually arrives with: *what am I
 * supposed to do about it?*
 *
 * Three presentation rules, each of them a safety rule wearing an interface:
 *
 *  1. **The evidence is always visible.** Every suggestion says how many calls
 *     it rests on, and the card says how many were considered. A suggestion
 *     that arrives without its evidence invites more confidence than it has
 *     earned, and this is a dashboard about someone's mother.
 *  2. **It says what it is.** A one-line disclaimer, not buried: these are
 *     ideas from what came up on the calls, not medical advice. The generator
 *     structurally cannot produce clinical advice (see guidance.py), and the
 *     reader should not have to take that on trust.
 *  3. **Absence reads as normal.** No guidance yet is the ordinary state for a
 *     new patient, and for anyone who has not consented to family sharing. It
 *     is never rendered as a failure.
 */
import { useTheme } from '@juniper/theme';
import { View } from 'react-native';
import {
  domainLabel,
  evidencePhrase,
  kindLabel,
  type GuidanceState,
  type Suggestion,
} from '../data/guidance';
import { SectionHeader } from './SectionHeader';
import { ThemedText } from './ThemedText';

export interface GuidanceCardProps {
  state: GuidanceState;
  firstName: string;
}

export function GuidanceCard({ state, firstName }: GuidanceCardProps) {
  const theme = useTheme();
  const suggestions = state.guidance?.suggestions ?? [];
  const evidence = evidencePhrase(state.guidance);

  return (
    <View style={{ gap: theme.spacing.md }}>
      <SectionHeader title="Ideas for this week" />

      {state.loading ? (
        <ThemedText variant="bodySmall" color={theme.colors.text.secondary}>
          Looking at recent calls…
        </ThemedText>
      ) : null}

      {state.error ? (
        <ThemedText variant="bodySmall" color={theme.colors.text.secondary}>
          We couldn’t load suggestions just now. The check-ins below are unaffected.
        </ThemedText>
      ) : null}

      {!state.loading && !state.error && suggestions.length === 0 ? (
        <ThemedText variant="bodySmall" color={theme.colors.text.secondary}>
          {state.guidance?.unavailableReason ??
            `Nothing to suggest yet — Juniper waits for a few calls with ${firstName} before drawing any conclusions.`}
        </ThemedText>
      ) : null}

      {suggestions.map((suggestion, index) => (
        <SuggestionRow key={`${suggestion.domain}-${suggestion.kind}-${index}`} suggestion={suggestion} />
      ))}

      {suggestions.length > 0 ? (
        <View
          style={{
            borderTopWidth: 1,
            borderTopColor: theme.colors.rule,
            paddingTop: theme.spacing.md,
            gap: theme.spacing.xs,
          }}
        >
          {evidence ? (
            <ThemedText variant="meta" color={theme.colors.text.secondary}>
              {evidence.toUpperCase()}
            </ThemedText>
          ) : null}
          <ThemedText variant="bodySmall" color={theme.colors.text.secondary}>
            These are ideas drawn from what {firstName} talked about — not medical advice. For
            anything clinical, speak to their care team.
          </ThemedText>
        </View>
      ) : null}
    </View>
  );
}

function SuggestionRow({ suggestion }: { suggestion: Suggestion }) {
  const theme = useTheme();
  const kind = kindLabel(suggestion.kind);
  return (
    <View
      style={{
        backgroundColor: theme.colors.background.primary,
        borderRadius: theme.borderRadius.lg,
        padding: theme.spacing.base,
        gap: theme.spacing.xs,
      }}
    >
      <ThemedText variant="meta" color={theme.colors.text.secondary}>
        {[kind, domainLabel(suggestion.domain)].filter(Boolean).join(' · ').toUpperCase()}
      </ThemedText>
      <ThemedText variant="h4">{suggestion.suggestion}</ThemedText>
      <ThemedText variant="bodySmall" color={theme.colors.text.secondary}>
        {suggestion.observation}
      </ThemedText>
      {/* The evidence count rides with the suggestion, not just in the footer:
          a reader scanning one card should not have to look elsewhere to know
          whether it rests on three calls or on one remark. */}
      <ThemedText variant="meta" color={theme.colors.text.secondary}>
        {`FROM ${suggestion.supportingCalls} ${suggestion.supportingCalls === 1 ? 'CALL' : 'CALLS'}`}
      </ThemedText>
    </View>
  );
}
