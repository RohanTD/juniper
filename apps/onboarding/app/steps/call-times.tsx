import { useTheme } from '@juniper/theme';
import { router } from 'expo-router';
import { View } from 'react-native';
import {
  CALL_WINDOW_CHOICES,
  deviceTimezone,
  nextStepPath,
  selectedCallWindowIds,
  toCallWindow,
  useOnboarding,
} from '../../src/state';
import { PrimaryButton } from '../../src/ui/Buttons';
import { ChoiceCard } from '../../src/ui/ChoiceCard';
import { Screen } from '../../src/ui/Screen';
import { StepHeader } from '../../src/ui/StepHeader';

export default function CallTimesStep() {
  const theme = useTheme();
  // Selection lives in the draft, not in local state, so every tap is saved.
  const { answers, update, completeStep } = useOnboarding();
  const selected = new Set(selectedCallWindowIds(answers));

  const toggle = (id: string) => {
    const nextSet = new Set(selected);
    if (nextSet.has(id)) {
      nextSet.delete(id);
    } else {
      nextSet.add(id);
    }
    const timezone = deviceTimezone();
    update({
      callWindows: CALL_WINDOW_CHOICES.filter((c) => nextSet.has(c.id)).map((c) =>
        toCallWindow(c, timezone)
      ),
    });
  };

  const next = () => {
    completeStep('/steps/call-times');
    router.push(nextStepPath('/steps/call-times') as string);
  };

  return (
    <Screen>
      <StepHeader
        step="/steps/call-times"
        title="When are calls most welcome?"
        hint="Choose as many as you like. This can always be changed later, just by telling Juniper on a call."
      />
      <View style={{ gap: theme.spacing.md }}>
        {CALL_WINDOW_CHOICES.map((choice) => (
          <ChoiceCard
            key={choice.id}
            title={choice.title}
            subtitle={choice.subtitle}
            selected={selected.has(choice.id)}
            onPress={() => toggle(choice.id)}
          />
        ))}
      </View>
      <PrimaryButton title="Continue" onPress={next} disabled={selected.size === 0} />
    </Screen>
  );
}
