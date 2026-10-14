import {
  buildWorkoutTemplate,
  emptyExercise,
  uploadedWorkoutPhotoReference
} from "@/features/workouts/template";

const photoReference = "https://dinner.test/api/v1/media/objects/00000000-0000-4000-8000-000000000001";

test("title-only templates have no required exercises, description, or photo", () => {
  expect(buildWorkoutTemplate("  Mobility  ", "full_body", "  ", [])).toEqual({
    title: "Mobility",
    category: "full_body",
    description: "",
    exercises: [],
    photo_url: null
  });
});

test("empty exercise drafts are independent and entirely blank rows are omitted", () => {
  const first = emptyExercise();
  const second = emptyExercise();
  expect(first).toEqual({ name: "", sets: "", reps: "", duration: "" });
  expect(second).not.toBe(first);
  first.name = "Changed";
  expect(second.name).toBe("");
  expect(buildWorkoutTemplate("Rest", "cardio", "", [
    second, { name: "  ", sets: " \t", reps: "\n", duration: " " }
  ]).exercises).toEqual([]);
});

test("an exercise name alone is valid without prescribed sets, reps, or duration", () => {
  expect(buildWorkoutTemplate("Walk", "cardio", "  Easy pace  ", [
    emptyExercise(), { ...emptyExercise(), name: "  Walking  " }, emptyExercise()
  ])).toEqual({
    title: "Walk",
    category: "cardio",
    description: "Easy pace",
    exercises: [{ name: "Walking" }],
    photo_url: null
  });
});

test("optional exercise metrics are trimmed and serialized without changing the draft", () => {
  const exercise = { name: "  Squat  ", sets: " 3 ", reps: " 8-10 ", duration: " 45 " };
  const original = { ...exercise };
  expect(buildWorkoutTemplate("Leg day", "lower", "", [exercise]).exercises).toEqual([
    { name: "Squat", sets: 3, reps: "8-10", duration_seconds: 45 }
  ]);
  expect(exercise).toEqual(original);
});

test.each([null, "", undefined])("a missing optional photo %s stays null", photo => {
  expect(buildWorkoutTemplate("Strength", "upper", "", [], photo).photo_url).toBeNull();
});

test.each(["http", "https"])("%s uploaded photo references shed signatures and fragments", scheme => {
  const reference = photoReference.replace("https:", `${scheme}:`);
  const uploaded = `${reference}?v=version&token=short-lived#preview`;
  expect(uploadedWorkoutPhotoReference(uploaded)).toBe(reference);
  expect(uploadedWorkoutPhotoReference(reference)).toBe(reference);
  const result = buildWorkoutTemplate("Photo only", "full_body", "", [], uploaded);
  expect(result.photo_url).toBe(reference);
  expect(result.exercises).toEqual([]);
  expect(JSON.stringify(result)).not.toContain("token=");
  expect(JSON.stringify(result)).not.toContain("#preview");
});

test.each([
  "https://example.com/workout.jpg",
  "https://dinner.test/media/uploads/user/workout.jpg",
  "https://dinner.test/api/v1/media/recipes/recipe",
  "https://dinner.test/api/v1/media/objects/",
  `${photoReference}/extra`,
  "https://user:password@dinner.test/api/v1/media/objects/photo",
  "file:///api/v1/media/objects/photo",
  "javascript:alert(1)",
  "not-a-url"
])("non-upload photo source %s cannot be built into a template", source => {
  expect(() => uploadedWorkoutPhotoReference(source)).toThrow();
  expect(() => buildWorkoutTemplate("Rejected photo", "full_body", "", [], source)).toThrow();
});

test.each(["", " \n ", "x".repeat(161)])("invalid title %s is rejected", title => {
  expect(() => buildWorkoutTemplate(title, "full_body", "", [])).toThrow(/workout title/);
});

test("title and optional exercise metrics accept their upper boundaries", () => {
  const result = buildWorkoutTemplate("x".repeat(160), "full_body", "", [{
    name: "x".repeat(160), sets: "100", reps: "x".repeat(80), duration: "86400"
  }]);
  expect(result.title).toHaveLength(160);
  expect(result.exercises).toEqual([
    { name: "x".repeat(160), sets: 100, reps: "x".repeat(80), duration_seconds: 86400 }
  ]);
});

test.each(["sets", "reps", "duration"] as const)("entered %s requires an exercise name", field => {
  const draft = emptyExercise();
  draft[field] = "3";
  expect(() => buildWorkoutTemplate("Incomplete", "full_body", "", [draft]))
    .toThrow(/name for each exercise/);
});

test.each(["0", "-1", "1.5", "1e2", "NaN", "Infinity", "bad"])(
  "optional integer metrics reject %s", value => {
    for (const field of ["sets", "duration"] as const) {
      const draft = { ...emptyExercise(), name: "Exercise" };
      draft[field] = value;
      expect(() => buildWorkoutTemplate("Invalid metrics", "full_body", "", [draft]))
        .toThrow(`Enter valid ${field}.`);
    }
  }
);

test("optional exercise values exceeding their limits are rejected", () => {
  for (const draft of [
    { ...emptyExercise(), name: "x".repeat(161) },
    { ...emptyExercise(), name: "Exercise", sets: "101" },
    { ...emptyExercise(), name: "Exercise", duration: "86401" },
    { ...emptyExercise(), name: "Exercise", reps: "x".repeat(81) }
  ]) {
    expect(() => buildWorkoutTemplate("Too long", "full_body", "", [draft])).toThrow();
  }
});
