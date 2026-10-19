import { useState } from "react";
import { Linking, Modal, ScrollView, Text, View } from "react-native";
import { Button } from "@/components/Button";
import { PhotoCredit } from "@/components/PhotoCredit";
import { RecipePhoto } from "@/features/recipes/RecipePhoto";
import { Candidate, RecipePayload, WorkoutPayload, sourceLink, statusLabel } from "./types";
import { styles } from "./styles";

export function CandidatePreview({ candidate, onClose }: { candidate: Candidate; onClose: () => void }) {
  const [linkError, setLinkError] = useState(false);
  const link = sourceLink(candidate.source_url);
  return <Modal visible transparent animationType="slide" onRequestClose={onClose}>
    <View style={styles.backdrop}><View style={styles.sheet} accessibilityViewIsModal>
      <View style={styles.row}>
        <Text accessibilityRole="header" style={[styles.title, styles.copy]}>{candidate.title}</Text>
        <Button label="" icon="close" accessibilityLabel="Close daily addition preview" onPress={onClose} />
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.preview}>
        <RecipePhoto photoUrl={candidate.photo_url} accessibilityLabel={candidate.title} style={styles.photo} />
        <PhotoCredit key={candidate.id} credit={candidate.photo_credit} />
        <Text style={styles.meta}>{candidate.kind === "recipe" ? "Recipe" : "Workout"} - {statusLabel(candidate.status)}</Text>
        {candidate.warnings.map((warning, index) => <Text key={index} style={styles.error}>{warning}</Text>)}
        {candidate.kind === "recipe" ? <RecipePreview payload={candidate.payload} /> : <WorkoutPreview payload={candidate.payload} />}
        {link ? <Button label="Open source" icon="open-outline" onPress={() => {
          setLinkError(false);
          void Linking.openURL(link).catch(() => setLinkError(true));
        }} /> : null}
        {linkError ? <Text accessibilityRole="alert" style={styles.error}>Couldn't open the source.</Text> : null}
      </ScrollView>
    </View></View>
  </Modal>;
}

function RecipePreview({ payload }: { payload: RecipePayload }) {
  const nutrition = payload.nutrition;
  return <>
    {payload.description ? <Text style={styles.text}>{payload.description}</Text> : null}
    <View style={styles.wrap}>
      {payload.servings != null ? <Text style={styles.meta}>{payload.servings} servings</Text> : null}
      {([["Prep", payload.prep_minutes], ["Cook", payload.cook_minutes], ["Total", payload.total_minutes]] as const).map(([label, value]) =>
        value != null ? <Text key={label} style={styles.meta}>{label}: {value} min</Text> : null)}
    </View>
    <View style={styles.wrap}>{[payload.meal_type, payload.difficulty, payload.cuisine].filter(Boolean).map((value, index) => <Text key={index} style={styles.meta}>{statusLabel(value!)}</Text>)}</View>
    <View style={styles.divider}>
      <Text style={styles.label}>Nutrition per serving</Text>
      {nutrition ? <View style={styles.wrap}>{([
        ["Calories", nutrition.calories, "kcal"], ["Protein", nutrition.protein_g, "g"], ["Carbs", nutrition.carbs_g, "g"], ["Fat", nutrition.fat_g, "g"], ["Fiber", nutrition.fiber_g, "g"]
      ] as const).map(([label, value, unit]) => <Text key={label} style={styles.meta}>{label}: {value == null ? "Not provided" : `${value} ${unit}`}</Text>)}</View>
        : <Text style={styles.meta}>Not provided</Text>}
    </View>
    <View style={styles.divider}><Text style={styles.label}>Ingredients</Text>
      {payload.ingredients.map((item, index) => <Text key={index} style={styles.text}>{item.original_text}</Text>)}
    </View>
    <View style={styles.divider}><Text style={styles.label}>Steps</Text>
      {payload.instructions.map((item, index) => <View key={index} style={styles.step}><Text style={styles.stepNumber}>{index + 1}</Text><Text style={[styles.text, styles.copy]}>{item.text}</Text></View>)}
    </View>
    {payload.tags?.length ? <Text style={styles.meta}>{payload.tags.join(", ")}</Text> : null}
  </>;
}

function WorkoutPreview({ payload }: { payload: WorkoutPayload }) {
  return <>
    <Text style={styles.meta}>{statusLabel(payload.category)}</Text>
    {payload.description ? <Text style={styles.text}>{payload.description}</Text> : null}
    <View style={styles.divider}><Text style={styles.label}>Exercises</Text>
      {payload.exercises.map((exercise, index) => <View key={index} style={styles.content}>
        <Text style={styles.label}>{index + 1}. {exercise.name}</Text>
        <View style={styles.wrap}>
          {exercise.sets != null ? <Text style={styles.meta}>Sets: {exercise.sets}</Text> : null}
          {exercise.reps ? <Text style={styles.meta}>Reps: {exercise.reps}</Text> : null}
          {exercise.duration_seconds != null ? <Text style={styles.meta}>Duration: {exercise.duration_seconds} s</Text> : null}
        </View>
      </View>)}
    </View>
  </>;
}
