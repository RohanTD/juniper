import { useOnboarding, voiceFor } from '../../src/state';
import { ConsentScreen } from '../../src/ui/ConsentScreen';

export default function ConsentSharingStep() {
  const { answers } = useOnboarding();
  const v = voiceFor(answers);
  return (
    <ConsentScreen
      step="/steps/consent-sharing"
      consentNumber={3}
      title="May family read a plain-language summary?"
      paragraphs={[
        `If ${v.subject} agree, the family contact named here can read a short, friendly summary after each call — how it went, and anything worth knowing.`,
        'That contact never sees the medical notes or the conversation itself, only the summary. Say no and nothing is shared with family at all.',
      ]}
      onDecision={(granted) => ({ consents: { ...answers.consents, familySharing: granted } })}
    />
  );
}
