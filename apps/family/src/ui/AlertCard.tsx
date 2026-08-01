/**
 * One escalation alert, rendered to be self-sufficient at 11pm: what was said
 * (Task.description is authored for this), when, what has already happened, and
 * who it was routed to. Semantic error ramp for open alerts; success for
 * resolved ones — meaning, never decoration.
 *
 * ## The acknowledgement, and what it deliberately is not
 *
 * "Mark as seen" writes to the voice service's app-level store, NOT to
 * `Task.status`. The Task is addressed to the care team: its status is the
 * record of what a clinician did, and a caregiver setting it to `completed`
 * would tell every later reader that clinical action was taken. It is also
 * moot at the API — the caregiver AccessPolicy is read-only on Task.
 *
 * So the card holds two independent facts and shows both: what the CARE TEAM
 * has done (`alertStatusLine`, from Task.status) and what YOU have done
 * (the acknowledgement). Collapsing them into one control is precisely the
 * confusion that would make a caregiver think their tap summoned a nurse.
 */
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@juniper/theme';
import type { Task } from '@medplum/fhirtypes';
import { Pressable, View } from 'react-native';
import { alertStatusLine, alertWhen, humaniseDescription } from '../data/alerts';
import { ThemedText } from './ThemedText';

export interface AlertCardProps {
  task: Task;
  /** Receipt line, e.g. "You marked this as seen on Friday at 11:04 PM". */
  acknowledgedPhrase?: string;
  /** Omitted when acknowledgement is unavailable (service unreachable). */
  onAcknowledge?: () => void;
  onUndoAcknowledge?: () => void;
  busy?: boolean;
}

export function AlertCard({
  task,
  acknowledgedPhrase,
  onAcknowledge,
  onUndoAcknowledge,
  busy,
}: AlertCardProps) {
  const theme = useTheme();
  const resolved = task.status === 'completed';
  const acknowledged = Boolean(acknowledgedPhrase);
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
        // An acknowledged alert stays fully legible — it is dimmed by nothing.
        // It simply stops shouting: the border goes quiet and the receipt
        // appears. Hiding it would defeat the point of a durable record.
        borderWidth: 1,
        borderColor: acknowledged ? theme.colors.rule : semantic.bg,
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
        {humaniseDescription(task.description) ?? 'No details were recorded for this alert.'}
      </ThemedText>

      {/* What the CARE TEAM has done — read from Task.status, never written. */}
      <ThemedText variant="bodySmall" color={semantic.fgOnBg}>
        {alertStatusLine(task)}
        {task.owner?.display ? ` Routed to ${task.owner.display}.` : ''}
      </ThemedText>

      {/* What YOU have done — the family-side acknowledgement. */}
      {onAcknowledge || onUndoAcknowledge ? (
        <View style={{ gap: theme.spacing.xs }}>
          {acknowledged ? (
            <>
              <ThemedText variant="bodySmall" color={semantic.fgOnBg}>
                {acknowledgedPhrase}
              </ThemedText>
              {onUndoAcknowledge ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Undo marking this alert as seen"
                  onPress={onUndoAcknowledge}
                  disabled={busy}
                  style={{
                    minHeight: theme.touchTarget.minHeight,
                    justifyContent: 'center',
                    opacity: busy ? 0.6 : 1,
                  }}
                >
                  <ThemedText variant="button" color={semantic.fgOnBg}>
                    Undo
                  </ThemedText>
                </Pressable>
              ) : null}
            </>
          ) : onAcknowledge ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Mark this alert as seen by me"
              onPress={onAcknowledge}
              disabled={busy}
              style={({ pressed }) => ({
                alignSelf: 'flex-start',
                minHeight: theme.touchTarget.minHeight,
                justifyContent: 'center',
                paddingHorizontal: theme.spacing.lg,
                borderRadius: theme.borderRadius.md,
                borderWidth: 1,
                borderColor: semantic.icon,
                backgroundColor: theme.colors.background.primary,
                opacity: busy ? 0.6 : pressed ? 0.85 : 1,
              })}
            >
              <ThemedText variant="button" color={semantic.fgOnBg}>
                {busy ? 'Saving…' : 'Mark as seen by me'}
              </ThemedText>
            </Pressable>
          ) : null}
          <ThemedText variant="caption" color={semantic.fgOnBg}>
            Marking this as seen is just for you — it does not close the alert or change what the
            care team is doing.
          </ThemedText>
        </View>
      ) : null}
    </View>
  );
}
