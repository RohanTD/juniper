/**
 * "What do you enjoy?" — the one screen that is not about clinical safety.
 *
 * Everything else onboarding asks is logistics or permission. This is the
 * screen that decides whether the first call sounds like a form or like
 * someone who was told about you: the difference between "how has your week
 * been?" and "did you get out into the garden this week?".
 *
 * It earns its place three times over:
 *
 *  - **The Companion** opens with something real instead of a generic greeting,
 *    which is the whole premise of the product — the primary value of the call
 *    is feeling known (docs/PLAN.md).
 *  - **What Matters**, the first of the 4Ms, is precisely this. A patient who
 *    has already named gardening and their grandchildren has given the 4M
 *    agent a starting point rather than a cold open.
 *  - **Family guidance** turns them into something a relative can act on. "Take
 *    her for a walk" is generic; "she used to love the rose garden on Sundays"
 *    is a plan.
 *
 * Suggestion chips exist because a blank box after twelve questions gets
 * "nothing really" from someone tired of typing. They are prompts, not a menu:
 * anything can be typed instead, and the chips are ordinary interests rather
 * than anything a clinician would code.
 */
import { useTheme } from '@juniper/theme';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { nextStepPath, useOnboarding, voiceFor } from '../../src/state';
import { PrimaryButton, SecondaryButton } from '../../src/ui/Buttons';
import { Screen } from '../../src/ui/Screen';
import { StepHeader } from '../../src/ui/StepHeader';
import { TextField } from '../../src/ui/TextField';
import { ThemedText } from '../../src/ui/ThemedText';

/** Prompts, not a taxonomy. Broad enough that most people see one that fits. */
const SUGGESTIONS = [
  'Gardening',
  'Grandchildren',
  'Cooking',
  'Reading',
  'Music',
  'Church',
  'Card games',
  'Walking',
  'Baseball',
  'Crosswords',
  'Knitting',
  'Old films',
] as const;

export default function InterestsStep() {
  const theme = useTheme();
  const { answers, update, completeStep } = useOnboarding();
  const interests = answers.interests;
  const v = voiceFor(answers);
  const [draft, setDraft] = useState('');
  const nextPath = nextStepPath('/steps/interests') as string;

  const add = (value: string) => {
    const interest = value.trim();
    if (interest && !interests.some((i) => i.toLowerCase() === interest.toLowerCase())) {
      update({ interests: [...interests, interest] });
    }
  };

  const remove = (interest: string) => {
    update({ interests: interests.filter((i) => i !== interest) });
  };

  const next = () => {
    completeStep('/steps/interests');
    router.push(nextPath);
  };

  const unused = SUGGESTIONS.filter(
    (s) => !interests.some((i) => i.toLowerCase() === s.toLowerCase())
  );

  return (
    <Screen>
      <StepHeader
        step="/steps/interests"
        title={v.isPatient ? 'What do you enjoy?' : 'What do they enjoy?'}
        hint={
          v.isPatient
            ? 'Juniper will ask about these, so the calls feel like a conversation rather than a questionnaire.'
            : 'Juniper will ask about these, so the calls feel like a conversation rather than a questionnaire.'
        }
      />

      {unused.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
          {unused.map((suggestion) => (
            <Pressable
              key={suggestion}
              accessibilityRole="button"
              accessibilityLabel={`Add ${suggestion}`}
              onPress={() => add(suggestion)}
              style={{
                paddingVertical: theme.spacing.md,
                paddingHorizontal: theme.spacing.base,
                borderRadius: theme.borderRadius.full,
                borderWidth: 1,
                borderColor: theme.colors.rule,
                minHeight: theme.touchTarget.minHeight,
                justifyContent: 'center',
              }}
            >
              <ThemedText variant="body">{suggestion}</ThemedText>
            </Pressable>
          ))}
        </View>
      ) : null}

      <TextField
        label="Something else"
        value={draft}
        onChangeText={setDraft}
        onSubmitEditing={() => {
          add(draft);
          setDraft('');
        }}
        placeholder="For example: birdwatching"
        returnKeyType="done"
      />
      {draft.trim() !== '' ? (
        <SecondaryButton
          title="Add this"
          onPress={() => {
            add(draft);
            setDraft('');
          }}
        />
      ) : null}

      {interests.length > 0 ? (
        <View style={{ gap: theme.spacing.sm }}>
          <ThemedText variant="label" color={theme.recipes.sectionHeader.label.color}>
            ADDED
          </ThemedText>
          {interests.map((interest) => (
            <Pressable
              key={interest}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${interest}`}
              onPress={() => remove(interest)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                backgroundColor: theme.colors.background.secondary,
                borderRadius: theme.borderRadius.md,
                paddingHorizontal: theme.spacing.base,
                paddingVertical: theme.spacing.md,
                minHeight: theme.touchTarget.minHeight,
                gap: theme.spacing.md,
              }}
            >
              <ThemedText variant="body" style={{ flexShrink: 1 }}>
                {interest}
              </ThemedText>
              <ThemedText variant="body" color={theme.colors.text.secondary}>
                Remove
              </ThemedText>
            </Pressable>
          ))}
        </View>
      ) : null}

      {/* Skippable, and the button says so plainly. This screen is a gift to
          the conversation, never a gate — and a tired patient pressed into
          inventing hobbies gives worse answers than one who moves on. */}
      <PrimaryButton
        title={interests.length > 0 ? 'Continue' : 'Skip for now'}
        onPress={next}
      />
    </Screen>
  );
}
