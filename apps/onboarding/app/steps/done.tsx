import { useTheme } from '@juniper/theme';
import { View } from 'react-native';
import { Screen } from '../../src/ui/Screen';
import { ThemedText } from '../../src/ui/ThemedText';

export default function DoneStep() {
  const theme = useTheme();
  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: 'center', gap: theme.spacing.base }}>
        <ThemedText variant="label" color={theme.recipes.hero.eyebrow.color}>
          All set
        </ThemedText>
        <ThemedText variant="display">Juniper will take it from here.</ThemedText>
        <ThemedText variant="bodyLarge" color={theme.colors.text.secondary}>
          The first call will come at one of the times you chose. There is nothing more to do here —
          anything set up today can be changed later just by saying so on a call.
        </ThemedText>
        <ThemedText variant="body" color={theme.colors.text.secondary}>
          You can close this window now.
        </ThemedText>
      </View>
    </Screen>
  );
}
