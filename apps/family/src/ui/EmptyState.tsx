/**
 * Gentle empty/denied state. Access is scoped server-side by the CareTeam-
 * derived AccessPolicy; when a search comes back empty or denied, the app
 * explains softly instead of erroring.
 */
import { useTheme } from '@juniper/theme';
import { View } from 'react-native';
import { ThemedText } from './ThemedText';

export function EmptyState({ title, body }: { title: string; body: string }) {
  const theme = useTheme();
  return (
    <View
      style={{
        backgroundColor: theme.colors.background.primary,
        borderRadius: theme.radii.lg,
        padding: theme.spacing.xl,
        gap: theme.spacing.sm,
        alignItems: 'center',
      }}
    >
      <ThemedText variant="headline" style={{ textAlign: 'center' }}>
        {title}
      </ThemedText>
      <ThemedText
        variant="body"
        color={theme.colors.text.secondary}
        style={{ textAlign: 'center' }}
      >
        {body}
      </ThemedText>
    </View>
  );
}
