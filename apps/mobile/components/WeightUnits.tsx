import { useState } from "react";
import { TextInput, TextInputProps } from "react-native";
import { gramTextInUnit, unitTextInGrams, WeightUnit } from "@/services/weightUnits";

export function WeightTextInput({ grams, onChangeGrams, unit, ...props }: Omit<TextInputProps, "value" | "onChangeText"> & {
  grams: string; onChangeGrams: (value: string) => void; unit: WeightUnit;
}) {
  const [typed, setTyped] = useState<{ text: string; grams: string; unit: WeightUnit } | null>(null);
  const value = typed?.unit === unit && typed.grams === grams ? typed.text : gramTextInUnit(grams, unit);
  return <TextInput {...props} keyboardType="decimal-pad" value={value} onChangeText={text => {
    const next = unitTextInGrams(text, unit);
    setTyped({ text, grams: next, unit }); onChangeGrams(next);
  }} />;
}

