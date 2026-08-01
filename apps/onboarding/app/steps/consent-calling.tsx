import { useOnboarding, voiceFor } from '../../src/state';
import { ConsentScreen } from '../../src/ui/ConsentScreen';

export default function ConsentCallingStep() {
  const { answers } = useOnboarding();
  const v = voiceFor(answers);
  return (
    <ConsentScreen
      step="/steps/consent-calling"
      consentNumber={1}
      title={
        v.isPatient
          ? 'May Juniper call you for regular check-ins?'
          : 'May Juniper call them for regular check-ins?'
      }
      paragraphs={[
        `Juniper is a friendly automated companion. It calls ${v.object} at the times chosen here, asks how things are going, and shares what matters with the care team.`,
        v.isPatient
          ? 'You can say no. You can also change your mind at any time — just say so on a call, or tell the clinic.'
          : 'You can say no on their behalf. They can also change their mind at any time — just by saying so on a call, or by telling the clinic.',
      ]}
      onDecision={(granted) => ({ consents: { ...answers.consents, aiCalling: granted } })}
    />
  );
}
