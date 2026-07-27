import { ActivityIndicator, Pressable, StyleSheet, Text, type PressableProps } from 'react-native';
import { colors } from '../theme/colors';

interface ButtonProps extends PressableProps {
  label: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  loading?: boolean;
}

export function Button({ label, variant = 'primary', loading, disabled, style, ...rest }: ButtonProps) {
  return (
    <Pressable
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.base,
        variantStyles[variant],
        (disabled || loading) && styles.disabled,
        pressed && styles.pressed,
        style as object,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? colors.base950 : colors.ink100} />
      ) : (
        <Text style={[styles.label, variant === 'primary' ? styles.labelDark : styles.labelLight]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    paddingVertical: 13,
    paddingHorizontal: 18,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.85 },
  label: { fontSize: 15, fontWeight: '600' },
  labelDark: { color: colors.base950 },
  labelLight: { color: colors.ink100 },
});

const variantStyles = StyleSheet.create({
  primary: { backgroundColor: colors.signal },
  secondary: { backgroundColor: colors.base700, borderWidth: 1, borderColor: colors.base500 },
  ghost: { backgroundColor: 'transparent' },
  danger: { backgroundColor: 'rgba(248,113,113,0.12)', borderWidth: 1, borderColor: 'rgba(248,113,113,0.35)' },
});
