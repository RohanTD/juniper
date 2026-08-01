/**
 * One escalation alert, rendered to be self-sufficient at 11pm: what was said
 * (Task.description is authored for this), when, and what has already
 * happened. Semantic error ramp for open alerts; success for resolved ones —
 * meaning, never decoration.
 */
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@juniper/theme';
import type { Task } from '@medplum/fhirtypes';
import { View } from 'react-native';
import { alertStatusLine, alertWhen } from '../data/alerts';
import { ThemedText } from './ThemedText';

export function AlertCard({ task }: { task: Task }) {
  const theme = useTheme();
  const resolved = task.status === 'completed';
  const semantic = resolved ? theme.colors.semantic.success : theme.colors.semantic.error;
  const card = theme.recipes.card;
  const circleSize = card.iconCircle.size;
  return (
    <View
      style={{
        backgroundColor: semantic.bg,
        borderRadius: card.borderRadius,
        padding: card.padding,
        gap: theme.spacing.md,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: card.gap }}>
        <View
          style={{
            width: circleSize,
            height: circleSize,
            borderRadius: theme.borderRadius.full,
            backgroundColor: theme.colors.background.primary,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Feather
            name={resolved ? 'check-circle' : 'alert-circle'}
            size={Math.round(circleSize / 2)}
            color={semantic.icon}
          />
        </View>
        <View style={{ flex: 1, gap: theme.spacing.xs }}>
          <ThemedText variant="h3" color={semantic.fgOnBg}>
            {resolved ? 'Resolved concern' : 'Urgent concern'}
          </ThemedText>
          <ThemedText variant="bodySmall" color={semantic.fgOnBg}>
            {alertWhen(task)}
          </ThemedText>
        </View>
      </View>
      <ThemedText variant="body" color={semantic.fgOnBg}>
        {task.description ?? 'No details were recorded for this alert.'}
      </ThemedText>
      <ThemedText variant="bodySmall" color={semantic.fgOnBg}>
        {alertStatusLine(task)}
      </ThemedText>
    </View>
  );
}
