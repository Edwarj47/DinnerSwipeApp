# Weekly Planning Reset

## Behavior

- Profile > Account > Account Settings > Planning > Weekly reset.
- Manual only is the default for new and existing accounts. Meals carry into the
  next Monday-Sunday week with their weekdays, portions, order and locks retained.
  Unscheduled meals stay unscheduled. Manual-only mode never sends a reminder.
- Automatic mode clears the current week's planned meals on the selected weekday
  at midnight in the account time zone. The worker checks every minute; opening
  the app also reconciles any missed reset. A reset is applied once per cycle.
- Before the selected reset day, meals still carry forward. Changing the mode,
  weekday or time zone starts with the next reset occurrence, not an immediate reset.
- The app initializes the account time zone from the first device using this release.
  Existing accounts without a saved time zone remain UTC until that initialization.
- Optional phone reminders repeat at 9 AM on the selected day in the phone's local
  time zone. Android/iOS notification permission is required. Web saves the account
  preference; open the mobile app afterward to schedule it on that phone.
  OS battery and notification controls can delay or suppress delivery. Account
  changes made on another device take effect on the phone when it next opens.
- Manual and automatic resets preserve historical plans, saved recipes, favorites,
  hidden recipes, swipe analytics and logged nutrition. A new week does not duplicate
  consumed-meal records. Its grocery list is recalculated rather than copying the
  previous week's checked purchases. Existing pantry coverage rules still apply.
- Native reminders are local: they work without a server push provider or an open
  app. Offline views remain cached until reconnect; the server then reconciles dates
  and any due automatic reset. Signing out cancels this app's scheduled reminder.

## UAT

1. Existing meals remain present after installing the update.
2. Manual only carries multiple meals per day and unscheduled meals into the next
   week without duplicating nutrition or altering the historical week.
3. Choose automatic reset and a weekday. Saving today must not clear meals today.
4. On the selected day, the current plan clears once. Meals added after that reset
   remain present when reopening, refreshing or when the worker checks again.
5. Change weekday/time zone, or disable automatic resets. No immediate clearing.
6. Enable the weekly phone reminder, grant OS permission, and verify the selected
   weekday/9 AM delivery on a physical phone. Disable it or choose Manual only;
   verify cancellation. Repeat with denied OS permission and account sign-out.
7. Verify Monday-Sunday layout and meal dates around local midnight and DST.
8. Confirm a recipe belonging to a group that is no longer accessible is not
   carried into a new plan; historical plans are unchanged.

## Operations

Settings and the server-owned reset cursor use the existing profile JSON column;
no database schema migration is required. The dedicated authenticated planning
endpoint validates weekdays and IANA time zones. General profile updates cannot
overwrite the planning settings or reset cursor.

Release checks restore a fresh Dinner Swipe database backup into an isolated
PostgreSQL container, test carryover and concurrent reset reconciliation, then
deploy only Dinner Swipe API, worker and web. Prior images, database, media and
environment backups are retained. Application rollback restores only prior service
images; do not restore the whole database over customer writes.
