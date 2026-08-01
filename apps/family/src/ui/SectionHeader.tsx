/**
 * The theme's label-plus-rule section header: small uppercase mono label with
 * a hairline rule filling the remaining width. Carries the timeline's date
 * groupings.
 */
import { useTheme } from '@juniper/theme';
import { View } from 'react-native';
import { ThemedText } from './ThemedText';

export function SectionHeader({ title }: { title: string }) {
  const theme = useTheme();
  const recipe = theme.recipes.sectionHeader;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: recipe.gap,
        marginTop: recipe.marginTop,
        marginBottom: recipe.marginBottom,
      }}
    >
      <ThemedText variant="label" color={recipe.label.color}>
        {title}
      </ThemedText>
      <View style={{ flex: 1, height: recipe.rule.thickness, backgroundColor: recipe.rule.color }} />
    </View>
  );
}
