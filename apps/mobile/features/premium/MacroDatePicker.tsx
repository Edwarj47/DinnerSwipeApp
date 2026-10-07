import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Keyboard, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Calendar, LocaleConfig } from "react-native-calendars";
import { Button } from "@/components/Button";
import { Colors } from "@/components/theme";
import { isISODate, todayISO } from "./macroDates";

LocaleConfig.locales.dinnerSwipe = { ...LocaleConfig.locales[""], dayNamesShort: ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] };
LocaleConfig.defaultLocale = "dinnerSwipe";
const calendarTheme = {
  calendarBackground: Colors.surface, todayTextColor: Colors.tomato, arrowColor: Colors.tomato, textDayFontSize: 16, textMonthFontSize: 16,
  "stylesheet.calendar.header": { dayHeader: { flex: 1, marginTop: 2, marginBottom: 7, textAlign: "center", fontSize: 14, color: Colors.muted } },
  "stylesheet.day.basic": { base: { width: "100%", minHeight: 44, paddingVertical: 4, alignItems: "center", justifyContent: "center" } }
};

export function MacroDatePicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  function choose(day: string) { onChange(day); setOpen(false); }
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel="Choose macro date" onPress={() => { Keyboard.dismiss(); setOpen(true); }} style={styles.icon}>
      <Ionicons name="calendar-outline" size={22} color={Colors.tomato} />
    </Pressable>
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="Close calendar" onPress={() => setOpen(false)} />
        <View style={styles.popup} accessibilityViewIsModal>
          <View style={styles.header}><Text style={styles.heading}>Choose date</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Dismiss calendar" onPress={() => setOpen(false)} style={styles.icon}>
              <Ionicons name="close" size={24} color={Colors.ink} />
            </Pressable>
          </View>
          <ScrollView>
            {open ? <Calendar testID="macro-calendar" initialDate={isISODate(value) ? value : todayISO()} firstDay={1} enableSwipeMonths
              markedDates={{ [value]: { selected: true, selectedColor: Colors.tomato } }}
              onDayPress={day => choose(day.dateString)}
              theme={calendarTheme} /> : null}
          </ScrollView>
          <Button label="Today" icon="today-outline" onPress={() => choose(todayISO())} />
        </View>
      </View>
    </Modal>
  </>;
}
const styles = StyleSheet.create({
  icon: { width: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  backdrop: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.4)", padding: 12 },
  popup: { width: "100%", maxWidth: 390, maxHeight: "90%", backgroundColor: Colors.surface, padding: 12, borderRadius: 8, gap: 12 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  heading: { flex: 1, minWidth: 0, fontSize: 18, fontWeight: "800", color: Colors.ink }
});
