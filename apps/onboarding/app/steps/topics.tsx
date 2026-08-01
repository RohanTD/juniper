import { useTheme } from '@juniper/theme';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { nextStepPath, useOnboarding } from '../../src/state';
import { PrimaryButton, SecondaryButton } from '../../src/ui/Buttons';
import { Screen } from '../../src/ui/Screen';
import { StepHeader } from '../../src/ui/StepHeader';
import { TextField } from '../../src/ui/TextField';
import { ThemedText } from '../../src/ui/ThemedText';

export default function TopicsStep() {
  const theme = useTheme();
  const { answers, update } = useOnboarding();
  const [topics, setTopics] = useState<string[]>(answers.topicsToAvoid);
  const [draft, setDraft] = useState('');
  const nextPath = nextStepPath('/steps/topics') as string;

  const addTopic = () => {
    const topic = draft.trim();
    if (topic && !topics.includes(topic)) {
      setTopics([...topics, topic]);
    }
    setDraft('');
  };

  const removeTopic = (topic: string) => {
    setTopics(topics.filter((t) => t !== topic));
  };

  const next = () => {
    update({ topicsToAvoid: topics });
    router.push(nextPath);
  };

  return (
    <Screen>
      <StepHeader
        step="/steps/topics"
        title="Anything Juniper should not bring up?"
        hint="Some subjects are painful. Juniper will steer clear of anything listed here — for example, a late spouse."
      />
      <TextField
        label="Topic to avoid"
        value={draft}
        onChangeText={setDraft}
        onSubmitEditing={addTopic}
        placeholder="For example: her late husband Robert"
        returnKeyType="done"
      />
      {draft.trim() !== '' ? <SecondaryButton title="Add this topic" onPress={addTopic} /> : null}
      {topics.length > 0 ? (
        <View style={{ gap: theme.spacing.sm }}>
          {topics.map((topic) => (
            <Pressable
              key={topic}
              accessibilityRole="button"
              accessibilityLabel={`Remove topic: ${topic}`}
              onPress={() => removeTopic(topic)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                backgroundColor: theme.colors.background.secondary,
                borderRadius: theme.radii.md,
                paddingHorizontal: theme.spacing.lg,
                paddingVertical: theme.spacing.md,
                minHeight: theme.touchTarget.minHeight,
                gap: theme.spacing.md,
              }}
            >
              <ThemedText variant="body" style={{ flexShrink: 1 }}>
                {topic}
              </ThemedText>
              <ThemedText variant="body" color={theme.colors.text.secondary}>
                Remove
              </ThemedText>
            </Pressable>
          ))}
        </View>
      ) : null}
      <PrimaryButton title={topics.length > 0 ? 'Continue' : 'Nothing to avoid — continue'} onPress={next} />
    </Screen>
  );
}
