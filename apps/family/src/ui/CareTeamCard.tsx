/**
 * "Who do I call?" — the other half of PLAN.md's alert requirement.
 *
 * The names here come only from fields a caregiver may actually read (see
 * ../data/careteam.ts): `Patient.contact`, `Patient.generalPractitioner`'s
 * reference display, and `Task.owner`'s display. CareTeam and Practitioner are
 * both outside the caregiver AccessPolicy, so a clinician's direct number
 * genuinely is not available to this app.
 *
 * The card therefore states that plainly rather than rendering a dead
 * "Call" button or a plausible-looking number. At 11pm, a number that does not
 * connect is worse than no number: it costs the one thing the caregiver has
 * least of, which is the belief that the app is telling them the truth.
 */
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@juniper/theme';
import { Linking, Pressable, View } from 'react-native';
import {
  hasReachableNumber,
  NO_CONTACT_NOTE,
  NO_NUMBER_NOTE,
  type CareContact,
} from '../data/careteam';
import { ThemedText } from './ThemedText';

export function CareTeamCard({ contacts }: { contacts: CareContact[] }) {
  const theme = useTheme();
  const card = theme.recipes.card;
  const circleSize = card.iconCircle.size;

  return (
    <View
      style={{
        backgroundColor: card.background,
        borderRadius: card.borderRadius,
        padding: theme.spacing.xl,
        gap: theme.spacing.md,
        ...card.shadow,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: card.gap }}>
        <View
          style={{
            width: circleSize,
            height: circleSize,
            borderRadius: theme.borderRadius.full,
            backgroundColor: card.iconCircle.background,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Feather name="users" size={Math.round(circleSize / 2)} color={card.iconCircle.color} />
        </View>
        <ThemedText variant="label" color={theme.colors.text.secondary}>
          Care team
        </ThemedText>
      </View>

      {contacts.length === 0 ? (
        <ThemedText variant="bodySmall" color={theme.colors.text.secondary}>
          {NO_CONTACT_NOTE}
        </ThemedText>
      ) : (
        <>
          <View style={{ gap: theme.spacing.md }}>
            {contacts.map((contact) => (
              <ContactRow key={`${contact.source}:${contact.name}`} contact={contact} />
            ))}
          </View>
          {hasReachableNumber(contacts) ? null : (
            <ThemedText variant="bodySmall" color={theme.colors.text.secondary}>
              {NO_NUMBER_NOTE}
            </ThemedText>
          )}
        </>
      )}
    </View>
  );
}

function ContactRow({ contact }: { contact: CareContact }) {
  const theme = useTheme();
  const dial = contact.phone
    ? () => {
        void Linking.openURL(`tel:${contact.phone?.replace(/[^\d+]/g, '')}`);
      }
    : undefined;

  const details = (
    <View style={{ flex: 1, gap: theme.spacing.xs }}>
      <ThemedText variant="h4">{contact.name}</ThemedText>
      {contact.role ? (
        <ThemedText variant="bodySmall" color={theme.colors.text.secondary}>
          {contact.role}
        </ThemedText>
      ) : null}
      {contact.phone ? (
        <ThemedText variant="body" color={theme.colors.text.accent}>
          {contact.phone}
        </ThemedText>
      ) : null}
      {contact.email ? (
        <ThemedText variant="bodySmall" color={theme.colors.text.secondary}>
          {contact.email}
        </ThemedText>
      ) : null}
    </View>
  );

  if (!dial) {
    // No number: a plain row, not a disabled button. A control that looks
    // tappable and is not reads as the app being broken rather than as the
    // number being genuinely unavailable.
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: theme.touchTarget.minHeight }}>
        {details}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Call ${contact.name} at ${contact.phone}`}
      onPress={dial}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.md,
        minHeight: theme.touchTarget.minHeight,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      {details}
      <Feather name="phone" size={theme.recipes.card.chevron.size} color={theme.colors.text.accent} />
    </Pressable>
  );
}
